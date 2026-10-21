# Work Handoff: per-host sliding-window rate limit (PR-2)
**Date:** 2026-10-21 | **Branch:** feat/host-rate-limit-window | **Plan:** docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md | **Status:** in-review — created by Surface 2 (`/sixees-workflow:review`) during the `/sixees-workflow:work` run, before that run's own handoff was written; the work-run schema is added by Step 6 if the run continues past the review escalation
**Plan slice:** PR-2

## Code Review — 2026-10-21

**Certification:** complete
**Roster closure:** closed unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane."

**Scope:** `400715fc25c8e96b7fd0631dc1b4da4a0b0d24fa..HEAD` (`git merge-base --fork-point origin/HEAD HEAD`), 15 modified files, 4 commits.

**Agents used (8, all returned):** learnings-researcher (floor), code-simplicity-reviewer (floor), security-sentinel (floor), data-integrity-guardian (floor), typescript-reviewer, performance-oracle, architecture-strategist, pattern-recognition-specialist.

**Findings:** 4 classes after merge — P1 1 | P2 0 | P3 3. Filed 4, declined 0, investigate-first 0, rejected 0.

**Handoff assessment:** no handoff existed when the review ran; the builder's commit bodies were the only self-account. They disclosed the K-1 near-miss in the lifecycle tests and the plan's wrong `/mcp`-reconnect claim. They did not surface the process-global ownership problem, which four reviewers found independently, nor the two architecture-doc sentences the doc commit missed.

### Key findings

| Severity | Class | Todo |
|---|---|---|
| P1 (P2 + RC-19 recurrence) | misplaced-decision — process-global host-limit seam has no owner and trusts every caller (aliases fail-open-default, stale-observation, dead-code, duplicated-logic) | 022 |
| P3 | stale-comment — architecture doc still describes two rate-limit maps (plus `bounded-throttle.ts` citation) | 023 |
| P3 | duplicated-logic — sliding-log expiry comparison spelled twice | 024 |
| P3 | convention-drift — `HostRateLimit` not exported from `src/lib.ts` | 025 |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | `npx vitest run` | 42 files, 1488 passed, 7 skipped (human-readable output; vitest has no trusted structured mode here) |
| `tsc` unchanged | `npx tsc --noEmit` | 12 errors, all in test files, same as `main` |
| Guards have teeth | mutation probes, restored from `cp` backups | 4 limiter probes and 4 wiring probes each fail a named test |
| `setHostRateLimit` not public | `rg` in `src/lib.ts`, `src/lib/index.ts` | confirmed (security-sentinel, typescript-reviewer) |

### Outstanding todos

| File | Priority | Description | Source |
|---|---|---|---|
| docs/todos/022-p1-process-global-host-limit-seam-trusts-every-caller.md | P1 | ownerless reset; validate-then-store-by-reference; duplicated copy and teardown | Surface 2 |
| docs/todos/023-p3-architecture-doc-still-describes-two-rate-limit-maps.md | P3 | stale structure sentences | Surface 2 |
| docs/todos/024-p3-sliding-log-expiry-comparison-spelled-twice.md | P3 | one shared expiry check | Surface 2 |
| docs/todos/025-p3-hostratelimit-type-not-exported-from-public-barrel.md | P3 | export the type | Surface 2 |

**Open without a todo:** none.

**Blockers:** P1 todo 022, escalated to the operator by `/sixees-workflow:work` Step 5 (a P1 escalates whatever row it lands in).
