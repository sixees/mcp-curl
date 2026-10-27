---
status: pending
severity: low
effort: s
tags: [code-review, convention-drift, public-api, host-policy, schema]
dependencies: []
pr: ""
---

# A public config field is typed with HostPolicy, which no entry point exports or lets a consumer build

## Problem Statement

`GeneratorConfig.hostPolicy` and `CurlExecuteExtra.hostPolicy` are on exported types, but `HostPolicy`, `deriveHostPolicy` and `parseAllowedHosts` are not exported from `mcp-curl`, `mcp-curl/lib` or `mcp-curl/schema`. A consumer must hand-build `{ kind: "list", hosts: new Set([...]) }`, which is never canonicalised, so a mixed-case or trailing-dot entry refuses every request (fails closed). `src/lib.ts` §8's stated convention is custom-tool parity without deep imports.

## Findings

- Instances (confirmed, in diff):
  - `src/lib/schema/generator.ts::GeneratorConfig`
  - `src/lib/tools/curl-execute.ts::CurlExecuteExtra`
- Sweep: `HostPolicy` across src non-test → 3 files → 2 public-surface instances; `HostPolicy|deriveHostPolicy|parseAllowedHosts` in the three entry files → 0.
- Not merged with the doc-claim todo filed in this run, though both cite `CurlExecuteExtra`: the shared symbol hosts two unrelated defects.
- Reviewer: architecture-strategist (P3).

## Proposed Solutions

### Option 1: Public field speaks `allowedHosts?: readonly string[] | "any"`, derived internally (recommended)
### Option 2: Export `HostPolicy` and `deriveHostPolicy` (new public type under invariant 11)

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] A consumer can scope generated tools using only public exports; a mixed-case entry reaches its own host.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
