# Work Handoff: fix/014-json-region-defence-end-to-end-guard

**Date:** 2026-10-20 | **Branch:** `fix/014-json-region-defence-end-to-end-guard` | **Plan:** todo 014 (no plan document) | **Status:** complete. Todo 014 is resolved. The defect was already gone at HEAD, and this branch adds the end-to-end guard its acceptance criterion asked for.

The review record below was written first, by the review run inside `/sixees-workflow:work`. The sections from *Summary* to *Resolved Todos* were added by the work run after it.

## Summary

Todo 014 said a JSON document could lose its region-wise defence. The cause was a byte count taken before the sanitiser shrank the document. The audit found that mechanism already removed at HEAD by 018's first slice (RC-37, RC-49):

- `parseJsonDocument` no longer exists.
- `defendForInline` decides JSON with `classifyBody`, which has no size cap, and returns a JSON document unchanged.
- `defend-text.test.ts` already pins the input at the unit level.

At your direction, this branch adds the one end-to-end case the todo's acceptance criterion describes, on the shipped registration path. It then closes the todo.

## What was implemented

- **Test only, with no production change.** `src/lib/tools/register-all-tools.test.ts` gains `describe("a body the sanitiser shrinks under the strip cap", …)` inside `describe("the defence never deletes a field", …)`. It has three cases:
  - A precondition: the body is over `STRIP_PATH_MAX_BYTES` raw and under it after `sanitizeResponse`, both measured with the real constant and the real sanitiser.
  - Inline: every key is present, the bytes match exactly, and the wrap completed.
  - Persisted (`save_to_file: true`): every key is present and the file holds the origin's octets.
