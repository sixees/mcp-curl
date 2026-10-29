# Work Handoff: header sync, refusal shape, `//` move
**Date:** 2026-10-29 | **Branch:** feat/header-sync-refusal-shape | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** in-review — the Surface 2 review created this file before the work run's own handoff section was written, because the work run stopped on an escalated P1 (see below).
**Plan slice:** PR-4 (tasks 13, 14, 15, 16)

> Created during review, not by the work run's Step 6. The work-run sections (Summary, Key decisions, etc.) are still to be written when the run resumes.

## Code Review — 2026-10-29

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"

**Scope:** base `4258551` (`git merge-base --fork-point origin/HEAD HEAD`; origin/HEAD = main) .. HEAD, 3 commits, 14 modified files.

**Agents used (8):** learnings-researcher, code-simplicity-reviewer, security-sentinel and data-integrity-guardian (floor); typescript-reviewer, performance-oracle, architecture-strategist and pattern-recognition-specialist (optional). All returned. None failed.

**Findings:** 6 classes. After the learnings escalation: P1 1 · P2 3 · P3 2.
- Filed: 5. Declined (out of scope): 1. Investigate-first: 0. Rejected: 0.

**Handoff assessment:** no builder handoff existed when the review ran. The kickoff decisions (the optional wait figure, and all path refusals under `LOCAL_REFUSED_PATH`) are recorded in commits `428ec1c` and `e1138ce`.

### Key findings

| Severity | Class | Category | Todo |
|---|---|---|---|
| P1 (P2→P1 via RC-31) | unbounded-growth: sync pads scale memory with `max` × hosts | performance / security | 024 |
| P2 | missing-validation: `@ts-expect-error` guards never type-checked by a gate | testing / tooling | 025 |
| P2 | convention-drift: unknown `rateLimit` keys handled three ways | config | 026 |
| P2 (P3→P2 via RC-46) | duplicated-logic: path refusals rendered two ways | refusal shape | 027 |
| P3 | missing-constraint: redirect refusal arm allows a wait on any reason | typescript | 028 |
| P3 | stale-comment: docs/configuration.md and the `configure` `@throws` restate the old `rateLimit` shape and text | docs | — declined, out of scope |

Why the `stale-comment` class was declined:
- every confirmed instance is outside the diff (`docs/configuration.md`, and the `McpCurlServer.configure` doc-block);
- the plan gives `docs/configuration.md`'s `rateLimit.syncFromHeaders` and refusal text to PR-5, task 18.

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | `npx vitest run` before the review | 1761 passed, 7 skipped, 0 failed |
| Types check | `npx tsc --noEmit -p .` | clean. tsconfig includes the tests, but no npm script runs it (todo 025) |
| Header-name rule reused, not re-implemented | pattern-recognition-specialist, security-sentinel | holds: `WRITE_OUT_HEADER_NAME` is the one predicate |
| Sync count parsed once | pattern-recognition-specialist | holds: only `parseResponseWithMetadata` parses it |
| P1 sweep reproducible | orchestrator re-ran it | 2 candidates → 1 confirmed, matching both reviewers |

### Outstanding todos

| File | Priority | Description | Source |
|---|---|---|---|
| docs/todos/024-p1-sync-pads-scale-memory-with-max-not-traffic.md | P1 | One response grows a host log by up to `max` entries | performance-oracle, data-integrity-guardian; RC-31 |
| docs/todos/025-p2-ts-expect-error-guards-are-never-type-checked.md | P2 | No gate type-checks the tests | typescript-reviewer |
| docs/todos/026-p2-ratelimit-unknown-keys-handled-three-ways.md | P2 | `syncFromHeader` typo dropped silently | pattern-recognition-specialist |
| docs/todos/027-p2-path-refusals-rendered-two-ways.md | P2 | YAML `buildUrl` dot-segment text differs | pattern-recognition-specialist; RC-46 |
| docs/todos/028-p3-redirect-refusal-arm-allows-wait-on-any-reason.md | P3 | Redirect arm type is looser than its sibling | typescript-reviewer |

**Open classes without a todo:** none.

**Blockers:** P1, todo 024. It is in scope and filed. The work run escalates it to the operator before writing its own handoff sections or offering a PR.
