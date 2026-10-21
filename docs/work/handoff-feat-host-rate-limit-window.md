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

**Blockers (at review time):** P1 todo 022, escalated to the operator by `/sixees-workflow:work` Step 5 (a P1 escalates whatever row it lands in).

### Operator disposition — 2026-10-21

| Todo | Disposition |
|---|---|
| 022 | **Fixed, Option 1.** The operator settled the scope: "one server per process" is a convention, not structure, so neither a decline nor a doc note closes it. Two servers setting a limit: first holder wins, and a second `start()` with any `rateLimit` throws. |
| 023 | Fixed |
| 024 | Fixed |
| 025 | Fixed |

**Blockers:** none. Fixes are in the commit after `a717332`. No re-review has run on them yet (K-16): the newest text on the branch is the install/release seam and `McpCurlServer.releaseProcessState`.

## Code Review — 2026-10-21 (round 2)

**Certification:** complete
**Roster closure:** closed unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane."

**Scope:** `400715fc25c8e96b7fd0631dc1b4da4a0b0d24fa..1135885` (`git merge-base --fork-point origin/HEAD HEAD`), 20 files, 8 commits. Focused on `308d53e`, the round-1 fixes (K-16).

**Agents used (8, all returned):**
- Floor: learnings-researcher, code-simplicity-reviewer, security-sentinel, data-integrity-guardian.
- Optional: typescript-reviewer, performance-oracle, architecture-strategist, pattern-recognition-specialist.

**Findings:** 4 classes after merge — P1 0 | P2 2 | P3 2. Filed 4, declined 0, investigate-first 0, rejected 0.

**Handoff assessment:** The round-1 disposition table is accurate. The ownership seam does what it claims: atomic install and release, a no-op for a foreign handle, refusal before any side effect. security-sentinel, data-integrity-guardian, architecture-strategist and simplicity each confirmed that independently.

The builder's rewrite of todo 022's "exactly one copy" criterion was the builder's own call and was never put to the operator. Two reviewers read it as operator-settled, and it was not.

**Ids 021–024 are reissued.** The completed todos 021–025 were deleted, so the earlier sections of this handoff refer to different todos under those numbers.

### Key findings

| Severity | Class | Todo |
|---|---|---|
| P2 (P3 + RC-31 noun join) | fail-open-default — the host-limit key treats a trailing dot as a different host | 022 |
| P2 (P3 + RC-31 noun join) | fail-open-default — the sliding log is discarded on an ownership change, so a restart gets a fresh quota | 023 |
| P3 | stale-observation (alias repeated-computation) — rateLimit is validated on one read and copied from another, at two sites | 021 |
| P3 | convention-drift — HostRateLimit is frozen at runtime but typed as mutable | 024 |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | `npx vitest run` | 42 files, 1499 passed, 7 skipped |
| `tsc` unchanged | `npx tsc --noEmit` | 12 errors, all in test files, same as `main` |
| No stale `setHostRateLimit`/`validateRateLimit` | `rg` over src, docs and README (excluding work/plans) | none |
| Reviewer sweeps | re-ran the `checkRateLimits(`, `.clear()` and `assertHostRateLimit` sweeps | reproduced |

### Outstanding todos

| Todo | Priority | Description | Source |
|---|---|---|---|
| 022 | P2 | trailing-dot host key | Surface 2 round 2 |
| 023 | P2 | sliding log lost on ownership change | Surface 2 round 2 |
| 021 | P3 | validate-on-one-read / two copies | Surface 2 round 2 |
| 024 | P3 | readonly HostRateLimit | Surface 2 round 2 |

**Open without a todo:** none.

**Blockers:** none (no P1). Todo 021 needs one operator decision: Option 2 there would reverse round 1's seam copy (rule 03).
