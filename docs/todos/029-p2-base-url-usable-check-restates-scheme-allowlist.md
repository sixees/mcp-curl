---
status: pending
severity: medium
effort: s
tags: [code-review, duplicated-logic, host-policy, config, url]
dependencies: []
pr: ""
---

# "Is baseUrl an absolute http(s) URL?" is answered by two implementations, one restating the scheme allowlist inline

## Problem Statement

`deriveHostPolicy` checks `base.protocol === "http:" || base.protocol === "https:"`; `resolveRequestUrl` answers the same question with `isAllowedUrlScheme`, whose own doc forbids the inline form. If the allowlist ever changes, `start()` and the request path disagree about the same `baseUrl`. **Recurred:** class `duplicated-logic` matches RC-27, raised P3 → P2 per `/sixees-workflow:review` §4.1.

## Findings

- Instances (confirmed):
  - `src/lib/config/security/host-policy.ts::deriveHostPolicy` — inline scheme literals (in diff)
  - `src/lib/utils/url.ts::resolveRequestUrl` — `isAllowedUrlScheme(new URL(baseUrl).protocol)` (existing)
- Sweep: `rg -n '"https?:"' src/lib -g '!*.test.ts'` → 2 candidates outside `url-schemes.ts` and comments → 1 confirmed (`security/ssrf.ts::validateUrlAndResolveDns` compares `"https:"` only to pick a default port, not to admit a scheme); `rg -n "new URL\(" src/lib -g '!*.test.ts'` → 7 → 2 confirmed as "is baseUrl usable".
- Reviewer: pattern-recognition-specialist (P3).

## Proposed Solutions

### Option 1: One `baseUrlHost(baseUrl): string | undefined` helper used by both (recommended)
### Option 2: Minimum — call `isAllowedUrlScheme` in `deriveHostPolicy`

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] One implementation answers "usable baseUrl"; a table test asserts `deriveHostPolicy` throws exactly when `resolveRequestUrl` refuses.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