- **The fixture follows existing patterns.** It sends a body with no Content-Type (`""`, the same convention as 018's AC2 case), and builds the body with the same shape as `defend-text.test.ts`'s RC-32 case. It reuses the shared `savedPathFrom` from `curl-output.test-fixture.ts`.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Put the test at `registerAllCapabilities` and not at `executeCurlRequest` | The wrap, `defendForInline`, is applied only on the registration path. `executeCurlRequest` alone never reaches the code a pre-sanitise gate would sit in. This is the outermost boundary. | Putting it beside the 018 passthrough suite in `curl-execute.json-passthrough.test.ts`, which sits below the wrap |
| No Content-Type | A declared `application/json` never reaches the strip arm at any size, so it would pass against the defect. The todo's own corrected criterion says this. | `application/json` |
| Do not add a `jq_query` mirror case (RC-21) | `jq_query` output goes through the same `defendForInline`, which the probe covers. The existing "jq_query takes the same wrap" suite already pins that the wrap is registered on both tools. | A second case through `jq_query` |
| Close 014 and do not re-scope it | The defect cannot happen at HEAD. Its proposed fixes 1 and 2 edit a function that no longer exists. | Leaving it open behind 018, or closing it without a test |

## What to pay attention to during review

- **The inline case is the one that catches the todo's exact mechanism.** A size cap put into `defendForInline` alone deletes `secret` and `c` and fails only that case. The persisted case catches the same cap only when it sits in `classifyBody`, because the body path goes through that function.
- **A related case, declined.** The wrap classifies the body before sanitising it. So a body that is invalid JSON as sent but valid once sanitised can take the undivided strip, for example one with U+200B between tokens. No one is in the population that could be harmed by this. A party that controls only one string value inside a JSON response cannot put a character between tokens. Only the origin can, and the origin already authors every byte of the response. No todo was filed.
- Todo 021 (P3) applies to this diff: the fixture now exists in two suites.

## Known issues and limitations

- **Todo 021: the straddle body is built twice.** The older copy in `defend-text.test.ts` checks the raw size against a hard-coded `262_144` and never measures after sanitising. This branch added the second copy, and `.claude/rules/02-reuse-first.md` says to extract a second copy rather than keep it. `/work`'s review step applies no fix, so it is filed as `pending` and is yours to call. It is effort `s` and could be folded into this branch before the push.
- **Two review notes were not filed:**
  - The block comment's "both copies the model can be handed" is loose wording. The saved file reaches the model only through `jq_query`.
  - The test imports `utils/sanitize.js` directly, while `processor.ts` reaches it through the `utils/index.js` barrel.
- **The cleanup style differs from the convention.** The new block cleans up saved files with a per-describe `afterEach`, where the house convention is a module-level `afterAll`. The reviewer named no harm.

## Testing summary

- **Tests added:** 3 cases in `register-all-tools.test.ts`.
- **Suite result:** `npm test -- --reporter=json --outputFile=<scratch>/vitest.json`. Parsed from the artefact: 1385 total, 1378 passed, 0 failed, 7 skipped, `success: true`.
- **This verdict is not certified by `/work`'s own rule.** The rule does not treat vitest's modes as trustworthy for certification, so the floor is whatever you run before authorising the push. The parsed counts above are evidence, not certification.
- **Teeth:** two single-mutation probes. Each was backed up with `cp`, restored from the copy, and the `git diff` confirmed empty afterwards.
  - A size cap in `classifyBody` failed the inline and persisted cases.
  - A size cap in `defendForInline` failed the inline case with `secret` and `c` deleted.
- **Typecheck:** `tsc --noEmit` reports errors only in files this branch does not touch: `src/lib.test.ts` (1), `src/lib/response/post-processor.test.ts` (4) and `src/lib/schema/schema.test.ts` (7). It reports none in `register-all-tools.test.ts`. These errors already existed before this branch.
- **Lint:** the project declares no lint script.

## Commit history

```
4c15433 docs(review): record the Surface 2 review of fix/014 and file todo 021
1d8ee39 test(response): guard the shipped path against a pre-sanitise JSON size gate
```

(This handoff and the todo 014 close are committed after this list was taken.)

## Review context

Read the commit body of `1d8ee39`, then the new describe block. Then read `src/lib/response/processor.ts::defendForInline` and `::classifyBody`, and the RC-32 block in `src/lib/response/defend-text.test.ts`. Related lessons: RC-32, RC-37, RC-49, RC-64.

## Follow-up work

- [ ] Disposition todo 021: extract the straddle fixture, or decline it.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| 021 | p3 | The strip-cap straddle fixture is built twice, with two different preconditions | review, `pattern-recognition-specialist` |

### Resolved Todos

| Id | Title | Summary | By | Date |
|---|---|---|---|---|
| 014 | A JSON document's region-wise defence is skipped on a pre-sanitise byte measurement | Already removed at HEAD by 018's first slice. This branch adds the end-to-end guard from the acceptance criterion and probes that it can fail. | Claude Code (`/sixees-workflow:work`) | 2026-10-20 |
| 021 | The strip-cap straddle fixture is built twice, with two different preconditions | Extracted to `src/lib/response/strip-cap-straddle.test-fixture.ts` (body, keys, `assertStraddlesStripCap`), and both suites call it. The `262_144` literal is gone. Teeth: shrinking the padding fails the precondition in both suites. Commit `dd4c36a`. | Claude Code, at the operator's instruction | 2026-10-20 |

### Todo files removed — 2026-10-20

At the operator's instruction, `docs/todos/014-…` and `docs/todos/021-…` were deleted rather than archived after both were resolved. The table above is now the only record of either. Two things follow from the deletion:

- **021 was the highest id on disk, so the allocator will issue `021` again.** Any later citation of "todo 021" will be ambiguous. This handoff refers to the deleted one.
- **`018`'s body still names 014.** That reference now resolves to no file. The closed state of both todos is in the commit history: the completed 014 was committed before it was removed.

The *Outstanding Todos* table above lists 021 as it stood at review time. Nothing is outstanding now.

The review notes not filed as todos are unchanged: the barrel-import note was not acted on, and the cleanup-style note was not acted on. The comment-wording note was fixed in `dd4c36a`.

---

## Code Review — 2026-10-20

**Certification:** complete
**Roster closure:** closed. Every refusal that names another agent names one that is in the roster. Four refusals could not be checked against the roster:
- `security-sentinel` → "Anything genuinely outside your lane gets one line under `notes:` and no finding"
- `data-integrity-guardian` → the same sentence
- `performance-oracle` → the same sentence
- `pattern-recognition-specialist` → "**The correctness of any single instance** → whichever reviewer owns that lane"

**Scope:** base `85443fa` (resolved by `git merge-base --fork-point origin/HEAD HEAD`, which is `origin/main`). The range is one commit, `1d8ee39`, and one changed file, `M src/lib/tools/register-all-tools.test.ts`. There is no PR yet.

**Agents used:** 8. Four always run: `learnings-researcher`, `code-simplicity-reviewer`, `security-sentinel`, `data-integrity-guardian`. Four are optional, from config: `typescript-reviewer`, `performance-oracle`, `architecture-strategist`, `pattern-recognition-specialist`.

**Findings:** 1 in total, P1 0, P2 0, P3 1. It was filed as todo 021. None were declined, none are investigate-first, none were escalated and none were rejected.

| Reviewer | Floor | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| learnings-researcher | floor | none | done | — | Returned its digest shape. 15 known patterns, including RC-15, 16, 21, 25, 32, 37, 49 and 64. |
| code-simplicity-reviewer | floor | v1 | clean | 0 | Has no `Bash`, so it judged the modified file as a whole and said so. |
| security-sentinel | floor | v1 | clean | 0 | Traced the remote body through `classifyBody` to the inline sink and the persisted sink. |
| data-integrity-guardian | floor | v1 | not-applicable | 0 | This repo has no data layer. Has no `Bash` and said so. |
| typescript-reviewer | optional | v1 | clean | 0 | Has no `Bash` and said so. Note: the block comment's "both copies the model can be handed" is loose wording. The saved file reaches the model only through `jq_query`. |
| performance-oracle | optional | v1 | clean | 0 | |
| architecture-strategist | optional | v1 | clean | 0 | Has no `Bash` and said so. Note: the test imports `utils/sanitize.js` directly, while `processor.ts` reaches it through the `utils/index.js` barrel. |
| pattern-recognition-specialist | optional | v1 | findings | 1 | Note: per-describe `afterEach` cleanup departs from the module-level `afterAll` convention. No harm was named, so it was not filed. |

**Failed reviewers:** none. All reviewers returned.

**Reduced floor coverage:** `data-integrity-guardian` returned `not-applicable`, because there is no database and no production write in this diff.

### Key findings

| Severity | Category | Class | Todo |
|---|---|---|---|
| P3 | duplicated-logic | The input body built to sit across the strip cap (over it before sanitising, under it after) is built twice, and the two copies check that condition differently. | 021 |

### Handoff assessment

There was no work handoff when the review ran. The commit body was the builder's whole account, and the reviewers checked it against the code. The commit body's teeth claim could not be confirmed by any reviewer, because none of them can run the suite. The work run confirmed it by running the suite with each probe applied, in the same session.

### Verified claims

| Claim (commit body) | Checked how | Result |
|---|---|---|
| `parseJsonDocument` is gone at HEAD | `rg parseJsonDocument src` | Holds. There are no hits. |
| `classifyBody` parses with no size cap | Read `processor.ts::classifyBody` | Holds. |
| `defend-text.test.ts` already pins the input against `defendText` | Read the RC-32 describe block | Holds. This is also todo 021's first instance. |
| Teeth: a cap in `classifyBody` fails both cases, and a cap in `defendForInline` fails the inline case | Probes run by the work run, with the source restored and its diff confirmed empty | Holds. The `defendForInline` probe deleted `secret` and `c`. |
| Tests pass | `npm test -- --reporter=json` | 1385 tests: 1378 passed, 0 failed, 7 skipped. |

### Outstanding todos

| Todo | Priority | Description | Source |
|---|---|---|---|
| 021 | p3 | The strip-cap straddle fixture is built twice | `pattern-recognition-specialist` |

**Open classes without a todo:** none.

**Blockers:** none.
