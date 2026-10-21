---
status: complete
severity: low
effort: s
tags: [code-review, public-api, types, rate-limiter]
dependencies: []
---

# HostRateLimit appears in the public config but is not exported from the package entry

## Problem Statement

`McpCurlConfig.rateLimit` is typed `HostRateLimit`, and `src/lib.ts` does not re-export
that type. A consumer who builds a limit separately therefore has two options:
- write `NonNullable<McpCurlConfig["rateLimit"]>`, or
- deep-import `lib/types/rate-limit.js`, an internal path the barrel exists to hide.

## Findings

Reviewer: typescript-reviewer (P3, `convention-drift`; the reviewer's note says the
defect is really an incomplete public type surface).

**Instances** (confirmed):
- `src/lib/types/public.ts::McpCurlConfig`: `rateLimit?: HostRateLimit` (in the diff)
- `src/lib.ts`, section "5. Public API types": exports `McpCurlConfig` and not `HostRateLimit`. Not in the diff.

**Sweep:** `rg -n "HostRateLimit" src/lib.ts` returns nothing (reproduced by the orchestrator).

## Proposed Solutions

### Option 1: export it

Add `HostRateLimit` to the `export type { … }` block in `src/lib.ts`. Invariant 11 makes
this additive and MINOR, which fits release 5.1.0.
**Effort:** s · **Risk:** none

### Option 2: inline the shape in `McpCurlConfig`

Inline `{ max: number; windowMs: number }`, and have the limiter take
`NonNullable<McpCurlConfig["rateLimit"]>`.
**Cons:** this makes `security/` import a public config type.
**Effort:** s

## Recommended Action

**Option 1.** Export the type.

## Acceptance Criteria

- [x] `import type { HostRateLimit } from "mcp-curl"` compiles.

## Work Log

### 2026-10-21 - Filed from Surface 2 review of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Reproduced the sweep.

### 2026-10-21 - Resolved

**By:** Claude Code
**Actions:**
- `types/public.ts` re-exports `HostRateLimit`, and `src/lib.ts` exports it.
- It is pinned in the `src/lib.test.ts` type list.
- Probe: dropping the re-export makes `tsc` report TS2459 at `src/lib.ts`.
