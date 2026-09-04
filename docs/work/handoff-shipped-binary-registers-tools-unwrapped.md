# Work Handoff: shipped binary registers tools unwrapped

**Date:** 2026-09-04 | **Branch:** fix/shipped-binary-registers-tools-unwrapped | **Plan:** `docs/todos/006-P1-shipped-binary-registers-tools-unwrapped.md` | **Status:** complete

## Summary

`registerAllTools` — the path `src/index.ts` → `runStdio()`/`runHTTP()` →
`registerAllCapabilities()` uses, and therefore the `curl-mcp` bin entry —
registered `curl_execute` and `jq_query` by calling the executors raw, so
invariant 1's post-processor wrap never ran on the shipped binary. Both tools now
register through `extensible/tool-wrapper.ts`, so there is one registration
implementation instead of two.

Routing that path into the wrap then exposed **two P1 defects in the wrap's own
JSON handling** that had been reachable only through `McpCurlServer`: a
remote-chosen nesting depth could switch the whole defence off with 4 KB, and a
string leaf holding a serialised document was scanned undivided, silently
deleting fields. Both are fixed here. A third arm of the second class
(`include_headers` without metadata) was filed as `docs/todos/012` and is
**closed in review round 1** — see *Review Comments Addressed*. It turned out to
be a regression this branch introduced rather than the pre-existing defect it was
filed as (RC-22).

A second, functional defect closed by the same seam: `applyDefaultHeaders` is the
only reader of `MCP_CURL_USER_AGENT` / `MCP_CURL_REFERER` and sat on the wrapped
path alone, so the shipped binary ignored both env vars despite `README.md`
documenting them as applying to every request.

## What was implemented

**The registration seam** — `src/lib/tools/index.ts::registerAllTools` delegates
to `registerCurlToolWithHooks` / `registerJqToolWithHooks` with frozen `NO_HOOKS`
and `NO_CONFIG`. `registerCurlExecuteTool` and `registerJqQueryTool` deleted;
neither was reachable from any of the four `package.json` `exports` entry points,
verified before deletion, so no MAJOR bump. Pattern followed:
`mcp-curl-server.ts::registerToolsOnServer`, the established caller of the same
registrars — the two now agree on the four-key options shape.

**Depth bound** — `response/processor.ts` gained `MAX_INLINE_DEFENCE_DEPTH = 100`
(matching `extensible/schema-sanitizer.ts::MAX_RECURSION_DEPTH`, the project's own
precedent for this shape) checked by `exceedsDefenceDepth`, an **iterative**
probe with an explicit stack — a recursive probe would overflow on exactly the
input it exists to detect. Over the bound the document takes the undivided scan,
which strips rather than throws.

**Nested-document defence** — `defendJsonLeaves`' string arm recurses when the
leaf is itself a **composite** document. The composites-only restriction is
load-bearing, not caution: `JSON_DOCUMENT_FIRST_CHARS` admits digits and `-`, so
a scalar leaf parses too, and recursing into one would re-serialise it — turning
the string `"1.50"` into `"1.5"` and `"007"` into `"7"`. `serialiseWithoutGrowing`
extracted so the growth rule has one implementation across both levels.

**`src/lib.ts`** — the "four call sites" enumeration replaced by a pointer to the
seam. That list was the defect: it read as complete while a fifth site existed.

**Cleanups from review** — dead `McpServer`/`ToolCallback` type imports left by
the deleted registrars; env teardown moved to `afterEach`.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Seam at `registerAllTools`, not inside the executors | `executeCurlRequest`/`executeJqQuery` are exported from `mcp-curl/lib` and consumed by `schema/generator.ts` and `extensible/instance-utilities.ts`, so wrapping inside them changes exported behaviour — invariant 11, MAJOR bump. The seam also keeps the wrap where `enableSpotlighting` and the per-call hostname are in hand. Independently re-derived by `architecture-strategist` rather than taken from the todo | Inside the executors (MAJOR); a new neutral module (larger diff, moves the same import edge) |
| Accepted `tools/` → `extensible/` import | Invariant 10's arrow names only `config/` → `security/` → `tools/` and does not name `extensible/`; no ESM cycle exists because `tool-wrapper.ts` imports `tools/curl-execute.js`, not the barrel. `server/ ⇄ extensible/` is the same shape, pre-existing | Moving the registration machinery into `tools/` — rejected because `tool-wrapper.ts` also imports `extensible/hook-executor.js` and `types.js`, so the edge moves rather than disappears |
| Depth gate **not** in `parseJsonDocument` | `isDefinitelyJson` shares it, so a depth rejection there would remove the JSON exemption from the **persisted** copy and break RC-8/RC-10's persisted/returned split | Gating at the parse for simplicity — rejected on the persisted-artefact risk |
| Over-depth falls back to the undivided scan | Fails in the safe direction: the defence still runs so nothing leaks. A visible placeholder was rejected because `MAX_INLINE_GROWTH_RATIO` is derived from the placeholders, and a third one would make that constant stale and blow `exceedsInlineCap`'s cheap arm | Placeholder substitution; returning the subtree undefended (leaks); dropping it (deletes payload) |
| Composites-only recursion | A scalar has no fields and cannot be spliced, so the arm has nothing to fix there and everything to corrupt | Recursing on anything that parses — rejected, and a positive control pins it |
| ~~`include_headers` arm filed, not fixed~~ **Revised during review** — fixed on this branch (defend-before-compose), based on @chatgpt-codex-connector's and @coderabbitai's feedback; see *Review Comments Addressed* and RC-22 | Needs a different mechanism (two content parts = invariant 11 MAJOR; or defend-before-compose = a second caller on the defence plus an invariant 14 accounting shift). Out of the authorised scope | Folding it in — declined; it deserves its own decision |

