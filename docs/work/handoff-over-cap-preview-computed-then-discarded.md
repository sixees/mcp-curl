# Work Handoff: over-cap preview computed then discarded

**Date:** 2026-09-06 | **Branch:** fix/over-cap-preview-computed-then-discarded | **Plan:** `docs/todos/008-P2-over-cap-preview-is-computed-then-discarded.md` | **Status:** complete

## Summary

On the over-cap path `processResponse` defended the *entire* response body, truncated
the result to `max_result_size`, and returned it as a preview that `formatResponse`
then discarded without ever reading — 91 ms of a 197 ms call on a 9.4 MB body,
producing nothing the model saw. The preview is gone; the saved-response `message`
now names `jq_query` and the path, so the body stays reachable. Verifying that the
new message was truthful uncovered a second, larger defect: the jq path corrupted
number lexemes that the inline path preserved, so the same body's 64-bit ids
survived intact inline and were silently rounded through jq. The operator authorised
growing this change to fix it.

## What was implemented

**The over-cap preview (todo 008).**
- `response/processor.ts::processResponse` — the `defendForInline` + byte-cut block on
  the save arm is deleted. The arm returns `savedToFile`, `filepath` and `message`.
- `types/response.ts::ProcessedResponse` — `content` removed from the saved arm, so
  the raw body is unreachable there by construction. Internal type; exported from
  none of the four npm entry points, so invariant 11 is untouched.
- `tools/curl-execute.ts` — the `bodyIsReturned` gate collapses into a `savedToFile`
  branch passing `""`; the narrowed union removes the possibility of the two branches
  disagreeing about which shape reads the body.
- `message` gained two arms. `save_to_file` is a request, not a limit — claiming the
  body "exceeded the inline limit" when the caller asked for the file would be a
  server-authored falsehood about the caller's own request.

**Number lexemes across the jq path (RC-27, authorised scope growth).**
- New `utils/json-lexeme.ts` holds `keepNumberLexeme`, `rawJson`, `isRawNumber`.
  Previously private to `processor.ts`, which is why two sibling sites never got it.
- `jq/filter.ts::applyJqFilter` and `processor.ts::processResponse`'s Step 6 branch
  both parse with the reviver.
- `jq/filter.ts::isRecord` gained an `isRawNumber` arm — a marker is an object at
  runtime, so without it `.pi.rawJSON` returned `"3.140"` and leaked the internal
  representation.

**Out-of-scope one-liner.** `ARCHITECTURE.md` claimed re-serialising normalises number
spelling (`1.50` → `1.5`). RC-24 made that false in PR #36 and the doc was never
updated (K-7). Corrected in place.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Drop the preview rather than bound it | Operator's call. A 500 KB slice of a 2 MB JSON body is unparseable, so surfacing it burns context for something the model cannot `jq`. The file + `jq_query` is the payload route. | Surface a bounded preview (MINOR, additive field); surface only for non-JSON content types |
| Remove `content` from the saved arm | Without it the field becomes the full raw body — undefended, uncapped — on a type identical to the inline arm's. Invariant 14 would rest on nobody reading it. Pins the limit in the type, as `6900adb` did for invariant 2. | Keep the field with a doc-block warning |
| Name `jq_query` in the message | Dropping the preview removes the model's only inline view; this is what keeps the body reachable. Verified end-to-end, not assumed. | Bare filepath (previous behaviour) |
| Grow scope to fix the jq lexeme class | Operator's call after escalation. This change makes `jq_query` the advertised route for large bodies, so shipping the message while that path rounds 64-bit ids would be directing traffic onto a lossy path. | File as a P1 todo and ship as-is; drop the `jq_query` pointer |
| Ratio-based perf assertion, not a millisecond budget | An absolute budget wide enough not to flake on a slow runner is wide enough to pass with the defect present — the trade `strip-blocks.test.ts` names at `REDOS_BUDGET_MS`. | Absolute budget; no perf assertion at all |

## What to pay attention to during review

- **`curl-execute.ts` now passes `""` as `stdout` on the saved path.** Correct only
  because `formatResponse`'s saved branch ignores that parameter. Both new processor
  tests deliberately pass the *real body* there instead, so they would catch that
  branch starting to read it.
