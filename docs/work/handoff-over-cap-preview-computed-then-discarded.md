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
  bypass — `isDefinitelyJson` throws the graph away, and the persisted path is pinned
  by RC-8/RC-10.

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

**Result: 1236 passed, 0 failed, 7 skipped, 269 suites, 0 failed suites.** Baseline on
`main` before this branch was 1215 passed / 0 failed / 7 skipped — net +21.

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

_None created by this run._

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/008-P2-over-cap-preview-is-computed-then-discarded.md` | The over-cap preview is defended over the whole body, then discarded by the formatter | Preview deleted; message now routes the model to `jq_query`; `ProcessedResponse` narrowed; stale "published entry point" doc-block corrected. All four acceptance criteria met, criterion 3 structurally rather than by test. | fix/over-cap-preview-computed-then-discarded | 2026-09-06 |
