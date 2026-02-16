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
├── config/            # Constants: limits, env vars, server identity, session config
│   └── security/      # SSRF patterns, blocked IPs/hostnames, validation patterns (pure predicates)
├── types/             # TypeScript types: response, session, rate-limit, jq tokens, public API types
├── security/          # Stateful security: DNS resolution, SSRF validation, rate limiter, file validation
├── jq/                # JQ filter engine: tokenizer, parser, filter application
├── files/             # File system: temp directory manager, output directory validation
├── execution/         # cURL execution: command executor (allowlist), args builder, memory tracker
├── response/          # Response processing: parser, formatter, file saver, processor (orchestration)
├── server/            # MCP server: factory, Zod schemas, registration, lifecycle/shutdown
├── session/           # HTTP session manager
├── tools/             # Tool handlers: curl_execute, jq_query
├── resources/         # MCP resources: API documentation
├── prompts/           # MCP prompts: api-test, api-discovery
├── transports/        # Transport implementations: stdio, HTTP (Express + SSE)
├── schema/            # YAML schema system: types, validator, loader, tool generator
├── extensible/        # McpCurlServer class, hooks executor, tool wrapper, instance utilities
└── utils/             # Shared utilities: error handling, URL helpers
```

### Extension System

- **`McpCurlServer`** (`src/lib/extensible/mcp-curl-server.ts`) — fluent builder: `.configure()`, `.beforeRequest()`, `.afterResponse()`, `.onError()`, `.registerCustomTool()`, `.disableCurlExecute()`, `.disableJqQuery()`, `.start()`, `.shutdown()`
- **Hooks** — `beforeRequest` (modify params or short-circuit), `afterResponse` (logging/metrics), `onError` (error tracking). Fail-fast semantics.
- **Custom tools** — Register additional MCP tools via `.registerCustomTool(id, meta, handler)`
- **YAML schema** — `loadApiSchema()` + `generateToolDefinitions()` for declarative API endpoint → tool mapping
- **Instance utilities** — `.utilities()` for direct config-aware `executeRequest()` / `queryFile()` (bypasses hooks)

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

**Network:** SSRF protection (private IPs, cloud metadata, DNS rebinding services, internal TLDs), DNS rebinding prevention, protocol whitelist (`http`/`https` only), `--proto =http,https` defense-in-depth, `--max-filesize` 10MB early abort, Windows UNC path blocking, localhost blocked by default (`MCP_CURL_ALLOW_LOCALHOST=true` to enable with port restrictions)

**Rate limiting:** 60 req/min per host, 300 req/min per client

**Input validation:** Zod schemas, command allowlist (`curl` only), `spawn()` without shell, CRLF injection prevention, `--data-raw`/`--form-string` against `@` file exfil, per-request unique metadata separators

**File access:** `jq_query` restricted to temp dir / `MCP_CURL_OUTPUT_DIR` / cwd (including subdirs), symlinks resolved via `realpath()`, path traversal (`..`) rejected

**Resource limits:** 10MB response/file processing, 1MB max inline return (default 500KB), 100MB global memory, 20 max jq filter paths, 100ms jq parse timeout, 30s default request timeout

**HTTP transport:** Optional bearer token auth (`MCP_AUTH_TOKEN`), 100 max sessions, 1h idle timeout

**Error logging:** Minimal — `tool_name error: [hostname/filename] ErrorClassName` (no message content)

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