- **Marker leakage is the risk the jq fix introduces.** A `JSON.rawJSON` marker is an
  ordinary object. `isRecord` is guarded; any *new* structural test in the jq
  navigator (`Array.isArray`, `typeof === "object"`, a `.length` read) needs the same
  guard. `processor.ts` already carries three such guards for the same reason.
- **The two jq sites are separate parses.** `jq_query` and `curl_execute --jq_filter`
  do not share one, and an assertion on either says nothing about the other — that is
  how the class kept an uncorrected site through RC-24. Probed: restoring one reviver
  alone still fails the other's tests.
- `processor.ts:157`'s `preserveNumberLexemes` opt-out is deliberate, not a fourth
  bypass — `isDefinitelyJson` throws the graph away. **Correction from review:** this
  originally also credited "the persisted path, pinned by RC-8/RC-10". That is wrong —
  `saveResponseToFile` never calls `parseJsonDocument` or `JSON.parse` at all, so
  RC-8/RC-10 are preserved by never parsing rather than by a `false` flag. There is
  one `false` caller, not two.

## Known issues and limitations

- **`MCP_CURL_ALLOW_LOCALHOST` does not unblock a literal `127.0.0.1`.** `isBlockedHostname`
  rejects it at `security/ssrf.ts:92`, before the localhost arm that reads the flag at
  `:109`. The documented escape hatch therefore works for the `localhost` spelling and
  not for the IP form of the same address. Found while building the smoke harness;
  pre-existing, untouched, not filed — surfacing it here rather than growing scope twice.
- The perf guard is a timing assertion. It is self-calibrating (a ratio against the same
  body processed inline in the same run) and the measured bands are far apart — 1.04–1.15
  fixed against 1.93–2.20 with the defect — but it is still the only test here that could
  flake under extreme scheduler pressure.
- `dist/` is committed. It is rebuilt and included; the chunk hashes change.

## Testing summary

**Runner and mode:** `npm test -- --reporter=json --outputFile=…`, verdict parsed from the
JSON artefact's `numPassedTests`/`numFailedTests`/`numTotalTestSuites`, not from a summary line.

**Result after review round 1: 1250 passed, 7 skipped, 272 suites — net +36 tests.**

**Read the failure line honestly: a full-suite run is NOT clean, on this branch OR on
`main`.** Four runs each, measured today on this machine:

| | run 1 | run 2 | run 3 | run 4 |
|---|---|---|---|---|
| this branch (`cc69dc2`) | 1248 / 3 failed | 1250 / 1 | 1249 / 2 | 1250 / 1 |
| `main` (`5adb7d3`, clean worktree) | 1213 / 2 failed | 1214 / 1 | 1213 / 2 | 1212 / 3 |

Every failure on both sides is a `REDOS_BUDGET_MS` wall-clock case in
`strip-blocks.test.ts`, a different subset each run, and that file passes 3/3 (110/110)
in isolation. **Same class, same rate, on both branches — so this branch introduces no
new failure**, but the earlier claim in this document of a "1215 / 0 failed" baseline
was taken from a previous session's record rather than measured here, and it is wrong.
Filed as `docs/todos/013`.

No linter is configured in this project (`package.json` has `build`, `test`, `dev`, `start`
only), so no lint gate was run. `npx tsc --noEmit` is clean apart from 12 pre-existing
errors in `schema.test.ts` (7), `post-processor.test.ts` (4) and `src/lib.test.ts` (1),
none in files this branch touches.

**Teeth probes — every new guard was verified by restoring the defect.** All `cp`-backed
and restored byte-identically with sha verification; no `git restore`/`stash`/`checkout`.

| Probe | Mutation | Result |
|---|---|---|
| A | full-body defence pass restored | perf ratio test fails, 2.12 vs 1.5 |
| B | `formatResponse` emits the body on the saved branch | **passed first time — my own false green.** Both new tests passed `""` as `stdout`. Fixed to pass the real body; re-probed, both now fail correctly |
| C | `jq_query` pointer removed from both message arms | 3 tests fail |
| D | the two message arms collapsed into one | forced-save test fails on the false limit claim |
| E | both lexeme revivers removed | 13 tests fail |
| F | **only** the `jq_query` reviver restored | 4 tests still fail — the two sites are independently guarded |
| G | `isRecord` marker guard removed | `.pi.rawJSON` returns `"3.140"` |

