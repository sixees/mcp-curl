---
status: pending
severity: medium
effort: s
tags: [code-review, broken-contract, host-policy, extensible, utilities]
dependencies: []
pr: ""
---

# utilities().executeRequest gains a rejection path where it previously always returned an error result

## Problem Statement

`createInstanceUtilities`' `executeRequest` evaluates `deriveHostPolicy(config)` in the argument list, outside `executeCurlRequest`'s try. A config whose `baseUrl` cannot give a host (and no `allowedHosts`) makes the promise reject instead of resolving `{ isError: true }`. Plan M-12 chose "throws the same error at call time" for `utilities()` before `start()`, so this may be intended; the finding is that a result-returning API now has two failure channels. **Recurred:** class `broken-contract` matches RC-21, raised P3 → P2 per `/sixees-workflow:review` §4.1.

## Findings

- Instances:
  - `src/lib/extensible/instance-utilities.ts::createInstanceUtilities` — `hostPolicy: deriveHostPolicy(config)` — confirmed (in diff)
  - `src/lib/extensible/hook-executor.ts::executeWithHooks` — same expression — suspected-safe (config validated by `start()`)
- Sweep: `rg -n 'deriveHostPolicy\(' src -g '!*.test.ts'` → 5 → 1 can throw on a result-returning path.
- Failure: `createInstanceUtilities({ baseUrl: "api.example.com" }).executeRequest({ url: "https://api.example.com/x" })` rejects.
- Reviewer: typescript-reviewer (P3).

## Proposed Solutions

### Option 1: Keep the throw (plan M-12) and document it on `executeRequest`
### Option 2: Catch and return `{ isError: true }` with the server-authored message
### Option 3: Derive once in `createInstanceUtilities` so a bad config fails at construction

## Recommended Action

(Pending the operator's call; plan M-12 is the current decision.)

## Acceptance Criteria

- [ ] `executeRequest`'s documented failure channel matches its behaviour for an unusable `baseUrl`, with a test.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
