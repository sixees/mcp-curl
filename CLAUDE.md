# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm start            # Run the server (stdio transport)
npm test             # Run vitest tests
TRANSPORT=http PORT=3000 npm start  # Run with HTTP transport
```

## Architecture

MCP server enabling LLMs to execute cURL commands. Modular TypeScript library with three entry points:

- `src/index.ts` — CLI entry point (thin wrapper selecting stdio/HTTP transport)
- `src/lib.ts` — Library entry point (main package export: `McpCurlServer`, types, schema utilities)
- `src/lib/api-server.ts` — `createApiServer()` factory for YAML-driven servers

### Module Map

```
src/lib/
├── config/            # Constants: limits, env vars, server identity, session, defaults, labels
│   └── security/      # SSRF patterns, blocked IPs/hostnames, URL-scheme allowlist, validation patterns
├── types/             # TypeScript types: response, session, rate-limit, jq tokens, public API types
├── security/          # Stateful security: DNS resolution, SSRF validation, rate limiter, file validation,
│                      #   detection-logger (throttled `[injection-defense]`), wrap-error-logger
│                      #   (throttled `[wrap-error]`), input-validation (timing-safe compare)
├── jq/                # JQ filter engine: tokenizer, parser, filter application
├── files/             # File system: temp directory manager, output directory validation
├── execution/         # cURL execution: command executor (allowlist), args builder, memory tracker
├── response/          # Response processing: parser, formatter, file saver, processor (orchestration),
│                      #   strip-blocks (HTML/markdown/script/style/beacon stripping),
│                      #   post-processor (defence-in-depth wrap — sanitise + detect + spotlight)
├── server/            # MCP server: factory, Zod schemas, registration, lifecycle/shutdown
├── session/           # HTTP session manager
├── tools/             # Tool handlers: curl_execute, jq_query
├── resources/         # MCP resources: API documentation
├── prompts/           # MCP prompts: api-test, api-discovery
├── transports/        # Transport implementations: stdio, HTTP (Express + SSE) with bearer-token validation
├── schema/            # YAML schema system: types, validator (z.preprocess sanitiser), loader, tool generator
├── extensible/        # McpCurlServer class, hooks executor (short-circuit wraps results),
│                      #   tool wrapper, instance utilities, schema-sanitizer (deep .describe walk)
└── utils/             # Sanitize (Unicode/whitespace/spotlighting), URL helpers (createHttpOnlyUrlSchema,
                       #   safeHostname), content-type predicates, unicode-attack-ranges, error helpers
