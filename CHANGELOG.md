# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.0] - 2026-09-01

### Fixed

- **`include_headers` no longer corrupts the response body.** cURL's `-i` prepends the header block
  to the body on stdout, and that combined string was passed straight into body processing. Two
  consequences: `save_to_file` wrote the status line and headers above the JSON, so the saved file
  was not a valid JSON document and `jq_query` could not read it back; and `jq_filter` had to be
  rejected outright with "Cannot use jq_filter with include_headers". Headers are now split from the
  body before any body-shaped operation, so a saved file holds the body alone.

### Changed

- **`include_headers` composes with `jq_filter` and `save_to_file`.** The cross-field validation that
  rejected `include_headers` + `jq_filter` is gone — the combination now filters the body and reports
  the headers next to it. Under `include_metadata` the headers arrive as a discrete `headers` key
  rather than being embedded in `response`. In the plain, unfiltered, unsaved case the output is
  unchanged in substance: header text, blank line, body.

  Header text is server-controlled, so it goes through **the same defence pipeline as the body** —
  `defendText`, which is sanitise + injection-detect *and* the markup/markdown strip stages.
  Splitting it out does not route it around those defences. Header text is declared `text/markdown`
  for that pass — the strictest grammar — because header values are rendered by whatever the client
  renders. It is truncated at 64KB (`LIMITS.MAX_HEADER_TEXT_BYTES`) with a visible marker, since it
  is surfaced inline even when the body was saved to a file and so is not bounded by
  `max_result_size`. On a redirect chain every header block is reported, as `curl -i` prints them.

  The header/body boundary comes from cURL's own `%{size_header}`, delivered on the `-w` metadata
  channel behind the unguessable per-request separator. It is never inferred from the response
  bytes: a body may legitimately *be* an HTTP transcript, so no pattern can tell a real header block
  from a body that looks like one.

### Changed — response shape under `include_headers`

- **`response` no longer contains the response headers when `include_headers` is set.** Under
  `include_metadata`, headers move from being embedded at the top of `response` to a discrete
  `headers` key. A consumer that grabbed a `Set-Cookie` or parsed `^HTTP/` out of `response` would
  now get nothing — silently, with no error, because the field still exists and still parses.

  **Released as a MINOR bump, deliberately.** This is a change to a published output shape and
  would ordinarily be a MAJOR. It is not treated as one because this package has no consumers:
  the rule exists to protect people pinning to the old shape, and there are none. Recording the
  decision here so it reads as a deliberate posture rather than an oversight — and so that the
  next such change, made once consumers exist, is not justified by pointing at this one.

  `mcp-curl/schema` is unaffected either way: YAML-driven endpoints pin `include_headers: false`
  (`schema/generator.ts::createToolHandler`), so no `/schema` consumer could have had headers
  inside `response`.

  Files already on disk are unaffected in either direction — `include_headers` + `save_to_file`
  wrote unparseable files before this change and `jq_query` could not read them then either, so no
  previously-written file becomes less readable.

### Added

- `headers_truncated` / `header_bytes_received` / `headers_undetermined` metadata fields, reported
  out of band so a remote cannot author them by sending the same words in a header value.
- `processor.ts::defendText` — the shared five-stage defence pipeline, so no text channel can
  assemble a shorter one.

## [3.2.0] - 2026-09-01

### Added

- **Prompt-injection hardening across every tool-response path** (PR-4 … PR-8). Response sanitisation
  expanded to cover the Variation Selector Supplement ("Sneaky Bits"), Braille blank, Hangul fillers,
  Mongolian invisibles and Arabic Letter Mark; visual-space-padding and newline runs collapsed; an
  idempotence loop defeats interleaved padding. HTML/Markdown stripping is ReDoS-hardened with a
  bounded fixed-point loop and a body-shape sniffer for tampered Content-Types. Injection detection
  now normalises NFKC before matching and logs (never redacts) to stderr.

- **Defence-in-depth response wrap** on YAML endpoints, custom tools and hook short-circuit returns
  (PR-6b), so every tool result routes through one post-processor.

