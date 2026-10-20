# Work Handoff: feat/embedder-base-url
**Status:** in-review — created during `/sixees-workflow:review` (run inside `/sixees-workflow:work`, PR-1 slice) before the work run's own handoff was written. The work-run schema is added to this file by Step 6 of that command.

## Code Review — 2026-10-20

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; pattern-recognition-specialist → "whichever reviewer owns that lane"
**Target:** branch `feat/embedder-base-url` — no PR
**Scope:** base `8edf9e7` (`git merge-base origin/HEAD HEAD`; the `--fork-point` arm did not answer), range `8edf9e7..HEAD`, 4 commits, 12 files.

**Agents used (8):**
- Floor: learnings-researcher, code-simplicity-reviewer, security-sentinel and data-integrity-guardian.
- Optional: typescript-reviewer, architecture-strategist, pattern-recognition-specialist and performance-oracle.
- Every agent returned and none failed.

**Findings:** 4 classes in total: 1 at P1, none at P2 and 3 at P3.
- Filed as todos: 3.
- Declined as out of scope: 1.
- Investigate-first: none.
- Rejected: none.

### Handoff assessment

No work handoff existed when this review ran, so the review went code-first. The work run's commit bodies do flag both the P1 and the `dead-code` P3 themselves:
- `ffae802` says "A path beginning // is no longer joined".
- The teeth-probe note in the work run says the origin comparison is unproven.

So both were acknowledged by the builder, not undisclosed.

### Key findings

| Severity | Class | Todo | Reviewers |
|---|---|---|---|
| P1 | `broken-contract`: `executeRequest({ path })` values starting `//` or `/\` are now refused. At base they joined onto the base host. This narrows a published method (invariant 11). It recurs: RC-36, RC-55. | 021 | architecture-strategist (security-sentinel and typescript-reviewer noted it out of lane) |
| P3 | `dead-code`: the origin comparison in `resolveRequestUrl` cannot fail, because the base parse and scheme check run before it. | 022 | code-simplicity-reviewer |
| P3 | `duplicated-logic`: the fake `registerTool` capture is copied in each test; this diff adds one more copy. | 023 | pattern-recognition-specialist |
| P3 | `stale-comment`: `docs/getting-started.md` and `examples/basic/src/index.ts` still say "prepended to relative URLs/paths". | — **declined, out of scope**: both confirmed instances are outside the diff. It is a one-line edit if the operator wants it. | pattern-recognition-specialist |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | `npx vitest run` after the last commit | 1413 passed, 7 skipped, 42 files |
| One join | security-sentinel's sweep and architecture-strategist's sweep | Yes, on the model-input path. `schema/generator.ts::buildUrl` is excluded by the plan |
| Invariant 1 on the resolver error | security-sentinel's trace, plus the unit test `isWrappedResult` | Holds |
| SSRF ordering | security-sentinel's trace | The join runs before `validateUrlAndResolveDns` on both paths |

### Outstanding todos

| Todo | Priority | Description | Source |
|---|---|---|---|
| 021 | P1 | `executeRequest` `path` is gated as if it were a model url | architecture-strategist |
| 022 | P3 | The resolver's origin comparison cannot fail | code-simplicity-reviewer |
| 023 | P3 | Fake-`registerTool` capture copied per test | pattern-recognition-specialist |

### Open without a todo

None.

**Blockers:** P1 todo 021.

**Reviewer notes carried forward:**
- data-integrity-guardian returned `not-applicable`: there is no data layer.
- Reviewers without `Bash` judged their modified files whole and declared it themselves: typescript-reviewer, code-simplicity-reviewer, architecture-strategist and data-integrity-guardian.
- security-sentinel noted a pre-existing gap: `buildCurlArgs` never checks the URL for CR/LF. It is outside this diff and was not filed.
- pattern-recognition-specialist noted two things:
  - a stray `.` line inside the code fence in `docs/configuration.md` → *baseUrl*. The line predates this branch; the diff edited the same section.
  - the `!enabled` early returns are unwrapped. That is pre-existing and already todo 015.
