---
status: pending
severity: high
effort: s
tags: [code-review, security, fail-open-default, host-policy, schema, generator]
dependencies: []
pr: ""
---

# A security policy supplied by the caller is overwritten by a permissive default in the YAML tool handler

## Problem Statement

`generator.ts::createToolHandler` builds `execExtra` as `{ ...extra, allowLocalhost: config?.allowLocalhost ?? extra?.allowLocalhost, hostPolicy: config?.hostPolicy ?? ANY_HOST_POLICY }`. A caller of a `generateToolDefinitions` handler that passes `extra.hostPolicy` has it silently replaced with `"any"`; the `allowLocalhost` line beside it resolves precedence the other way. **Recurred:** class `fail-open-default` matches RC-31 and RC-56 in `.sixees/LESSONS.md`, so this was raised from P2 to P1 per `/sixees-workflow:review` §4.1.

## Findings

- Instances:
  - `src/lib/schema/generator.ts::createToolHandler` — `hostPolicy: config?.hostPolicy ?? ANY_HOST_POLICY` after `...extra` — confirmed (in diff)
- Sweep: `rg -n 'hostPolicy' src -g '!*.test.ts'` → 7 non-comment sites; every other one passes a config-derived policy or is the executor's own default → 1 confirmed.
- Failure: `const [tool] = generateToolDefinitions(schema); tool.handler(params, { hostPolicy: deriveHostPolicy({ allowedHosts: [] }) })` sends the request.
- Merged with code-simplicity-reviewer's `dead-code` finding on the same `path::symbol` (aliases: `dead-code`). That reviewer proposed deleting `?? ANY_HOST_POLICY`; the orchestrator does **not** recommend that: it would leave `hostPolicy: undefined` reachable at runtime, the RC-54 shape the structural test exists to stop.
- Related (notes from three reviewers, not separate findings): `src/lib/tools/executor-call-sites.test.ts::passesHostPolicy` accepts any expression that is not literally `undefined` — including `?? ANY_HOST_POLICY` — and its header claims "no in-library caller falls back to 'any'", which this site contradicts (K-1).
- Reviewers: typescript-reviewer (P2), code-simplicity-reviewer (P3, `dead-code`).

## Proposed Solutions

### Option 1: `config?.hostPolicy ?? extra?.hostPolicy ?? ANY_HOST_POLICY` (recommended)
**Pros:** server config still wins (createApiServer invariant); caller's policy honoured; matches `allowLocalhost`. **Effort:** s.

### Option 2: Drop the fallback, let the executor default
**Cons:** reintroduces a possibly-undefined key (RC-54). Not recommended.

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] A generated handler called with no `config.hostPolicy` and `extra.hostPolicy` = empty list refuses with `LOCAL_HOST_NOT_ALLOWED`, `validateUrlAndResolveDns` not called.
- [ ] `executor-call-sites.test.ts` header states what it actually checks.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