```

### Extension System

- **`McpCurlServer`** (`src/lib/extensible/mcp-curl-server.ts`) — fluent builder: `.configure()`, `.beforeRequest()`, `.afterResponse()`, `.onError()`, `.registerCustomTool()`, `.disableCurlExecute()`, `.disableJqQuery()`, `.start()`, `.shutdown()`
- **Hooks** — `beforeRequest` (modify params or short-circuit), `afterResponse` (logging/metrics), `onError` (error tracking). Fail-fast semantics. Short-circuit returns are wrapped through the same defence-in-depth post-processor as real tool output, so synthesised hook bytes cannot bypass sanitise/detect/spotlight.
- **Custom tools** — `.registerCustomTool(id, meta, handler)`. `meta.title`, `meta.description`, and **every `.describe()` string at every depth of `meta.inputSchema`** are sanitised at registration. Handler return values are wrapped through the post-processor (sanitise + detect + optional spotlight) automatically.
- **YAML schema** — `loadApiSchema()` / `loadApiSchemaFromString()` / `validateApiSchema()` (and the directly-re-exported `ApiSchemaValidator.parse()`) all run a single `z.preprocess()` sanitiser before validation, so attacker-controlled bidi/zero-width bytes never reach the LLM or appear in Zod error messages. Cross-field checks (duplicate IDs, undefined path params, duplicate filter-preset names) live in the validator's `.transform()`.
- **Instance utilities** — `.utilities()` for direct config-aware `executeRequest()` / `queryFile()` (bypasses hooks)
- **Public sanitisation barrel** — `sanitizeDescription`, `sanitizeResponse`, `detectInjectionPattern`, `sanitizeAndDetect`, `logInjectionDetected`, `applySpotlighting`, `createHttpOnlyUrlSchema`, `safeHostname` are exported from `mcp-curl` for callers building non-MCP pipelines or composing the same primitives manually. `createWrapper` (the internal post-processor) is intentionally not exported — its `CallToolResult` shape is MCP-SDK-coupled.

### Key Design Decisions

- Composition with builder pattern (not inheritance)
- Immutable security data: frozen arrays/sets with pure predicate functions
- Layered architecture: pure config predicates → stateful security functions → tool handlers
- `spawn()` without shell for command execution; compile-time + runtime allowlist
- DNS resolved before SSRF validation; cURL pinned to validated IP via `--resolve`

## Tools

- **`curl_execute`** — HTTP requests with structured params, auth, jq filtering, auto-save for large responses
- **`jq_query`** — Query saved JSON files without new HTTP requests

## Security

**Network:** SSRF protection (private IPs, cloud metadata, DNS rebinding services, internal TLDs), DNS rebinding prevention, protocol whitelist (`http`/`https` only), `--proto =http,https` defense-in-depth, `--max-filesize` 10MB early abort, Windows UNC path blocking, localhost blocked by default (`MCP_CURL_ALLOW_LOCALHOST=true` to enable with port restrictions: `80`, `443`, and any port `> 1024`)

**Rate limiting:** 60 req/min per host, 300 req/min per client

**Input validation:** Zod schemas, command allowlist (`curl` only), `spawn()` without shell, CRLF injection prevention, `--data-raw`/`--form-string` against `@` file exfil, per-request unique metadata separators, `createHttpOnlyUrlSchema()` parser-based scheme allowlist (rejects `data:`, `javascript:`, `file:`, `ftp:`, …) shared between `curl_execute`, YAML `baseUrl`, and custom-tool URL fields.

**File access:** `jq_query` restricted to temp dir / `MCP_CURL_OUTPUT_DIR` / cwd (including subdirs), symlinks resolved via `realpath()`, path traversal (`..`) rejected

**Resource limits:** 10MB response/file processing, 1MB max inline return (default 500KB), 100MB global memory, 20 max jq filter paths, 100ms jq parse timeout, 30s default request timeout. HTML/markdown strip path bounded by 256 KB body cap with a 4-iteration fixed-point loop (ReDoS-hardened).

**HTTP transport:** Optional bearer token auth (`MCP_AUTH_TOKEN`) — printable-ASCII only, ≤ 4096 chars, validated at startup; rejected token never echoed in error messages. Compare via `crypto.timingSafeEqual` (length-padded). 100 max sessions, 1h idle timeout. RFC 6750 §2.1 case-insensitive scheme.

**Error logging:** Minimal — `tool_name error: [hostname/filename] ErrorClassName` (no message content)

**Trust boundary (response-side):** every tool result — `curl_execute`, `jq_query`, YAML-driven endpoints, custom tools registered via `registerCustomTool()`, and `beforeRequest` short-circuit returns — is routed through the **defence-in-depth wrap** in `src/lib/response/post-processor.ts`. The wrap runs `detect-on-original → sanitise → optional spotlight` on each text content part, is idempotent via a module-private (non-`Symbol.for`) tag, and is fail-open (internal exceptions return the original result and emit a throttled `[wrap-error]` log). YAML schema layer applies `z.preprocess` sanitisation **before** Zod validation; `registerCustomTool()` walks `inputSchema` and sanitises every `.describe()` string at every depth in place via `z.globalRegistry`.

**Prompt injection defense:** `[injection-defense] [hostname] InjectionDetected` logged to stderr when a suspicious pattern matches against the **original** (pre-sanitisation) response text via NFKC-normalised regex. Throttled to once per 60 seconds per hostname. Sanitization and detection never suppress content returned to the LLM — observability only. UTS #39 confusable-folding (Cyrillic/Greek homoglyphs) is a documented gap deferred until per-host log signal warrants it.

**Response sanitisation:** Unicode attack chars (bidi overrides, zero-width, soft hyphen, Tags block, Variation Selectors Supplement / "Sneaky Bits", Braille blank, Arabic Letter Mark, Mongolian invisibles, Hangul fillers, …) stripped from text responses. Visual-space-padding runs (50+ tabs, NBSP, em/en-spaces, NARROW NO-BREAK, MEDIUM MATHEMATICAL, IDEOGRAPHIC SPACE) collapse to one ASCII space; newline runs (20+, with single inline-whitespace interrupters tolerated) collapse to one `\n`. Idempotence loop (≤4 iterations) defeats `(49 spaces + ZWSP) × N` interleaving.

**HTML / Markdown content stripping:** `<script>` and `<style>` blocks removed from HTML/XHTML/SVG/`*+xml`/markdown responses (ReDoS-hardened lazy-with-end-or-EOF body, 256 KB cap, 4-iteration fixed-point loop, numeric-entity decode inside the loop, `<!-- … -->` comments stripped). Body sniffing (`looksLikeMarkupShape`) catches markup served under tampered Content-Type. Markdown image / link beacons replaced with `[image removed]` / `[link removed]`; dangerous-scheme URLs (`javascript:`, `vbscript:`, `file:`, `data:`) stripped from markdown links and images, including the `[![safe](http://x)](javascript:...)` nesting case.

**Timeout defaults:** `McpCurlConfig.defaultTimeout` → system default 30s (`LIMITS.DEFAULT_TIMEOUT_MS / 1000`)

## Code Style

- Modern ES6+ with strict TypeScript
- ESM modules (`"type": "module"` in package.json)
- Zod for runtime schema validation
- Prefer async/await, pure functions, early returns
- Cross-platform: uses `path.isAbsolute()`, `path.basename()`, `path.resolve()` for Windows/Unix compatibility

## Testing

- `npm test` runs vitest (`vitest run`)
- `npm run test:watch` for watch mode
- Test files are co-located: `*.test.ts` next to their source files
- Key test files: `mcp-curl-server.test.ts`, `ssrf.test.ts`, `parser.test.ts`, `filter.test.ts`, `schema.test.ts`, `session-manager.test.ts`, `http.test.ts`
