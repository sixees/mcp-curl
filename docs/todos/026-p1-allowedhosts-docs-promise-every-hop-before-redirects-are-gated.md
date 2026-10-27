---
status: pending
severity: high
effort: s
tags: [code-review, broken-contract, docs, host-policy, public-api, redirects]
dependencies: ["007"]
pr: ""
---

# Published allowedHosts contract promises a refused host is never contacted while redirect hops are still followed unchecked

## Problem Statement

PR-1 adds doc text stating the host list bounds every request ("A refused host is never resolved or contacted"; "The hosts this call may reach"; "a host off the list is never resolved"). `buildCurlArgs` still emits `-L`, so a 302 from a listed host to an off-list host is followed with `defaultHeaders`. The guarantee holds for hop 1 only until PR-3 (todo 007). **Recurred:** class `broken-contract` matches RC-21 in `.sixees/LESSONS.md`, raised P2 → P1 per `/sixees-workflow:review` §4.1.

## Findings

- Instances (all in diff, confirmed):
  - `src/lib/types/public.ts::McpCurlConfig` — `allowedHosts` doc-block
  - `src/lib/tools/curl-execute.ts::CurlExecuteExtra` — `hostPolicy` doc
  - `src/lib/tools/curl-execute.ts::executeCurlRequest` — comment before the host check
- Sweep: `rg -n 'never resolved|never resolved or contacted|hosts this call may reach' src -g '!*.test.ts'` → 3 → 3 confirmed.
- Reviewers: typescript-reviewer (P2); architecture-strategist noted the same in `notes:`.

## Proposed Solutions

### Option 1: Scope the docs to the request URL until PR-3 (recommended if PR-1 merges alone)
**Pros:** true at every commit on main. **Effort:** s.

### Option 2: Do not release PR-1 without PR-3
**Pros:** no doc churn. **Cons:** `main` carries the over-claim between merges; relies on discipline.

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] No doc-block on `main` claims the host list bounds redirect hops before the hop loop lands.
- [ ] PR-3 restates the claim when it becomes true.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