**End-to-end against the real shipped binary over stdio** (`node dist/index.js`, JSON-RPC,
local origin serving a 600 KB body): over-cap response leaks no body bytes, names `jq_query`,
and `.id`/`.exp`/`.pi` come back `9223372036854775807` / `1e400` / `3.140` — byte-exact,
where before this branch they were `9223372036854776000` / `null` / `3.14`. Zero
`wrap-error` lines.

**Gaps.** Acceptance criterion 3 — "a growth-band body triggers exactly one
`defendForInline` call" — is satisfied structurally (the second call site is deleted;
`exceedsInlineCap` is the only remaining one) and is **not** asserted by a runtime test.
The observable side effect is a throttled detection log, so counting passes is not
reliable. Stated rather than papered over.

## Commit history

See `git log --oneline main..HEAD`.

## Review context

Suggested order: `types/response.ts` (the contract), then `response/processor.ts`
(the deletion and the message), then `tools/curl-execute.ts` (the caller), then
`utils/json-lexeme.ts` + `jq/filter.ts` (the authorised scope growth), then tests.

Invariants touched: **14** (inline byte ceiling — now trivially true on the saved path
rather than narrowly true), **1/1a** (unchanged; the wrap still defends every text part),
**11** (untouched — `ProcessedResponse` is internal), **10** (`utils/json-lexeme.ts`
imports nothing, so it is leaf-level and both `response/` and `jq/` may import it).

## Reality Corrections

Two, both in `LESSONS.md`:

- **RC-27** — the number-lexeme fix had one implementation and three call sites (K-12, K-11, K-4).
- **RC-28** — the invariant-14 guard measured a value its own consumer discards (K-1, K-3).

No `POST-AUDIT` annotation was added: the input was a todo, not a plan, and the todo is
removed by the lifecycle below rather than annotated.

## Follow-up work

- [ ] Surface 3 has **not** run. Nothing here dispatches a bot reviewer and the bots do
      not auto-review — the PR is unreviewed by Surface 3 until
      `/sixees-workflow:review-pr-comments` is run.
- [ ] Consider whether `MCP_CURL_ALLOW_LOCALHOST` should cover the `127.0.0.1` spelling
      (see Known issues). Not filed as a todo — it is an observation, not a decision.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/012-P1-saved-files-can-silently-overwrite.md` | P1 | Saved response files collide because `URL.pathname` drops the query string entirely (mechanism corrected 2026-09-06; truncation-to-50 is a separate, secondary source), plus a millisecond clock, and `writeFile` has no `flag: "wx"`. Pre-existing; this branch removed the preview that made a substitution detectable. | Escalated to and settled by the operator |
| `docs/todos/013-P2-redos-budget-guards-fail-under-the-suites-own-parallelism.md` | P2 | `strip-blocks.test.ts`'s absolute wall-clock ReDoS budgets fail on every full-suite run on `main` as well as here, so the suite has no reliable green. | Found while verifying this branch's own test claim |

Both are pre-existing and out of this branch's scope. 013 in particular should be read
before trusting any "tests pass" line in this document.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/008-P2-over-cap-preview-is-computed-then-discarded.md` | The over-cap preview is defended over the whole body, then discarded by the formatter | Preview deleted; message now routes the model to `jq_query`; `ProcessedResponse` narrowed; stale "published entry point" doc-block corrected. All four acceptance criteria met, criterion 3 structurally rather than by test. | fix/over-cap-preview-computed-then-discarded | 2026-09-06 |


---

## Review Round 1 — 2026-09-06

Eight reviewers (six configured + the four-agent floor, deduped) plus the built-in
`/security-review`. All returned; none failed. Base `5adb7d3`, resolved once via
`git merge-base origin/HEAD HEAD` and handed to every reviewer.

| Reviewer | Result |
|---|---|
| `code-simplicity-reviewer` | clean — 0 |
| `learnings-researcher` | no RC conflicts across RC-8/10/12/15/16/24 |
| `pattern-recognition-specialist` | clean — 0, 3 routed observations |
| `typescript-reviewer` | 3 — P2, P3, P3 |
| `security-sentinel` | 1 — P2 |
| `architecture-strategist` | 3 — P2, P3, P3 |
| `data-integrity-guardian` | 3 — P2 x3 |
| `/security-review` | clean — no HIGH/MEDIUM at confidence >= 7 |

