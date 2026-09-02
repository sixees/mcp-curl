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
   header channel and the post-processor wrap. That is a deliberate narrowing,
   not a weakening: the decode stage's output is *returned*, so on a channel
   whose consumer does not decode it would manufacture live markup from inert
   bytes (`LESSONS.md` RC-3). What it costs: Step 5 cannot unmask an
   entity-encoded injection phrase on those two channels, so detection is blind
   to that one vector there.

   **Every text channel now calls `defendText`, and what that is worth depends
   entirely on the sentence after it.** `post-processor.ts::processTextPart` —
   the wrap, and the *only* defence for `registerCustomTool()` returns,
   `beforeRequest` short-circuits and YAML endpoint results — takes it with
   `contentTypeUndetermined: true`, because at that boundary the Content-Type
   genuinely is gone. `jq-query.ts::executeJqQuery` takes it declaring
   `JSON_MIME`, which its content is by construction.

   **The grammar a channel declares is where the real coverage question now
   lives.** `defendText` on a JSON document IS sanitise-and-detect: the markup
   and markdown stages are excluded, deliberately, because `<script>` and
   `[a](b)` are legitimate inside JSON string values and `processResponse`
   writes the post-strip content to disk. So "calls `defendText`" is a weaker
   statement than it sounds, and reading it as "is fully stripped" is the same
   mistake this invariant was written about. What the shared call buys is that
   the exclusion is one decision in one place, reviewable, rather than a
   subset each caller assembled. `LESSONS.md` RC-8 records why the JSON arm was
   kept rather than closed.

   **Two results are marked exempt from the wrap's strip stages, and the tag is
   the only thing that could weaken this invariant.** `curl_execute` and
   `jq_query` mark their SUCCESS returns via `post-processor.ts::markDefended`,
   because each already ran this pipeline under the content type the origin
   declared — better information than the wrap has. Neither ERROR return is
   marked. Untagged is the safe default: forgetting the tag costs a redundant
   pass, forging it would cost Steps 3-5, and the symbol is module-private so
   only the second is out of a consumer's reach.

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
    is unbounded in practice, whatever the gate reports. The cap is applied after
    the defence pipeline as well as before it, since `[link removed]` is longer
    than some of the forms it replaces.

## Environments

Local, CI and the consumer runtime are described in
`docs/architecture/architecture.md` → *Development Workflow*. The one difference
that matters and is hardest to reproduce: **the available `curl` build.** Its
protocol support and its `-w` field set vary by version, and a check that passes
here may not hold on a consumer's machine. Anything depending on a specific cURL
feature must degrade legibly rather than assume — invariant 13's `%{size_header}`
dependency fails closed for exactly this reason.
