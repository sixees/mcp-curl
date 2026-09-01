# Architecture

**What this document owns:** how this system is built and why it is shaped that
way. The tech stack, the runtime shape, the trust boundaries, and the invariants
a change must not break.

What it does **not** own: how to work here (that is `CLAUDE.md`), what the work
must look like (`CONVENTIONS.md`), or what went wrong and what it taught us
(`LESSONS.md`).

## Two rules for maintaining this file

**Cite a file and a symbol or section by name.**
`CONVENTIONS.md` → *Referring to code and to files* owns this rule and states
its scope: it binds **every** durable output, not this document alone. Read it there — a copy of the
rule scoped to one file reads as the whole rule, and the reader who lands here
first never learns it governs their findings and todos too.

**Document the why.** What the code does is readable from the code. Why it is
shaped this way, what breaks if it changes, and which choice will look like a
mistake to someone who does not know the constraint — that is the part nobody can
reconstruct.

---

## What this is

An MCP server that lets an LLM execute cURL requests, plus the embeddable
TypeScript library behind it. Everything about the shape follows from one fact:
**both ends are hostile.** The model chooses the URL (so the outbound side is an
SSRF surface), and the remote chooses the response bytes (so the inbound side is
a prompt-injection surface). The security modules are not a layer bolted on top —
they are the reason the module boundaries fall where they do.

## Stack

| Layer | Choice | Floor | Why this one |
|---|---|---|---|
| Language / runtime | TypeScript (strict), ESM | TS ^5.5, `@types/node` ^22 | Strict mode is load-bearing: several security predicates rely on narrowing rather than assertion. ESM (`"type": "module"`) throughout — no dual build. |
| Framework | `@modelcontextprotocol/sdk` | ^1.29.0 | The protocol this exists to speak. `CallToolResult` shape is SDK-coupled, which is why the post-processor wrapper is not exported publicly. |
| HTTP transport | Express | ^4.21.0 | Only for the optional HTTP/SSE transport. Deliberately not on the stdio path, which is the default. |
| Validation | Zod | ^4.0.0 | Runtime validation at every input boundary. Also used for the YAML schema layer, where a `z.preprocess()` sanitiser runs *before* validation so attacker bytes never reach a Zod error message. |
| Config parsing | `js-yaml` | ^4.1.1 | YAML-driven API schema loading. |
| Build | `tsup` | ^8.5.1 | Bundles four entry points (see *Exposed* below); `build` chmods `dist/index.js` to 0755 for the `curl-mcp` bin. |
| Test | `vitest` | ^4.0.18 | `vitest run` in CI mode. Tests are co-located. |
| Data store | *none* | — | All state is in-process. See *Data*. |
| Deploy | npm package | — | Published as `mcp-curl`. There is no hosted deployment owned by this repo. |

## Repository layout

Three entry points, then a module tree where each directory owns one concern.

```
src/index.ts          CLI entry point — thin wrapper selecting stdio/HTTP transport
src/lib.ts            Library entry point — McpCurlServer, types, schema utilities
src/lib/api-server.ts createApiServer() factory for YAML-driven servers

src/lib/
├── config/            Constants: limits, env vars, server identity, session, defaults, labels
│   └── security/      SSRF patterns, blocked IPs/hostnames, URL-scheme allowlist, validation patterns
├── types/             TypeScript types: response, session, rate-limit, jq tokens, public API types
├── security/          Stateful security: DNS resolution, SSRF validation, rate limiter, file validation,
│                        detection-logger (throttled `[injection-defense]`), wrap-error-logger
│                        (throttled `[wrap-error]`), input-validation (timing-safe compare)
├── jq/                JQ filter engine: tokenizer, parser, filter application
├── files/             File system: temp directory manager, output directory validation
├── execution/         cURL execution: command executor (allowlist), args builder, memory tracker
├── response/          Response processing: parser, formatter, file saver, processor (orchestration),
│                        strip-blocks (HTML/markdown/script/style/beacon stripping),
│                        post-processor (defence-in-depth wrap — sanitise + detect + spotlight)
├── server/            MCP server: factory, Zod schemas, registration, lifecycle/shutdown
├── session/           HTTP session manager
├── tools/             Tool handlers: curl_execute, jq_query
├── resources/         MCP resources: API documentation
├── prompts/           MCP prompts: api-test, api-discovery
├── transports/        Transport implementations: stdio, HTTP (Express + SSE) with bearer-token validation
├── schema/            YAML schema system: types, validator (z.preprocess sanitiser), loader, tool generator
├── extensible/        McpCurlServer class, hooks executor (short-circuit wraps results),
│                        tool wrapper, instance utilities, schema-sanitizer (deep .describe walk)
└── utils/             Sanitize (Unicode/whitespace/spotlighting), URL helpers (createHttpOnlyUrlSchema,
                         safeHostname), content-type predicates, unicode-attack-ranges, error helpers
```