### Fixed

| Class | Found by | Disposition |
|---|---|---|
| **Guard displacement** — extracting the reviver left the Node >= 22 precondition in `processor.ts`; `json-lexeme.ts` asserted the capability with nothing enforcing it | `typescript-reviewer` (P2), `architecture-strategist` (P2), `pattern-recognition-specialist` (routed) — **three lanes, merged on instance overlap** | Guard moved into `json-lexeme.ts`; cast made optional so `tsc` carries the obligation; `rawJson` unexported so `isRawNumber`'s name is true by construction. New `utils/json-lexeme.test.ts` asserts the throw with no `response/` edge in its module graph. **RC-29** |
| **`jq_query` named as the route to artefacts it cannot read** — an over-cap `text/html` body was sent to a JSON-only tool, the only file reader registered | `data-integrity-guardian` (P2) | `savedMessage` gates the pointer on `isJsonContentType`; non-JSON bodies get the path and are told to use their own file tooling |
| **Message asserted a breach using a count that contradicted it** — *"Response (908 bytes) exceeded the 1000-byte inline limit"*, because the gate weighs DEFENDED bytes | `data-integrity-guardian` (P2), `architecture-strategist` (P3) — merged | Reworded so the count is labelled on-disk and the limit is labelled as applying after the defence pass. Both are then true together |
| **A false green in this branch's own new tests** — every saved-path fixture was `application/json`, so `toContain("jq_query")` could not fail for any content type | `data-integrity-guardian` | `text/html` and `text/csv` negative controls added, plus a byte-claim control. Teeth-probed |
| **Perf guard measured the scheduler as well as the code** — wall clock on ~27 ms arms; 6 false failures in 20 runs at 2x CPU oversubscription | `performance-oracle` (P3) | Switched to `process.cpuUsage()`. Re-probed: **0 false failures in 6 runs under 24-spinner load, detection still firing at 2.65 vs the 1.5 threshold.** Not hypothetical — this session watched `strip-blocks.test.ts`'s pre-existing wall-clock ReDoS budgets fail twice under agent load and pass 3/3 isolated |

### Declined, with evidence

| Class | Found by | Why |
|---|---|---|
| **Reviver CPU/memory cost** — 14-21x on the jq path; 384 ms and ~308 MB RSS on a 9.5 MB numeric body at `JQ.MAX_QUERY_FILE_SIZE` | `security-sentinel` (P2), `performance-oracle` (P2) — merged | Realistic payloads cost ~+22 ms (PageSpeed 3.5 MB: 12.3 -> 34.8 ms; Toggl 1.6 MB: 3.2 -> 24.3 ms). The proposed fallback to a plain parse above a threshold would re-corrupt exactly the large bodies `jq_query` is now the advertised route to — one invariant's fix reintroducing another's violation. **Two mitigations were measured and rejected, not assumed:** conditional wrapping (2562 vs 2229 ms adversarially, and *worse* on realistic bodies) and a regex pre-screen (74 ms when it does not fire). `performance-oracle` established why nothing at the mechanism can work — an *identity* reviver already costs 14.3x, because any reviver drops V8 off its bulk parse path. The measured table and the named lever (`JQ.MAX_QUERY_FILE_SIZE`) are recorded in `json-lexeme.ts`'s docblock |
| **`FileSaveInfo` re-widens the invariant** `ProcessedResponse` just pinned | `typescript-reviewer` (P3), `architecture-strategist` (P3) — merged | Both confirmed **unreachable**: one production caller, which derives both fields from the narrowed union, and `join()` cannot return `""`. Effort `m` (four test files). Population is a hypothetical second producer |
| **Growth-band double-compute** — `exceedsInlineCap` defends, discards, `curl-execute` recomputes; ~4 ms on a 500 KB body | `performance-oracle` (P3) | Threading the defended string back out re-creates the two-shapes-of-content hazard that removing `content` from the saved arm just eliminated. `performance-oracle`'s own read was decline-and-record. Recorded in `processor.ts` **together with the unsound shortcut** a later round would otherwise rediscover: skipping the arm above `STRIP_PATH_MAX_BYTES` is wrong because `defendText` sanitises before it checks that cap — measured 263,900 bytes in, 407,401 out |

