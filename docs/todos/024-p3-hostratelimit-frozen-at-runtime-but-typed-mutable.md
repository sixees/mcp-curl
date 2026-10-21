---
status: pending
severity: low
effort: s
tags: [code-review, types, public-api, rate-limiter, config]
dependencies: []
---

# HostRateLimit is frozen at runtime but typed with mutable fields

## Problem Statement

`configure()` stores `rateLimit` as an `Object.freeze`d copy, but `HostRateLimit` has
mutable fields. `Readonly<McpCurlConfig>` is shallow, so
`server.getConfig().rateLimit!.max = 500` compiles. In an ESM (strict-mode) module it
then throws `TypeError: Cannot assign to read only property 'max'`. The embedder gets a
runtime crash where the type could have given a compile error.

## Findings

Reviewer: typescript-reviewer (P3, `convention-drift`).

**Instances** (both in the diff):
- `src/lib/types/rate-limit.ts::HostRateLimit`: `max: number; windowMs: number;` with no `readonly`. Confirmed.
- `src/lib/types/public.ts::McpCurlConfig.rateLimit`: `rateLimit?: HostRateLimit`, exported from `src/lib.ts`. Confirmed.

**Sweep:** McpCurlConfig's frozen fields compared with their types gives 3 candidates.
1 is in this diff:
- `allowedOrigins` is `readonly string[]`, which matches how it is frozen.
- `defaultHeaders` is frozen and not readonly, but that predates this branch, so it is not filed.

## Proposed Solutions

### Option 1: `readonly` fields on `HostRateLimit`

Callers still pass object literals unchanged.
**Effort:** s · **Risk:** none

### Option 2: `rateLimit?: Readonly<HostRateLimit>` on `McpCurlConfig`

This follows the `allowedOrigins` precedent and leaves the limiter's internal type
unchanged.
**Effort:** s · **Risk:** none

## Recommended Action

_Pending._

## Acceptance Criteria

- [ ] A type-level pin in `src/lib.test.ts`: `// @ts-expect-error` on `({} as McpCurlConfig).rateLimit!.max = 1` passes `tsc`.

## Work Log

### 2026-10-21 - Filed from Surface 2 review (round 2) of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Read the instances.