The layering is deliberate and one-directional: **pure config predicates →
stateful security functions → tool handlers.** `config/security/` holds frozen
arrays and sets with pure predicate functions over them; `security/` adds the
state (DNS cache, rate-limiter counters); `tools/` composes both. An import that
runs the other way is the dependency-arrow violation to look for.

## The runtime shape

**Entry points.** Two transports, selected in `src/index.ts` by the `TRANSPORT`
env var:

- **stdio** (default) — one process, one client, lifetime bound to the parent.
- **HTTP** (`TRANSPORT=http`) — Express + SSE, many sessions, optional bearer
  auth. This is the one that carries session state and the one whose failure
  modes nobody exercises daily; treat changes to it as higher-surface than the
  line count suggests.

**A `curl_execute` request, end to end.** This ordering is the security design;
reordering any two steps breaks a guarantee:

1. Zod parses the tool input. `createHttpOnlyUrlSchema()` rejects any scheme
   outside `http`/`https` at parse time — `data:`, `javascript:`, `file:`, `ftp:`
   never reach the next step.
2. **DNS is resolved before SSRF validation**, and the validated IP is what gets
   checked. This is the DNS-rebinding defence.
3. cURL is **pinned to that already-validated IP via `--resolve`**, so the name is
   not looked up a second time. The gap this closes: validating a hostname and
   then letting cURL re-resolve it lets the attacker answer differently the second
   time.
4. Rate limits are checked (per host and per client).
5. `spawn()` runs cURL — **no shell**, with a compile-time and runtime allowlist
   that permits `curl` and nothing else. `--proto =http,https` and
   `--max-filesize` are defence in depth behind the checks already made.
6. The response is parsed, optionally jq-filtered, optionally saved to disk when
   large.
7. **Everything returned passes through the defence-in-depth wrap** — see *Trust
   boundaries*.

**`jq_query`** skips steps 1–6 entirely: it reads an already-saved file and runs
the same wrap on the way out. Its own boundary is the filesystem one.

## Data

There is no database, no cache server, no queue, and therefore no migrations.

All state is in-process and dies with it:

- **Session map** — HTTP transport only. 100 sessions max, 1 hour idle timeout.
- **Rate-limiter counters** — 60 req/min per host, 300 req/min per client.
- **Memory tracker** — 100MB global ceiling across in-flight response processing.
- **Temp directory** — managed on local disk for saved responses, cleaned up on
  shutdown by the lifecycle module.

The only durable artefacts are saved response files, which live in the temp
directory, `MCP_CURL_OUTPUT_DIR`, or the working directory — and that set is
exactly what `jq_query` is allowed to read.

## External interfaces

### Consumed

- **Arbitrary remote HTTP endpoints**, chosen at request time by the model. There
  is no allowlist of destinations — the controls are on the *shape* of the
  destination (scheme, resolved IP, port), not its identity. A failure here is
  returned to the caller as a tool error; nothing retries.
- **The system `curl` binary.** Its absence is fatal to the tool, not degraded.
- **System DNS.** A resolution failure fails the request closed.

### Exposed

**Two MCP tools:**

- **`curl_execute`** — HTTP requests with structured params, auth, jq filtering,
  and auto-save for large responses.
- **`jq_query`** — query saved JSON files without issuing a new HTTP request.

**Two MCP prompts** (`api-test`, `api-discovery`) and **MCP resources** carrying
API documentation.

**Four npm entry points**, and all four are public contracts a consumer can pin
to — a breaking change to any of them is a MAJOR bump:

| Export | Path | Contents |
|---|---|---|
| `mcp-curl` | `dist/lib.js` | `McpCurlServer`, types, schema utilities |
| `mcp-curl/cli` | `dist/index.js` | CLI entry (also the `curl-mcp` bin) |
| `mcp-curl/lib` | `dist/lib/index.js` | Module barrel |
| `mcp-curl/schema` | `dist/lib/schema/index.js` | YAML schema system |

**The extension system**, exposed from `src/lib.ts`:

- **`McpCurlServer`** (`src/lib/extensible/mcp-curl-server.ts`) — fluent builder:
  `.configure()`, `.beforeRequest()`, `.afterResponse()`, `.onError()`,
  `.registerCustomTool()`, `.disableCurlExecute()`, `.disableJqQuery()`,
  `.start()`, `.shutdown()`. Composition with a builder pattern, deliberately not
  inheritance.
- **Hooks** — `beforeRequest` (modify params or short-circuit), `afterResponse`
  (logging/metrics), `onError` (error tracking). Fail-fast semantics.
  Short-circuit returns are wrapped through the same defence-in-depth
  post-processor as real tool output, **so synthesised hook bytes cannot bypass
  sanitise/detect/spotlight.**