- **YAML schemas sanitised at parse time** (PR-6a), closing an `ApiSchemaValidator` bypass: bidi and
  zero-width bytes can no longer reach the LLM or appear in Zod error messages.

- **`registerCustomTool()` auto-sanitises `inputSchema` field descriptions** at every depth (PR-5),
  recursing through all Zod wrapper and container types while preserving runtime invariants.

- **HTTP auth-token validation** (PR-4): `MCP_AUTH_TOKEN` must be printable ASCII and ≤4096 chars;
  the rejected token is never echoed, and bearer comparison is timing-safe.

- URL helper hardening and public-barrel symmetry (PR-1); `executeJqQuery` unit tests (PR-2);
  architecture overview and integration-test script.

### Fixed

- **`jq_filter` no longer silently misreads unsupported jq syntax.** The bare-key scanner in
  `parseJqFilter()` treated any character that was not `.` or `[` as part of a key name, so a real jq
  expression was absorbed into a key, missed, and resolved to `null`. `.data | {id, name}` returned
  `[null, null]` and `.data | {id}` returned `undefined`, with no indication that the syntax was never
  supported. Such filters now throw an error naming the offending character and listing what is
  supported. Hyphens and underscores in bare keys (`.content-type`, `.assignee_user_ids`) and bracket
  notation (`.["a|b: {c}"]`) are unaffected.

- **`applyJqFilter()` / `applyJqFilterToParsed()` no longer return `undefined`.** `JSON.stringify(undefined)`
  is `undefined`, not a string, so a missing key leaked a non-string value out of a function declared to
  return `string`. A missing path now yields the string `"null"`, matching jq's output for an absent path.
  `applySingleJqFilter()` keeps its documented `undefined`-for-missing-key contract.

- **Iterate-and-project (`.items[].id`) is now rejected instead of returning `null`.** `[]` is an array
  passthrough, not jq's iterate, so a key lookup after it landed on the array and silently resolved to
  `null`. A trailing `[]` still works; use an explicit index or slice to project.

### Documentation

- `docs/api-schema.md` advertised `jqFilter: ".data | {id, name}"` and `".data | {id}"` in two
  `filterPresets` examples. Neither could ever work — both are now supported path syntax, and the
  Response Configuration section states plainly what `jqFilter` does and does not support.

- `README.md` documents the `[]` passthrough and states that jq expression syntax is rejected.

## [3.0.0] - 2026-04-03

### Breaking Changes

- **Zod v4 upgrade** – `zod` dependency bumped from `^3.23.8` to `^4.0.0`. Consumers who have their own
  `zod@^3.x` dependency and use exported types from `mcp-curl` (e.g. `CurlExecuteInput`, `JqQueryInput`,
  `ApiSchemaValidationError`) will encounter TypeScript type mismatches. Pin your `zod` dependency to v4 or use
  type-only imports where possible.

- **`ApiSchemaValidationError.issues` type changed** – The `issues` property on `ApiSchemaValidationError` now
  carries Zod v4's `ZodIssue` type. The `invalid_type` issue no longer includes a `received` field. Code
  pattern-matching on issue structure may need updates.

- **URL validation error code changed** – Zod v4 `z.url()` emits `invalid_format` instead of `invalid_string`
  for URL format failures. Code matching on `issue.code === "invalid_string"` for URL fields will no longer match.
  Update to `issue.code === "invalid_format"`.

### Changed

- **`@modelcontextprotocol/sdk` bumped** from `^1.12.0` to `^1.29.0`. No breaking API changes in the tool
  registration surface (`server.registerTool()` is unchanged).

- **`z.string().url()` → `z.url()`** at all validation sites. The HTTP/HTTPS protocol `.refine()` guard on
  `CurlExecuteSchema.url` is preserved.

- **`z.record(z.string())` → `z.record(z.string(), z.string())`** for `headers` and `form` fields. The
  single-argument form builds silently in Zod v4 but crashes at parse time.

## [2.0.1] - 2026-02-17

### Security

- **cURL protocol restriction** – Added `--proto=http,https` to all requests as defense-in-depth alongside URL
  validation, preventing protocol confusion between Node's URL parser and cURL's parser

