---
status: pending
severity: medium
effort: s
tags: [code-review, stale-observation, host-policy, api-server, yaml-tools]
dependencies: []
pr: ""
---

# YAML endpoint tools capture the host policy at createApiServer time while curl_execute reads the config frozen at start()

## Problem Statement

`configureServerFromSchema` evaluates `deriveHostPolicy(server.getConfig())` once, at construction. `createApiServer` returns an unstarted server that still accepts `configure()`. A later `configure({ allowedHosts: [...] })` scopes `curl_execute` but not the YAML tools, contradicting the new comment ("cannot open the YAML tools wider than curl_execute"). Aliases: `misplaced-decision`.

## Findings

- Instances:
  - `src/lib/api-server.ts::configureServerFromSchema` — `hostPolicy: deriveHostPolicy(server.getConfig())` — confirmed (in diff)
  - `src/lib/api-server.ts::configureServerFromSchema` — `allowLocalhost: mergedConfig.allowLocalhost`, same snapshot shape — confirmed, **out of scope** (pre-existing sibling)
- Sweep: `rg -n 'deriveHostPolicy\(' src -g '!*.test.ts'` → 5 → 1 snapshot.
- Failure: `createApiServer({ ..., config: { allowedHosts: "any" } })`, then `configure({ allowedHosts: ["api.a.com"] })`, then `start()`: YAML tools still run with "any".
- Population: an embedder configuring after `createApiServer`; no doc shows that pattern, but the API allows it.
- Reviewers: security-sentinel (P3), typescript-reviewer (P3), architecture-strategist (P2). Merged on shared confirmed instance; highest severity kept.

## Proposed Solutions

### Option 1: Pass a getter `() => deriveHostPolicy(server.getConfig())` (recommended)
**Effort:** s. Reads `_frozenConfig` after start.

### Option 2: Make the createApiServer result refuse further `configure()`
**Cons:** behaviour change for an exported API.

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] `createApiServerSync(schema, { config: { allowedHosts: "any" } })` → `configure({ allowedHosts: [] })` → start → YAML tool call returns `LOCAL_HOST_NOT_ALLOWED`.
- [ ] The api-server comment matches behaviour.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