- **Custom tools** — `.registerCustomTool(id, meta, handler)`. `meta.title`,
  `meta.description`, and **every `.describe()` string at every depth of
  `meta.inputSchema`** are sanitised at registration, walked in place via
  `z.globalRegistry`. Handler return values are wrapped through the
  post-processor automatically.
- **YAML schema** — `loadApiSchema()` / `loadApiSchemaFromString()` /
  `validateApiSchema()` (and the directly re-exported `ApiSchemaValidator.parse()`)
  all run a single `z.preprocess()` sanitiser before validation. Cross-field checks
  (duplicate IDs, undefined path params, duplicate filter-preset names) live in the
  validator's `.transform()`.
- **Instance utilities** — `.utilities()` for direct config-aware
  `executeRequest()` / `queryFile()`. **Bypasses hooks** — that is the point of it,
  and the reason it is named separately rather than being the default path.
- **Public sanitisation barrel** — `sanitizeDescription`, `sanitizeResponse`,
  `detectInjectionPattern`, `sanitizeAndDetect`, `logInjectionDetected`,
  `applySpotlighting`, `createHttpOnlyUrlSchema`, `safeHostname` are exported for
  callers building non-MCP pipelines. `createWrapper` (the internal
  post-processor) is **intentionally not exported** — its `CallToolResult` shape is
  MCP-SDK-coupled, so exporting it would freeze an SDK type into our public API.

## Security architecture

### Trust boundaries

There are three, and each has one place where crossing is made safe.

**1. Outbound — the model chooses the destination.**

- SSRF protection: private IPs, cloud metadata endpoints, DNS-rebinding services,
  internal TLDs.
- DNS resolved before validation; cURL pinned to the validated IP via `--resolve`.
- Protocol allowlist (`http`/`https` only), enforced twice: at parse time by
  `createHttpOnlyUrlSchema()` and again at the process boundary by
  `--proto =http,https`.
- `--max-filesize` 10MB for early abort.
- Windows UNC path blocking.
- **localhost is blocked by default.** `MCP_CURL_ALLOW_LOCALHOST=true` enables it
  with port restrictions: `80`, `443`, and any port `> 1024` — the reserved range
  stays closed because that is where the interesting local daemons live.
- Rate limiting: 60 req/min per host, 300 req/min per client.
- CRLF injection prevention; `--data-raw` / `--form-string` (never `--data` /
  `--form`) so a leading `@` cannot be read as a file path and exfiltrate local
  content; per-request unique metadata separators.

**2. Inbound — the remote chooses the response bytes, and they reach an LLM.**

**Every tool result** — `curl_execute`, `jq_query`, YAML-driven endpoints, custom
tools registered via `registerCustomTool()`, and `beforeRequest` short-circuit
returns — is routed through the defence-in-depth wrap in
`src/lib/response/post-processor.ts`. The wrap:

- runs **detect-on-original → sanitise → optional spotlight** on each text content
  part. Detection runs against the *pre-sanitisation* text, because sanitising
  first would destroy the evidence the detector exists to find.
- is **idempotent** via a module-private (deliberately **not** `Symbol.for`) tag,
  so a foreign realm cannot forge the "already wrapped" marker.
- is **fail-open**: an internal exception returns the original result and emits a
  throttled `[wrap-error]` log. Fail-open is the correct direction here and the
  choice is deliberate — a sanitiser crash must not silently swallow a response
  the user asked for.

What the wrap does:

- **Unicode attack characters stripped** from text responses: bidi overrides,
  zero-width, soft hyphen, Tags block, Variation Selectors Supplement ("Sneaky
  Bits"), Braille blank, Arabic Letter Mark, Mongolian invisibles, Hangul fillers.
- **Visual-space-padding runs** (50+ tabs, NBSP, em/en-spaces, NARROW NO-BREAK,
  MEDIUM MATHEMATICAL, IDEOGRAPHIC SPACE) collapse to one ASCII space; newline
  runs (20+, tolerating single inline-whitespace interrupters) collapse to one
  `\n`. An idempotence loop (≤4 iterations) defeats `(49 spaces + ZWSP) × N`
  interleaving — the attack that defeats a single pass.
- **HTML / markdown stripping** on HTML/XHTML/SVG/`*+xml`/markdown responses:
  `<script>` and `<style>` blocks removed, `<!-- … -->` comments stripped,
  numeric entities decoded inside the loop. ReDoS-hardened: lazy-with-end-or-EOF
  body, 256 KB cap, 4-iteration fixed-point loop. `looksLikeMarkupShape()` sniffs
  the body so markup served under a tampered Content-Type is still caught.
  Markdown image/link beacons become `[image removed]` / `[link removed]`;
  dangerous-scheme URLs (`javascript:`, `vbscript:`, `file:`, `data:`) are
  stripped from links and images, **including the nested
  `[![safe](http://x)](javascript:...)` case.**
- **Injection detection is observability only.** `[injection-defense] [hostname]
  InjectionDetected` goes to stderr when a suspicious pattern matches the original
  text via NFKC-normalised regex, throttled to once per 60s per hostname.
  **Sanitisation and detection never suppress content returned to the LLM** —
  silently dropping a response would make the tool unreliable in a way the user
  could not diagnose.

*Known gap, stated deliberately:* UTS #39 confusable-folding (Cyrillic/Greek
homoglyphs) is **not** implemented. Deferred until per-host log signal warrants
it. A coverage claim broader than this would be worse than none.