- **cURL size abort** – Added `--max-filesize` (10MB) to abort early when `Content-Length` exceeds the limit (cURL exit
  code 63), before data streams into Node. Chunked/streaming responses without Content-Length still rely on the
  Node-level backstop in `command-executor.ts`

- **Minimal error logging** – Server-side `console.error` now logs only `[hostname]` or `[filename]` with error class
  name. Previously could leak auth headers from `-v` mode, URLs with tokens, cURL stderr fragments, file content
  snippets, or system paths. User-facing error messages are unchanged

## [1.1.5] - 2026-01-27

### Added

- **New `jq_query` tool** - Query saved JSON files without making new HTTP requests
    - Restricted to safe directories (temp, output_dir, cwd)
    - 10MB file size limit
    - Same jq_filter syntax as curl_execute

- **Large response handling** – Automatic handling of responses up to 10MB
    - `jq_filter` parameter for extracting specific JSON data
    - Dot notation for arrays (`.results.0` same as `.results[0]`)
    - Multiple paths support (`.name,.email` returns array, max 20 paths)
    - Array slicing (`.users[0:5]`)
    - Auto-save to file when result exceeds `max_result_size` (default 500KB)
    - `save_to_file` parameter for explicit file saving
    - `output_dir` parameter with `MCP_CURL_OUTPUT_DIR` env var fallback

### Security

- **SSRF protection** – Blocks requests to private networks and internal hosts
    - Private IP ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x
    - IPv4-mapped IPv6 addresses
    - IPv6 private ranges (loopback, link-local, unique local)
    - Internal TLDs: .local, .internal, .corp, .lan, .localhost (case-insensitive)
    - Cloud metadata hostnames: `metadata.google.internal`, `instance-data.ec2.internal`, `metadata.azure.com`
    - DNS rebinding services: `*.nip.io`, `*.sslip.io`, `*.xip.io`

- **DNS rebinding prevention** – DNS resolved before validation, cURL pinned to validated IP via `--resolve`

- **Protocol whitelist** - Only `http://` and `https://` allowed; `file://`, `ftp://`, UNC paths blocked

- **Symlink security** – All paths resolved via `realpath()` before validation to prevent symlink escape attacks

- **Path traversal protection** - Explicit `..` blocking in both `output_dir` and `filepath` parameters

- **Authentication** – Optional bearer token via `MCP_AUTH_TOKEN` env var for HTTP transport

- **Rate limiting** – Dual limits prevent abuse
    - Per-hostname: 60 requests/minute
    - Per-client: 300 requests/minute total

- **Resource limits**
    - jq filter parsing timeout: 100ms (prevents ReDoS)
    - Global memory limit: 100MB across concurrent requests
    - Session idle timeout: 1 hour with automatic cleanup

- **Command allowlist** – `executeCommand()` restricted to `"curl"` only via TypeScript literal type and runtime guard

- **Input validation**
    - CRLF injection protection for headers, user-agent, auth values
    - Per-request unique metadata separator prevents response injection
    - Strict jq_filter validation (unclosed quotes/brackets, leading zeros, safe integer bounds)

- **Localhost access** – Blocked by default; `MCP_CURL_ALLOW_LOCALHOST=true` enables with port restrictions

### Changed

- Maximum response size increased to 10MB for processing (inline result limit remains configurable)
- Negative indices are no longer supported in jq_filter for simplicity and security

## [1.0.2] - 2026-01-23

### Changed

- Increased the maximum response size from 1MB to 4MB to support larger API responses

## [1.0.0] - 2025-12-12

### Added

- Initial release
- `curl_execute` tool for structured HTTP requests with typed parameters
- Support for common HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Authentication options (basic auth, bearer token)
- Request customization (headers, body, form data, user agent)
- Response options (follow redirects, include headers, compressed responses)
- Timeout configuration (1-300 seconds)
- SSL verification control
- JSON metadata output option
- Built-in API documentation resource (`curl://docs/api`)
- Prompt templates for API testing and discovery
- Stdio and HTTP transport support
- Session management for HTTP transport