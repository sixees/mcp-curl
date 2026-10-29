---
status: pending
severity: medium
effort: s
tags: [code-review, testing, typescript, tooling]
dependencies: []
pr: ""
---

# A compile-time "must not compile" assertion that no gate type-checks

## Problem Statement

Several tests guard a type with `@ts-expect-error`. `npm test` runs `vitest run`, which strips types without checking them. `npm run build` (tsup `dts`) only checks files reachable from the four entry points. No CI workflow runs `tsc` over the tests. So a guarded type can be loosened and every gate stays green.

## Findings

- **Failure:** widening `LocalRefusal`'s nothing-sent arm from `retryAfterSeconds?: C extends "LOCAL_RATE_LIMITED" ? number : never` to `number` lets a host-list refusal carry "Retry in N s.", and `npm test` and `npm run build` both pass.
  - Measured by the orchestrator: `npx tsc --noEmit -p .` **does** fail with `TS2578: Unused '@ts-expect-error' directive` at `error.test.ts` under that edit. `tsconfig.json` includes `src/**/*`. Nothing runs it automatically.
- **Instances:**
  - `src/lib/utils/error.test.ts::"does not compile a wait on a code no rate limit produces"` — added on this branch — confirmed
  - pre-existing guards in `src/lib/utils/error.test.ts` (×2), `src/lib/response/defend-text.test.ts`, `src/lib.test.ts` and `src/lib/api-server.test.ts` — confirmed by the reviewer, and outside this diff
- **Sweep:** `@ts-expect-error` over `src/` — 9 hits, 6 type-level guards (the 2 in `post-processor.test.ts` exercise a runtime guard).
- **Root:** source — the project has no type-check gate over test files.
- **Reviewer:** typescript-reviewer (P2, class-id `missing-validation`; the defect is really a false green, K-1).

## Proposed Solutions

### Option 1: Add `"typecheck": "tsc --noEmit"` and run it from `test`
**Pros:** one line; covers all six guards.
**Cons:** adds a few seconds to `npm test`.
**Effort:** s · **Risk:** low

### Option 2: vitest `typecheck` mode, moving guards to `expectTypeOf`
**Pros:** keeps everything in one runner.
**Cons:** rewrites the existing guards; vitest's typecheck mode has its own configuration.
**Effort:** m · **Risk:** low

## Recommended Action

_(pending — the operator chooses)_

## Acceptance Criteria

- [ ] `npm test` (or a script it runs) fails when a `@ts-expect-error` guard becomes unused.
- [ ] Teeth probe: widening the `retryAfterSeconds` conditional fails the gate.

## Work Log

### 2026-10-29 - Filed from Surface 2 review of feat/header-sync-refusal-shape
**By:** Claude Code
**Actions:** Probed by widening the conditional; `tsc --noEmit` caught it and `vitest` did not.
**Learnings:** a type guard is only as strong as the gate that type-checks it.