## What to pay attention to during review

- **`response/processor.ts::defendJsonLeaves`** is the highest-risk edit. The
  composites-only condition and the depth budget arithmetic
  (`MAX_INLINE_DEFENCE_DEPTH - depth`, then `exceedsDefenceDepth(nested, budget)`)
  are what keep total frames bounded when a nested document sits at depth 40.
- **The wire behaviour changed.** The shipped binary's default User-Agent goes
  from cURL's own to `DEFAULT_USER_AGENT` (browser-like + `mcp-curl/<version>`).
  Documented intent and best practice, but observable to every remote.
- **`--max-time 30` now reaches cURL** where previously only the JS-side
  `executeCommand` ceiling applied. Same 30s, different mechanism (cURL exit 28
  rather than an abort). Found by `architecture-strategist`; I had verified the
  timeout's *value* was equivalent and not its *mechanism*.
- ~~**Re-serialisation normalises number spelling**~~ — **superseded in review
  round 2, and the framing was the defect.** "Normalises spelling" and
  "`9223372036854775807` returns `9223372036854776000`, `1e400` returns `null`"
  are the same mechanism at two magnitudes, and this bullet named only the
  comfortable one. Numbers now keep the origin's own lexeme where the host has
  `JSON.rawJSON`. RC-24.

## Known issues and limitations

- ~~**`docs/todos/012` is open and is a P1**~~ — **closed in review round 1.**
  The arm is fixed (body defended as its own region before composition) and the
  todo is removed. Left visible rather than deleted because the *reason* it was
  filed matters: the scope call behind it was wrong, which is RC-22.
- ~~**The `jq_query` instance of that class is `suspected`**~~ — **settled in
  review round 1: it does not apply.** `executeJqQuery` returns one string with
  nothing prefixed to it, so the composed-string arm cannot be reached, and both
  shapes jq can emit are now pinned by tests.
- **12 pre-existing `tsc --noEmit` errors**, all in `*.test.ts`, none in touched
  files. Pre-existing; declined, not deferred.
- **`createInstanceUtilities().executeRequest`/`queryFile` still return
  unwrapped.** Pre-existing, direct-execution API rather than a model-facing
  path. Flagged by `architecture-strategist`.
- **`mcp-curl/lib` exports neither `registerAllTools` nor
  `registerAllCapabilities`**, so a `./lib` consumer hand-building a server
  cannot reach the wrapped built-in tools. Pre-existing.
- **Notes for existing todos:** `008`'s criterion ("exactly one `defendForInline`
  call") is no longer satisfiable as written — the wrap's pass is over a different
  string and load-bearing; restate as *one pass per string*. `003`'s proposed
  release boundary is now in the wrong place — the wrap allocates after
  `executeCurlRequest` returns.

## Testing summary

- **Added:** `src/lib/tools/register-all-tools.test.ts`, 17 cases on a path that
  previously had **zero** coverage. Mocks only the subprocess boundary; the real
  executor, `processResponse`, `defendText` and the wrap all run.
- **Suite:** 1206 collected, 1199 passed, 0 failed, 7 skipped. Verdict parsed
  structurally from `npm test -- --reporter=json` (`numFailedTests: 0`), not from
  a summary line. **Note:** `plugin:commands/work.md` classes vitest as having no
  trustworthy structured mode, so treat this as evidence rather than
  certification — your own run before authorising the push is the floor.
- **Teeth verified by probe**, `cp`-backed and restored byte-identical each time:
  removing the depth guard fails 2 cases; reverting the string arm fails 2; a bare
  `jq_query` registration fails 1; letting the arm recurse into scalars fails the
  `"1.50"` control. The original seam probe fails the beacon assertion and both
  User-Agent assertions.