### Escalated, and settled by the operator

**Saved files can silently overwrite each other** (`data-integrity-guardian`, P2 with
the P1 tension named). `?page=1` and `?page=2` both reduce to the identical 21-char
base; `Date.now()` is millisecond; `writeFile` has no `flag: "wx"`. Pre-existing and
out of scope — but this branch removed the inline preview that made a substitution
detectable. The reviewer said explicitly *"if concurrent tool calls are normal in the
deployment, this is P1"*, and for an orchestrated agent fleet they are.

**Operator's decision: file at P1, ship this branch.** Filed as
`docs/todos/012-P1-saved-files-can-silently-overwrite.md`. Recorded here per
`03-divergence.md` so a later round cites it rather than re-litigating it.

### Corrections to this document, from review

- The `parseJsonDocument` opt-out claim above — one `false` caller, not two.
- **The persisted artefact is NOT byte-identical on every arm.** The `curl_execute` +
  `jq_filter` branch reassigns `content` from the filter result before saving, so a
  saved file now carries `9223372036854775807` where it carried
  `9223372036854776000`. That is the RC-27 fix working in the fidelity direction, but
  RC-8/RC-10 pin those bytes, so it is recorded as a deliberate change rather than
  reported as untouched. Every other arm is byte-identical. Now in RC-27.
- `ARCHITECTURE.md` invariant 14 now records that the ceiling is type-enforced on the
  saved path (`architecture-strategist` flagged the K-7 risk of that fact living only
  in source docblocks).

### Not filed, surfaced only

- `sanitize.ts::detectInjectionPattern`'s docblock claims its footprint stays "well
  inside `MAX_TOTAL_RESPONSE_MEMORY` (100 MB)". `performance-oracle` measured ~308 MB
  RSS on the jq path, so that sentence now understates the peak by roughly 3x, and
  `memory-tracker.ts::allocateMemory` charges 9.5 MB for such a request. Out of scope
  (neither file is in this diff) and the claim is about a different quantity than the
  accounting budget, but it is now misleading and worth a look.
- 67% of the remaining ~92 ms on the over-cap path is `detectInjectionPattern`, most of
  it an NFKC normalise over a full transient copy. Bounding it is a security trade, not
  a performance one — `security-sentinel`'s call, not something to take casually.
- `utils/json-lexeme.ts` had no colocated test where every other `utils/` file does
  (`pattern-recognition-specialist`). Fixed as part of RC-29's fix rather than tracked.

## Code Review — 2026-09-06 (Surface 2, three rounds)

**Certification:** complete
**Roster closure:** closed — 8 agents (union of `review_agents` and the four-agent floor); all deferral destinations in-roster. unresolved: pattern-recognition-specialist → "whichever reviewer owns that lane"; security-sentinel → "anything genuinely outside your lane gets one line under notes: and no finding"
**Rounds:** 3 × 8 agents = 24 dispatches, 24 returned, 0 failed, 0 not-migrated
**Base:** `5adb7d3c9d67a349b30338e61efc1d002d1566e5` via `git merge-base --fork-point origin/HEAD HEAD`

### Findings by class