**3. Filesystem — `jq_query` reads local files.**

Restricted to the temp dir, `MCP_CURL_OUTPUT_DIR`, or cwd (including subdirs).
Symlinks resolved via `realpath()` before the scope check — checking the path
before resolution is the classic escape. Path traversal (`..`) rejected.

### Authentication and authorisation

Only the HTTP transport has any. Bearer token via `MCP_AUTH_TOKEN`:
printable-ASCII only, ≤ 4096 chars, **validated at startup** so a malformed token
fails the process rather than every request. Compared with
`crypto.timingSafeEqual` (length-padded). RFC 6750 §2.1 case-insensitive scheme.
**A rejected token is never echoed in an error message.**

The stdio transport has no auth and needs none — its trust model is the parent
process.

### Secrets

This repo holds none. Tokens reach the runtime by env var (`MCP_AUTH_TOKEN`) or
by request parameter (per-request auth). `configs/*.{yaml,yml,ts,js,json}` are
gitignored precisely because real API definitions carry credentials; only the
template and README in `configs/` are tracked.

**Error logging is deliberately minimal**: `tool_name error: [hostname/filename]
ErrorClassName` — the class name, never the message. A subprocess error's message
typically *contains* the stderr it looks like a safer alternative to, and stderr
is where credentials surface.

### Resource limits

10MB response/file processing · 1MB max inline return (default 500KB) · 100MB
global memory · 20 max jq filter paths · 100ms jq parse timeout · 30s default
request timeout (`McpCurlConfig.defaultTimeout` → `LIMITS.DEFAULT_TIMEOUT_MS /
1000`) · 256 KB body cap on the HTML/markdown strip path.

## Invariants

The properties a change must not break. Cite these by number in a review finding
or an RC rather than re-describing them.

1. **Every byte returned to the LLM passes through the post-processor wrap.** Any
   new code path producing a `CallToolResult` — tool, hook short-circuit, custom
   tool, YAML endpoint, error path — goes through it. A path that bypasses it is a
   vulnerability regardless of how trusted its source looks.
2. **DNS resolution precedes SSRF validation, and cURL is pinned to the validated
   IP.** Any change that lets cURL resolve a name itself reopens DNS rebinding.
3. **The scheme allowlist is enforced at parse time, not at use time.** A URL that
   is not `http`/`https` never becomes a `URL` object this code acts on.
4. **`spawn()` is called without a shell, and the command allowlist permits only
   `curl`.** Enforced at compile time and again at runtime.
5. **Request bodies use `--data-raw` / `--form-string`, never `--data` /
   `--form`.** The distinction is the local-file-exfiltration defence, and the
   safe forms look like gratuitous verbosity to anyone who does not know that.
6. **Detection runs on the original text; sanitisation runs after.** Reversing
   them makes the detector blind to exactly what it exists to catch.
7. **Sanitisation never suppresses content.** It rewrites; it does not drop a
   response or fail a request.
8. **`jq_query` resolves symlinks before checking scope**, never after.
9. **The wrap's idempotence tag is module-private and not `Symbol.for`.** A
   registered symbol would be forgeable.
10. **The layering arrow points one way:** `config/` (pure predicates) →
    `security/` (stateful) → `tools/` (composition). No import runs back up it.
11. **The four npm entry points are public contracts.** A breaking change to any
    exported type or behaviour is a MAJOR bump, and `createWrapper` stays
    unexported.
12. **Localhost is denied unless explicitly enabled**, and even then the reserved
    port range stays closed.

## Environments

- **Local** — `npm start` (stdio) or `TRANSPORT=http PORT=3000 npm start`.
  `npm run dev` for watch-mode compilation.
- **CI** — `npm test` (`vitest run`). No deployment stage; this repo publishes to
  npm rather than deploying.
- **Consumer runtime** — whatever machine the operator runs `curl-mcp` on, or
  whatever process imports the library. **This is the environment difference that
  matters most and the one hardest to reproduce:** the available `curl` build, its
  protocol support, and the local network's reachability all vary, and a check
  that passes here may not hold there. Anything depending on a specific cURL
  feature needs to degrade legibly rather than assume.