- **Shipped binary re-verified end-to-end** over stdio against a local origin:
  beacon stripped, deep nesting defended, all four fields kept, scalars intact,
  **zero `wrap-error` lines** (a wrap-error would mean fail-open fired).
- **Gaps:** none of the originally listed ones remain. The `include_headers`
  arm and `jq_query`'s splice coverage were both closed in review round 1; see
  that section for what replaced them.

## Commit history

```
e6ad205 fix(response): bound the inline defence's depth and defend nested documents region-wise
a778b88 fix(tools): route the shipped binary's tool registration through the defence wrap
```

## Review context

Suggested order: `src/lib/tools/index.ts` (the seam) → `src/lib/response/processor.ts`
(the two defence fixes) → `src/lib/tools/register-all-tools.test.ts` (what holds
them). `ARCHITECTURE.md` invariants 1, 1a, 10, 11, 14, 15, 16 all bear on this;
`LESSONS.md` RC-1, RC-6, RC-8, RC-10, RC-16 and RC-17 are the prior art
`learnings-researcher` surfaced.

## Reality Corrections

**RC-20 — Routing a path into a shared defence inherits the defence's defects, and "the guard now runs" is not "the payload survives"**

- **Plan said:** todo 006 scoped one seam; the registration fix was "not a
  public-contract change". Both correct.
- **Reality:** the wrap had never run on that path, so routing traffic in exposed
  two P1s. Measured: `depth 2000 → bodyBytes=4035 → beaconReachedModel=true`
  with `[wrap-error] RangeError`; and
  `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` →
  `{"a":"open ","d":"kept"}` under `include_metadata: true`.
- **Correction:** depth bound + composites-only string-leaf recursion in
  `response/processor.ts`; `include_headers` arm filed as todo 012.
- **Files:** `src/lib/response/processor.ts::defendForInline`,
  `::defendJsonLeaves`, `::exceedsDefenceDepth`, `::serialiseWithoutGrowing`.

**RC-21 — A regression guard for a two-path invariant asserted it on one path, so the other could revert with the suite green**

- **Plan said:** todo 006's acceptance criterion was singular, and the new test
  satisfied it.
- **Reality:** `registerAllTools` registers two tools; the guard asserted the wrap
  for `curl_execute` and only name presence for `jq_query`, so a bare
  `registerTool("jq_query", …)` passed the whole suite — recreating todo 006's
  precondition on the sibling tool. Found independently by two reviewers.
- **Correction:** `jq_query` wrap assertion added; teeth verified.
- **Files:** `src/lib/tools/register-all-tools.test.ts`,
  `src/lib/tools/index.ts::registerAllTools`.

Both are recorded in `LESSONS.md` as RC-20 and RC-21.

## Follow-up work

- [x] `docs/todos/012` — the `include_headers` arm. **Closed in review round 1**
      (regression of this branch, not pre-existing — RC-22).
- [x] Settle the `jq_query` instance of the splice class — settled: does not
      apply, and pinned by two tests.
- [ ] Restate `docs/todos/008`'s acceptance criterion as *one pass per string*.
- [ ] Move `docs/todos/003`'s release boundary to the wrap, not the executor.
- [ ] `docs/todos/011` — correct its DAG block; it now contradicts the tree in
      two places (`tools/ ⇄ extensible/` and the pre-existing `server/ ⇄ extensible/`).
- [ ] Declined, recorded here rather than filed: `NO_HOOKS` is typed `Hooks`
      (mutable arrays) while frozen at runtime. Both reviewers converged; the fix
      is a `ReadonlyHooks` alias in `extensible/types.ts`, which is more than a
      one-liner and nothing pushes to it today.

### Outstanding Todos

**None.** `docs/todos/012` was the only entry and it was closed in review round 1
— the resolved record is in that section's *Resolved Todos* table.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/006-P1-shipped-binary-registers-tools-unwrapped.md` | The shipped binary registers curl_execute and jq_query without the defence wrap | `registerAllTools` now registers both tools through `extensible/tool-wrapper.ts`, so invariant 1's wrap applies on the shipped binary. Both plain registrars deleted; `src/lib.ts`'s stale enumeration replaced by the seam. All three acceptance criteria met | Claude Code | 2026-09-04 |

## Code Review — 2026-09-04

**Certification:** complete
**Roster closure:** closed. `unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"`; `unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under notes: and no finding"`; `unresolved: performance-oracle → same catch-all wording`; `unresolved: data-integrity-guardian → "Anything else outside your lane…"`

8 reviewers dispatched, 8 `done`, 0 failed. `/security-review` returned
`reviewer_status: "ok"`, 0 findings, count reconciled against the JSONL.

