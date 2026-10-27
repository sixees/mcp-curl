---
status: pending
severity: low
effort: s
tags: [code-review, missing-constraint, types, utils, local-refusal]
dependencies: []
pr: ""
---

# The LocalRefusal union admits refusals whose code, reason and requestsSent contradict each other

## Problem Statement

The non-redirect arm of `LocalRefusal` takes any `LocalRefusalReason` and does not forbid `requestsSent`; consumers narrow on `"requestsSent" in refusal` rather than on `code`. `LOCAL_RATE_LIMITED` + `host-not-allowed` compiles, as does a variable carrying `requestsSent: 2` on `LOCAL_HOST_NOT_ALLOWED`. `LOCAL_REFUSED_PATH` has no reason sentence yet (plan task 16 needs one). Unreachable today (one constructor call); reachable once PR-3/PR-4 add callers.

## Findings

- Instances (confirmed, in diff):
  - `src/lib/utils/error.ts::LocalRefusal`
  - `src/lib/utils/error.ts::LocalRefusalError`
  - `src/lib/utils/error.ts::LOCAL_REFUSAL_FIRST_LINES`
- Sweep: `rg -n 'new LocalRefusalError|requestsSent' src` → 1 production constructor + 3 type-level sites.
- Reviewer: typescript-reviewer (P3); code-simplicity-reviewer noted the `in` narrowing in `notes:`.

## Proposed Solutions

### Option 1: `requestsSent?: never` on the non-redirect arm, narrow on `code`, a per-code admissible-reason table checked both ways (recommended)
### Option 2: Per-code arms in the union

## Recommended Action

(Pending the operator's call; natural home is PR-3/PR-4, which add the callers.)

## Acceptance Criteria

- [ ] `// @ts-expect-error` fixtures for the two contradictory constructions.
- [ ] Every code has at least one admissible reason, set-tested both ways.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