| # | Class | Sev | Reviewers | In diff | Disposition |
|---|---|---|---|---|---|
| A | remote `Content-Type` composed into server-authored model-facing prose | P1 | security ×3, architecture, typescript ×2 | yes (`savedMessage`) | fix — at the parse boundary |
| B | `savedMessage` asserts a route it cannot know (3 arms) | P1 ↑ | data-integrity ×2, architecture ×2, simplicity | yes | fix |
| C | message routes the model to read the artefact outside the wrap | P1 | security ×2 | yes | fix (stop advertising) |
| F | tests that cannot fail | P1 ↑ | data-integrity, pattern, simplicity, typescript ×2 | yes | fix |
| D | `ARCHITECTURE.md` invariant 16 truncated, invariant 14's claim spliced in | P2 | security, typescript | yes | fix |
| E | `docs/todos/012` records the wrong collision mechanism | P2 | data-integrity | yes | fix |
| J | docblock costs measured at 16–35% of the permitted bound, and indexed on the wrong axis | P2 | performance ×2 | yes | fix |
| K | timing-guard calibration comment optimistic in both numbers | P3 | performance | yes | fix |
| L | `savedMessage` docblock claims the over-cap clause is absent on the `save_to_file` arm | P3 | performance | yes | fix |
| M | `register-all-tools.test.ts` cites `processor.ts` as the Node-22 guard's home | P3 | typescript | yes | fix |
| N | `jq/filter.ts` deep-imports `../utils/json-lexeme.js`, bypassing the barrel (21 of 22 use it) | P3 | pattern | yes | fix |
| O | stacked docblocks orphan `exceedsInlineCap`'s original block and its `@param` | P3 | security | yes | fix |
| P | `ProcessedResponse` docblock claims a defended route that exists only for JSON | P3 | architecture | yes | fix |
| G | `parseJsonDocument` defaults to the lossy arm; `contentTypeUndetermined` optional where `defendText`'s is required | P2 | data-integrity, typescript | **no** | declined — out of scope |
| H | inline-budget rule has one implementation and three bypasses | P2 | architecture, pattern, simplicity | 1 of 3 | in-diff instance dies with A; 2 pre-existing declined |
| I | lexeme reviver cost on the two jq paths | P2 | performance ×3 | yes | **declined with measurement** |

↑ = severity raised one level per `plugin:commands/review.md` §4.1 on a `class-id` recurrence: **B** on RC-29 (`misplaced-decision`, recorded in this very PR) and **F** on RC-28 (`unchecked-assertion`, also this PR — *"a guard written to replace a false green inherits the pressure that produced the first one"*).

### Escalated to the operator — out-of-scope P1s (at the deferral cap of 2)

1. **Invariant-16 bypass via a stale byte measurement.** `parseJsonDocument`'s gate reads pre-sanitise bytes (`processor.ts:153`); `defendText`'s `exceedsStripCap` reads post-sanitise. A >256 KB JSON body carrying ≥18 KB of collapsible padding declines the region-wise arm, then passes the strip cap after collapse and is scanned undivided — so `stripHtmlComments` pairs `<!--` in one field with `-->` in another and deletes the keys between. Remote-selectable at both ends. The repo's own docblock records the **mirror** half of this mechanism (263,900 in → 407,401 out) as a closed invariant-14 problem; the invariant-16 half is unaddressed. Verified out of diff: gate at line 153, hunk begins at old 158.
2. **The invariant-1 class has six instances, not two.** Confirmed further unwrapped `CallToolResult` exits: `hook-executor.ts::executeWithHooks` (wrap fires at 2 of 4 exits; a throwing `beforeRequest` hook skips both the wrap *and* the `onError` chain), both `!enabled` early returns in `tool-wrapper.ts`, and `schema/generator.ts::createToolHandler`'s catch arms plus trailing throw — and `registerEndpointTools` **is** published from `src/lib.ts`. Two instances is a pair of edits; six is a seam needing one enforced exit.

### Declines, with the evidence

- **I — reviver cost.** Measured on shipped `dist/` at base and HEAD, against the real canonical Lighthouse `sample_v2.json` in a PSI v5 envelope and Toggl bodies at documented page sizes: PageSpeed **+2.0–2.5 ms / +1.0–1.4 MB**, Toggl 50-entry page **+0.3 ms**. For every saved body the PR is net **10–49 ms faster**. Round 1's "+274 MB RSS" was **uncollected garbage, not footprint** — real per-call heap delta is 1.8–19.2 MB; performance-oracle corrected itself in round 3. Bounded: cost is linear in *numbers per document* (~0.34–0.98 µs each), not bytes — two 450 KB bodies differing only in number count measured 7.6× apart. `JQ.MAX_QUERY_FILE_SIZE` remains the lever. **The proposed benchmark fixture is also declined**: a wall-clock threshold with a measured 2–4× median-vs-min GC spread would flake, be quarantined, and then guard a cost already accepted — rule 42's guard-nobody-needed.
- **G — lossy default.** `preserveNumberLexemes = false` is byte-identical at base; `git diff` shows no change to it. Real mechanism (a future caller re-creating RC-27 silently), empty population today, out of scope. Recorded here rather than filed so the next caller meets it.
- **H — the two pre-existing bound instances.** `git diff … -- src/lib/tools/curl-execute.ts | rg defendedStderr` returns nothing: not in the diff. Pattern sized the class at 3 confirmed instances (no fourth; `applyJqFilter`'s 200-byte preview excluded because 200 < the schema's `max_result_size` floor of 1,000, so `min()` holds trivially), and both architecture and pattern judged 3 instances insufficient to justify extracting `boundInlineText`.

