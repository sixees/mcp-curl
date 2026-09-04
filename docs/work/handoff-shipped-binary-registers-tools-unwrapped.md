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
(`include_headers` without metadata) is filed as `docs/todos/012`.

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
- **Re-serialisation normalises number spelling** one level deeper than before —
  a nested document's `1.50` becomes `1.5`. The top-level residual was already
  stated in `defendJsonLeaves`' docblock; this extends it by one level. Only for
  composite leaves; scalar leaves are untouched and pinned by a test.

## Known issues and limitations

- **`docs/todos/012` is open and is a P1** — the `include_headers`-without-metadata
  arm still deletes fields. Verified on this tree *after* the fix.
- **The `jq_query` instance of that class is `suspected`, not confirmed** — jq
  output is a document whose leaves can themselves be documents. Not executed.
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
- **Gaps:** no case for the `include_headers` arm (that is todo 012's, and it
  would fail); `jq_query`'s coverage is the wrap assertion only, not the splice.

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

- [ ] `docs/todos/012` — the `include_headers` arm. **P1, open.**
- [ ] Settle the `jq_query` instance of the splice class (currently `suspected`).
- [ ] Restate `docs/todos/008`'s acceptance criterion as *one pass per string*.
- [ ] Move `docs/todos/003`'s release boundary to the wrap, not the executor.
- [ ] `docs/todos/011` — correct its DAG block; it now contradicts the tree in
      two places (`tools/ ⇄ extensible/` and the pre-existing `server/ ⇄ extensible/`).
- [ ] Declined, recorded here rather than filed: `NO_HOOKS` is typed `Hooks`
      (mutable arrays) while frozen at runtime. Both reviewers converged; the fix
      is a `ReadonlyHooks` alias in `extensible/types.ts`, which is more than a
      one-liner and nothing pushes to it today.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/012-P1-headers-prefixed-body-is-defended-undivided.md` | P1 | A headers-prefixed body is defended undivided, so the strip pairs tokens across its fields and deletes them | this review round (data-integrity-guardian, performance-oracle) |

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