| Class | Severity | Reviewers | Disposition | Todo |
|---|---|---|---|---|
| Depth → silent wrap bypass | P1 | performance | fixed in `e6ad205` | — |
| Composite-region splice deletes fields | P1 | data-integrity + performance | fixed in `e6ad205`; third arm filed | 012 |
| `jq_query` wrap asserted nowhere | P1 | security + typescript | fixed in `e6ad205` | — |
| Dead type-only imports | P3 | simplicity + typescript | fixed in `e6ad205` | — |
| Env-stub teardown leaks on failure | P3 | typescript | fixed in `e6ad205` | — |
| Frozen `NO_HOOKS` typed mutable | P3 | security + typescript | declined — not a one-liner, nothing pushes to it | — |
| `tools/ ⇄ extensible/` mutual at directory granularity | P3 | architecture | declined — belongs to todo 011 | — |

Rejected: none — every class carried a confirmed instance and a failure scenario.
Two slug collisions were **not** merged (`broken-contract` on two distinct
classes; `convention-drift` on two others) because instance overlap is the merge
mechanism, not the slug. The depth and splice classes were kept separate despite
both confirming `defendJsonLeaves`, per `performance-oracle`'s explicit warning.

**Verified claims:** suite pass — re-run, 1199 passed. Patterns followed — the new
registration matches `registerToolsOnServer`, confirmed by
`pattern-recognition-specialist`. Deletion safe — invariant 11 re-verified
independently by three reviewers against `package.json` `exports`. Wrap coverage
complete — `rg 'registerTool('` is 4 sites, all wrapped.

**Caveat:** `code-simplicity-reviewer` (floor, `tools:` pinned without `Bash`) did
not declare its whole-file shortfall; it judged the modified files whole. A
caveat on what it read, not grounds for discarding its finding — which was
confirmed independently.

**Blockers:** none. Three P1s were found and all three are fixed on this branch;
the one open P1 (todo 012) is a separate class arm outside the authorised scope,
recorded rather than carried.

> **POST-AUDIT (round 1, Surface 3):** the scope call in the sentence above is
> the one RC-22 corrects — `012` was a regression this branch introduced, not a
> separate pre-existing arm, and it is now fixed and closed. The paragraph is
> left as written because it records what this round concluded; the correction
> belongs beside it, not in place of it.

## Review Comments Addressed — 2026-09-04

Surface 3, round 1. `@coderabbitai` and `@chatgpt-codex-connector` both
requested explicitly; both responded inside the 15-minute window. 6 entries
returned: 4 inline threads, 1 codex review summary, 1 CodeRabbit command
acknowledgement (`ack: true`).