### Reviewer declines worth preserving

`FileSaveInfo` re-widening — declined twice as K-14, population re-tested against every entry point and confirmed empty. A branded `ServerAuthored` string type — declined because TypeScript has no taint propagation: `` `${a}${b}` `` on two branded strings yields plain `string`, so the brand dies at exactly the operation it would police. `include_metadata` gating `sanitizeErrorMessage` — K-14, the success path returns absolute paths unconditionally because the model needs them. JSON key-order discrepancy between file and inline copy — real, insignificant under RFC 8259, no nameable harm.

### Verified handoff claims

| Claim | Result |
|---|---|
| `ProcessedResponse` reaches no npm entry point | **confirmed** — absent from every shipped `.d.ts`; no wildcard exports on any of the four entries |
| `formatResponse`'s saved branch ignores `stdout` | **confirmed** — both JSON and plain arms return before reading it |
| `savedMessage`'s byte count is "bytes on disk" | **confirmed** — `writeFile` persists exactly `content`; the count is `Buffer.byteLength` of the same string |
| 40% CPU saving on the deleted pass | **confirmed independently** — 201.4 → 121.2 ms median on 9.86 MB, compiled base vs HEAD |
| Timing guard has teeth | **confirmed** — 2.30–2.73 with the pass reintroduced vs 0.76–1.32 clean |
| Suite state | **1248 passed / 3 failed / 7 skipped / 272 suites**; all 3 failures are the pre-existing `strip-blocks.test.ts` ReDoS wall-clock cases (todo 013) |
| Number-lexeme class closed | **confirmed** — every `JSON.parse` in production `src/` routes through `keepNumberLexeme`; 4 of 4 structural marker guards present |

### Handoff assessment

Honest and unusually self-critical — it surfaced both of its own false greens, corrected three of its own earlier claims inline, and reported the suite as not-clean on either branch rather than rounding up. Two things it got wrong that review caught: the "+274 MB" memory figure it relayed (garbage, not footprint), and `docs/todos/012`'s recorded collision mechanism. Its *"What to pay attention to"* section correctly predicted the marker-leakage risk, and that lane came back clean at 4-for-4.

### Blockers

Four P1 classes (A, B, C, F), all in scope, all in or adjacent to `savedMessage`. Plus two escalations awaiting a scope decision.

### The remedy question — three candidates, unresolved by review

Rounds disagreed, and the disagreement is a scope call rather than a finding.

- **Wide cut** (simplicity R2; architecture R3 endorsing it but rejecting the `disableJqQuery` threading as `fail-open-default`, citing todo 006): drop `contentType` and the whole route clause; move the hint to the static `CURL_EXECUTE_TOOL_META.description`. Closes A-at-`savedMessage`, B and C's advertisement. Costs one wasted `jq_query` call per non-JSON save (`saveResponseToFile` always appends `.txt`, so the artefact carries no signal), breaks three tests, and per typescript R3 makes C's *other* instance more reachable.
- **Narrow fix** (simplicity R3, reversing itself): keep the two-branch route, reduce `contentType` to a boolean before it reaches the string. Closes A at `savedMessage` only; keeps C verbatim, keeps two of B's arms wrong, keeps the false green.
- **Parse-boundary validation** (security R3): constrain `contentType` to the RFC 6838 media-type grammar at `parseResponseWithMetadata`, `undefined` on mismatch. Rung 1 rather than rung 4 — closes **all four** of A's instances, present and future. Addresses neither B nor C.

`LESSONS.md` precedent: **RC-17** is the template for relocating a decision a layer cannot answer; **RC-26** already fired rule 42's convergence rule on this codebase and concluded *"the right response is not a third patch"*; **RC-21** sets the bar for the replacement (assertions must match the registration set). No prior art warns against moving a hint into a static description, and none records removing a model-facing affordance making behaviour worse.