**Two bots, three distinct classes, two of them mine.** Codex's P1 and
CodeRabbit's first Major are the same class reported from two anchors and were
dispositioned together.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Keep headers separate from the body before wrapping (`tools/index.ts:63`) — merged with *Keep `include_headers` metadata and body in separate defence regions* (`processor.ts:372`) | codex (P1) + coderabbit (Major) | Fix needed — **P1, in scope, regression of this branch** | `curl-execute.ts` now defends the body as its own region before `formatResponse` composes it. 6 new cases at the registration boundary; teeth verified (reverting fails 3). Closes `docs/todos/012` |
| Preserve `__proto__` when rebuilding nested documents (`processor.ts:507`) | codex (P2 → **re-derived P1**) | Fix needed — P1, in scope | `defendJsonLeaves`' object accumulator is now `Object.create(null)`. 2 new cases, fixtures written as literal JSON; teeth verified (reverting fails 2) |
| — (found while settling `012`'s last criterion) | — | Test gap closed | 2 `jq_query` splice cases, settling the instance `012` recorded as `suspected`: it does not apply, and is now asserted rather than argued |

**Severity re-derivation.** Codex graded the `__proto__` finding P2. Re-derived
to **P1** on consequence: it deletes a field the origin sent, silently, leaving
valid JSON — `review-findings` puts data loss reachable by normal use at P1, and
the mechanical `medium → P2` mapping is where that grading starts rather than
where it ends. Both bots graded the header arm at merge-blocking level and that
grade stands.

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Preserve JSON regions when depth exceeds `MAX_INLINE_DEFENCE_DEPTH` — replace the over-depth fallback with a region-preserving defence, and add a depth-101 cross-field-marker test (`processor.ts:370`) | coderabbit | **P3** (bot: Major) | In scope — the fallback is this branch's code | **The mechanism is real and the population is empty.** Reaching it needs a document nesting past 100 *and* carrying a marker pair split across two of its fields. Real payloads nest in the tens (a Lighthouse result), and a remote that constructs the pathological case is deleting fields from a response it already controls end to end — it gains nothing it could not achieve by sending the shorter document directly. The alternatives were weighed and recorded when the bound was added: leaving the subtree undefended **leaks**, dropping it **deletes more**, and a placeholder breaks `MAX_INLINE_GROWTH_RATIO`, which is derived from the existing placeholder lengths — so the undivided scan is the arm that fails in the safe direction. Stated as a residual on `MAX_INLINE_DEFENCE_DEPTH` before review, not discovered by it. `.claude/rules/42-ship-what-matters.md` → the population test; K-14 |

### Decisions Revised

| Original decision | New approach | Reason | Reviewer |
|---|---|---|---|
| *"`include_headers` arm filed, not fixed — needs a different mechanism (two content parts = invariant 11 MAJOR; or defend-before-compose = a second caller plus an invariant 14 accounting shift). Out of the authorised scope"* | Fixed on this branch, defend-before-compose, **no MAJOR bump and no accounting shift** | Both feared costs were measured rather than assumed, and neither materialised. `defendForInline` is **idempotent at zero growth** on an already-defended region (6 shapes measured), so the wrap's later pass over the composed text changes nothing — the second caller is the same shared function, not a second implementation. And invariant 14 is *tighter*, not shifted: the gate already weighed `defendForInline(body)`, and the returned body is now exactly those bytes instead of the undefended form the wrap grew back. The scope call was also simply wrong — see RC-22 | codex, coderabbit |

**The scope reversal is the substantive change of this round.** `012` was filed
as pre-existing and out of scope on a measurement that only asked whether the
defect survived the fix. It did — and on the shipped binary it did not exist
*before* it, because the raw registration never ran the defence over the composed
string. Filed under `**Key decisions**` above as superseded; RC-22 carries the
measurement and the method that missed it.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/012-P1-headers-prefixed-body-is-defended-undivided.md` | A headers-prefixed body is defended undivided, so the strip pairs tokens across its fields and deletes them | Body defended as its own region before composition in `curl-execute.ts`. All six acceptance criteria met: four keys survive; script and style pairs survive; the beacon still strips on that arm; the unpaired-opener positive control holds; invariant 14 re-derived (gate bytes == returned bytes); and the `jq_query` instance is shown not to apply and pinned by two tests | Claude Code | 2026-09-04 |

### Outstanding Todos

None. This round filed **0** todos and closed **1**, so the branch is
net-negative on its own.

### Files Modified

- `src/lib/tools/curl-execute.ts` — body defended as its own region before composition
- `src/lib/response/processor.ts` — null-prototype accumulator in `defendJsonLeaves`
- `src/lib/tools/register-all-tools.test.ts` — 8 new cases (6 header-arm + proto, 2 jq_query)
- `LESSONS.md` — RC-22, RC-23
- `dist/` — rebuilt

**Testing:** 1208 passed, 0 failed, 7 skipped (was 1199/0/7). Build clean.
Shipped binary re-verified end-to-end over stdio: **7/7**, including the two new
cases, with **zero `wrap-error` lines**.

## Review Comments Addressed — round 2 — 2026-09-04

9 entries returned, 6 of them new inline threads (4 codex, 2 CodeRabbit). The
other 3 are `kind: "issue"` entries with no resolved state — the codex review
summary and two CodeRabbit command acknowledgements — which return on every
fetch and were dispositioned in round 1.

**This round reviewed round 1's fixes, which is the expected shape.** One of its
findings is a P1 that round 1's own fix introduced.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Preserve JSON numbers when defending the body (`curl-execute.ts:287`) | codex (P1) | Fix needed — **P1, in scope, introduced by this branch** | `keepNumberLexeme` re-emits each number's original text via `JSON.rawJSON`, behind a load-time capability probe. 5 new cases; teeth verified (reverting fails 4). RC-24 |
| Skip inline defence when the body was saved (`curl-execute.ts:287`) | codex (P2) | Fix needed — P2, in scope, contained | Gated on `bodyIsReturned`, mirroring the condition `formatResponse` itself branches on. 1 new case guarding the **premise** — that the file branch returns the message and not the body — since the skip has no observable behaviour of its own |
| Force header capture on in-memory header tests (`register-all-tools.test.ts:48`) | codex (P2) | Fix needed — P2, in scope. **Mechanism right, consequence wrong** | `platformSupportsHeaderDump` stubbed `true`, and `bodyAfterHeaders` now asserts the prefix is present. The claim that the cases *"remain green if the fix is removed"* is measured **false** — they fail on a Linux runner too, because the unsupported-host notice is itself a prefix that breaks the JSON parse. What was really wrong is the guard's **subject**, not its teeth. RC-25 |
| Update all `docs/todos/012` status entries in the handoff (`handoff…md:19`) | coderabbit (Minor) | Documentation — inside the diff | 5 stale entries reconciled across *Known issues*, *Gaps*, *Follow-up work* and *Outstanding Todos*. The dated Surface-2 record was **not** rewritten — it carries a `POST-AUDIT` pointer instead, since retro-editing a past round's conclusion is what `.claude/rules/03-divergence.md` forbids |
| Add shipped-path coverage for `MCP_CURL_REFERER` (`register-all-tools.test.ts:186`) | coderabbit (Trivial) | Fix needed — P3, one-liner | Added. `applyDefaultHeaders` reads both env vars through one resolver, so covering one of two values is the shape RC-21 named |
| — (found while probing) | — | Guard given teeth | `isCompositeValue`'s raw-number arm had **no teeth** — removing it changed nothing. A whitespace-padded numeric string does: `" 123"` → `"123"`. Added to the scalar control, which now fails when the arm is removed |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Preserve saved paths through the new wrapper (`tools/index.ts:67`) — a chosen output directory such as `/tmp/[v](file:data)` has its path rewritten to `[link removed]` in the saved-file message, so the caller is told a path that does not exist | codex | **P3** (bot: P2) | In scope — this branch's wrap introduced it | **Correct mechanism, empty population.** It needs an operator to have named an output directory in markdown-link form with a dangerous scheme inside it — `[v](file:data)`. Ordinary paths, including every path this server generates itself, pass through untouched. The honest fix moves the filepath out of the defended text part, which means a second content part and so widening the exported `CurlExecuteResult.content` 1-tuple — an invariant 11 MAJOR bump for a directory name nobody has. `.claude/rules/42-ship-what-matters.md`: name the population, and where it is empty, decline and write down why. Reversible in one line if a real operator ever hits it |

### Decisions Revised

| Original decision | New approach | Reason | Reviewer |
|---|---|---|---|
| Numeric re-spelling is a cosmetic residual of the region-wise walk — *"nothing reads meaning from that spelling on an inline copy"* | Numbers keep the origin's own lexeme where the host supports it | The residual's stated example was the harmless member of its class. Same mechanism, larger magnitude: a 64-bit id returns rounded and `1e400` returns `null` | codex |

### Reality Corrections

**RC-24** — the number rewrite, and the fail-open the obvious fix would have
introduced. **RC-25** — a guard with teeth but the wrong subject, plus a guard
with no teeth at all. Both in `LESSONS.md`.

**A near-miss worth reading before the next change to this file.** The clean fix
for RC-24 is `JSON.rawJSON`, which landed in **Node 21**. `README.md` declares a
floor of **Node 18** — in `docs/getting-started.md` and `docs/architecture/architecture.md`, not `README.md` — and `package.json` declares **no `engines` field at all**,
so an older host is reachable — and there the call throws inside
`defendForInline`, `createWrapper` catches it, and the **undefended** result is
tagged as wrapped. That is RC-20's P1, reintroduced by a fidelity fix. It was
written and typechecked before the floor was checked, and is now behind a
load-time capability probe.

**Open question for the operator, not acted on:** raising the floor to Node ≥22
would make lexeme preservation unconditional and let the probe be deleted. Both
Node 18 and 20 are EOL as of this date. That is a packaging decision.

### Convergence note

`defendForInline`'s JSON handling has now produced findings in **three
consecutive rounds** — Surface 2 (depth bound, nested-leaf splice), round 1
(header composition, prototype keys), round 2 (number lexemes).
`.claude/rules/42-ship-what-matters.md` says a change that has not settled in two
rounds is too intricate for its value and should be cut rather than fixed a
third time.

**Stated rather than acted on, because the cut is not available here and the
choice belongs to the operator.** The region-wise walk exists because RC-16: a
serialised document scanned undivided loses whole fields. The two arms are
region-wise (which was rewriting numbers) or undivided (which deletes fields) —
both lose payload. Round 2's fix is the third arm, which loses neither, so it is
a reduction in the residual set rather than another layer on it. But the pattern
is real and worth the operator's eye.

### Outstanding Todos

None. This round filed **0** and closed **0** (round 1 closed the only one).

### Files Modified

- `src/lib/response/processor.ts` — `keepNumberLexeme`, capability probe, opt-in lexeme parse, three walk guards, corrected docblock
- `src/lib/tools/curl-execute.ts` — save-path skip
- `src/lib/tools/register-all-tools.test.ts` — 7 new cases, capability stub, self-verifying header assertion
- `LESSONS.md` — RC-24, RC-25
- `docs/work/handoff-…md` — stale `012` entries reconciled, `POST-AUDIT` pointer
- `dist/` — rebuilt

**Testing:** 1215 passed, 0 failed, 7 skipped (was 1208). `tsc --noEmit` clean in
touched files. Shipped binary **10/10** over stdio with zero `wrap-error` lines,
including `{"id":9223372036854775807,"exp":1e400,"pi":3.140}` returned
byte-exact.

## Review Comments Addressed — round 3 — 2026-09-04

8 entries, 4 of them new inline threads (3 codex, 1 CodeRabbit). The other 4 are
`kind: "issue"` entries with no resolved state — the codex review summary and
three CodeRabbit command acknowledgements — dispositioned in earlier rounds.

**No code changed this round.** Two P1s survived triage and both have fixes that
change a published contract, so they are escalated rather than taken; the third
finding is declined on its population. This is the round where the convergence
rule flagged in round 2 came due — see *The layer, not the arm*.

### Changes Made

None. Documentation only: RC-26 and this section.

### Escalated — awaiting the operator

| Comment | Reviewer | Severity | Scope | Why it is not mine to take |
|---|---|---|---|---|
| **Keep JSON keys out of the composed-text scan** (`curl-execute.ts:297`) — `{"<!--":"a","b":"secret","-->":"c","d":"kept"}` returns `{"":"c","d":"kept"}` under `include_headers: true` | codex | **P1** | In scope — round 1's fix is incomplete, and this arm is this branch's regression | Round 1 defended the body's **values** region-wise. `defendJsonLeaves` deliberately leaves **keys** undefended — its own docblock states why, and states the residual — so the prepass cannot make the body marker-free and the wrap's undivided pass still pairs across keys. Both candidate fixes change a published contract: **(a)** two content parts, which widens the exported `CurlExecuteResult.content` 1-tuple → invariant 11, MAJOR; **(b)** make `include_headers: true` use the JSON envelope, which changes the response shape for that flag combination without touching the type. RC-26 |
| **Preserve numeric lexemes on every supported Node runtime** (`processor.ts:157`) — the round-2 capability probe leaves the corruption in place on Node 18 and 20 | codex | **P1** | In scope | Correct, and it is the question round 2 already put to the operator, now arriving as a finding. Both docs declare the floor at 18 — `docs/getting-started.md:7` **and** `docs/architecture/architecture.md:16`. (An earlier draft of this row cited `README.md:16`; that was wrong — `README.md` declares no floor at all.) The remedies are codex's own two: a hand-written lossless tokeniser inside the defence, or **raise and enforce** the floor (`engines: { node: ">=22" }` plus both docs). The second is a one-line change and my recommendation — Node 18 and 20 are both EOL as of today — but it changes who can install the package, which is a packaging decision |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| **Preserve duplicate JSON members** (`processor.ts:586` and `processor.ts:442`) — `{"a":1,"a":2,"kept":"ok"}` returns `{"a":2,"kept":"ok"}`; reported by both bots, merged on instance overlap | codex (P2) + coderabbit (Major) | **P3** (re-derived down) | In scope | **The loss is invisible to any consumer that could have used it.** Measured: plain `JSON.parse`/`JSON.stringify` returns exactly the same `{"a":2,"kept":"ok"}`, so an agent parsing the response collapses the duplicate identically — the earlier member is unreachable downstream whether this defence runs or not. RFC 8259 says names SHOULD be unique and leaves the behaviour of duplicates undefined, so there is no correct value to preserve. The population is an API that deliberately returns duplicate names *and* a consumer that reads the first rather than the last, and the second half of that does not exist here. The suggested remedy — tokenise instead of reconstructing — is new parsing machinery inside the defence, priced against a value nothing downstream can read. `.claude/rules/42-ship-what-matters.md`; K-14 |

### The layer, not the arm

Round 2 recorded that `defendForInline`'s JSON handling had produced findings in
three consecutive rounds, and flagged the convergence rule without acting on it.
Round 3 is the fourth, and the pattern is now legible:

| Round | Arm found | Fix |
|---|---|---|
| Surface 2 | over-depth bypass; nested-leaf splice | depth bound; nested arm |
| 1 | composed prefix splices across **values** | defend the body pre-composition |
| 3 | composed prefix splices across **keys** | — none available at this layer |

`skill: pr-resolver-safety`'s escalation ladder names this exact situation at its
third rung: *recognise that no fix exists at that layer, and move the
precondition to the caller.* The wrap receives one string and **cannot** recover
where the header block stopped — a server-authored prefix and a remote body are
syntactically indistinguishable — so each fix closes whichever marker shape the
last reviewer happened to choose. Naming the layer is the finding.

**Recommendation, for the operator's decision:** take option (a) — headers and
body as separate content parts — and accept the MAJOR bump. It closes the class
rather than an arm, removes the pre-composition prepass entirely rather than
extending it, and subsumes the saved-path finding declined in round 2 for the
same structural reason. Option (b) is cheaper and closes the same class, at the
cost of changing what `include_headers: true` returns.

**Until that decision, the residual is:** `include_headers: true` with
`include_metadata: false` deletes fields when a remote puts a comment, script or
style marker pair in two different **object keys**. Values are safe. This is a
regression of this branch and is not present on `main`.

### Outstanding Todos

None filed. **Two P1s are escalated and undispositioned**, which per
`plugin:compound/compound-engineering-core.md` → *Authorisation gates* is the
absence of a disposition and blocks the merge until the operator settles them.
No todo is filed for either, because filing one would convert a decision the
operator has not yet made into a promise on their behalf.

### Files Modified

- `LESSONS.md` — RC-26
- `docs/work/handoff-…md` — this section

**Testing:** unchanged from round 2 — 1215 passed, 0 failed, 7 skipped. No code
changed, so no new verification was warranted.

## Review Comments Addressed — round 4 (operator dispositions) — 2026-09-04

Round 3's two escalations came back from the operator. No new review round was
requested; this section records their decisions and the work that followed.

### Changes Made

| Escalation | Operator decision | Action taken |
|---|---|---|
| Numeric lexemes lost on Node 18/20 (`processor.ts:157`, codex P1) | *"we will only run this on node 22 and above, so no need to support node 18"* | Floor raised: `engines: { node: ">=22" }` added to `package.json` (which previously declared none), `docs/getting-started.md:7` → *Node.js 22 or later*, `docs/architecture/architecture.md:16` → *Node ≥22 ESM*. The capability probe is **deleted** and lexeme preservation is now unconditional, so there is one numeric behaviour rather than one per host. The 5 number tests no longer skip on any runtime |

**One thing the decision did not cover, decided here and flagged.** `engines` is
**advisory**: npm warns on a too-old host and installs anyway unless the operator
has set `engine-strict`. So declaring Node ≥22 makes an older runtime
*unsupported*, not impossible — and there `JSON.rawJSON` is `undefined`, the call
throws inside `defendForInline`, and `createWrapper` tags the **undefended**
result as wrapped. That is RC-20's fail-open, which is exactly what the round-2
probe existed to avoid; deleting the probe without replacing it would have
reintroduced it.

The probe is therefore replaced by an **import-time throw** naming the runtime
(`processor.ts`), so a too-old host fails loudly at load rather than silently
bypassing the defence on every request. Teeth verified: stubbing the pair absent
produces *"mcp-curl requires Node >= 22: … Detected v24.18.0."* RC-24 updated
with the resolution.

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| **Keep JSON keys out of the composed-text scan** (`curl-execute.ts:297`) — `{"<!--":"a","b":"secret","-->":"c","d":"kept"}` returns `{"":"c","d":"kept"}` under `include_headers: true` | codex | **P3** (bot: P1; **round 3 escalated it as P1 — that grade was wrong**) | In scope — this branch's regression | **Declined on the population, and this reverses my own round-3 escalation.** The arm is real and measured. What round 3 failed to do is apply the population test that had already declined three other findings on this PR: the difference between this arm and the value arm fixed in round 1 is *where* the marker sits. A **value** carrying `<!--` is ordinary traffic — any API returning HTML fragments in JSON produces one, which is why the value arm was a genuine P1. An **object key** named `<!--` is not something a JSON API emits; keys are identifiers. The remaining author of such a response is an attacker, who controls the whole body already and gains nothing by deleting fields from it. So the population is empty in practice, and the fix costs a public-contract change — `.claude/rules/42-ship-what-matters.md`, K-14 |

**Residual, documented rather than fixed:** `include_headers: true` with
`include_metadata: false` deletes fields when a remote puts a comment, script or
style marker pair in **two different object keys**. Values are safe. Not present
on `main` before this branch. Reverses in one line of scope if a real API ever
emits marker-bearing keys.

**On the operator's stated reason.** The decision was given as *"we agreed
functionality over security"*, and the outcome is right while that reason points
the other way: the field deletion **is** the functionality loss here, and the
defence is what causes it — so read literally, that principle argues for fixing
this arm, not accepting it. What actually justifies the decline is the population,
which is why the row above is written on that basis. Recorded so a later round
re-reading this does not inherit a justification that does not hold.

### The layer question, now settled by the decline

Round 3 recommended separate content parts to close the composed-string class
rather than its arms, and priced it at a MAJOR bump. **With the key arm declined
on population, that recommendation lapses** — there is no remaining arm with a
real population, so the layer change would be paid for entirely by cases nobody
meets. `.claude/rules/03-divergence.md`: settled, and a later round proposing the
content-part split is answered by citing this row rather than re-deriving it.
Reopen only on a concrete case.

### Outstanding Todos

None. 0 filed across all four rounds; 1 closed (`012`).

### Files Modified

- `package.json` — `engines: { node: ">=22" }`
- `docs/getting-started.md`, `docs/architecture/architecture.md` — floor raised
- `src/lib/response/processor.ts` — probe deleted, lexeme preservation unconditional, import-time runtime guard, stale fallback prose removed
- `src/lib/tools/register-all-tools.test.ts` — 5 number tests un-skipped
- `LESSONS.md` — RC-24 citation corrected (`README.md` → the two docs that actually declare it) and resolution recorded
- `dist/` — rebuilt
