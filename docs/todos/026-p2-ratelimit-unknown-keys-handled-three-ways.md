---
status: pending
severity: medium
effort: s
tags: [code-review, config, rate-limiter, convention]
dependencies: []
pr: ""
---

# Unknown-key handling differs across the nesting levels of one config object

## Problem Statement

`configure()` warns on and drops an unknown top-level key. `parseHostRateLimit` silently drops an unknown `rateLimit` key. The new `parseSyncFromHeaders` throws on any key other than `remaining`, citing "a setting the operator expects to act and that nothing would read". That reason applies just as well one level up, where it is not enforced.

## Findings

- **Failure:** `configure({ rateLimit: { max: 240, windowMs: 3_600_000, syncFromHeader: { remaining: "X-RateLimit-Remaining" } } })` (note the typo) succeeds with no warning. Header sync never runs, and the server overspends a shared quota, which is exactly what `syncFromHeaders` exists to prevent.
- **Instances:**
  - `src/lib/security/rate-limiter.ts::parseSyncFromHeaders` — throws (in diff) — confirmed
  - `src/lib/security/rate-limiter.ts::parseHostRateLimit` — drops unknown keys; this diff extended its destructure — confirmed
  - `src/lib/extensible/mcp-curl-server.ts::configure` — warns at the top level — confirmed (unchanged)
- **Sweep:** `rg -n 'Object\.keys\([^)]*\)\.filter|unknown key|accepts only|must be an object|function parse[A-Z]' src/lib --glob '!*.test.ts'` — 6 candidates → 3 confirmed.
- **Reviewer:** pattern-recognition-specialist (P2, `convention-drift`).

## Proposed Solutions

### Option 1: `parseHostRateLimit` throws on keys outside `max`, `windowMs`, `syncFromHeaders`
Share one `Object.keys(...).filter` helper with `parseSyncFromHeaders`.
**Pros:** a typo fails `configure()`.
**Cons:** an embedder passing an extra key today starts to throw (a behaviour change, to be named in the CHANGELOG).
**Effort:** s · **Risk:** low

### Option 2: Warn rather than throw at the `rateLimit` level
**Pros:** non-breaking.
**Cons:** two policies inside one object remain.
**Effort:** s · **Risk:** low

## Recommended Action

_(pending — the operator chooses)_

## Acceptance Criteria

- [ ] `parseHostRateLimit({ max: 5, windowMs: 60_000, syncFromHeader: {...} })` throws (or warns) naming `syncFromHeader`, at the unit level and through `McpCurlServer.configure`.
- [ ] The `configure` `@throws` doc-block matches the chosen policy.

## Work Log

### 2026-10-29 - Filed from Surface 2 review of feat/header-sync-refusal-shape
**By:** Claude Code
**Actions:** Filed from the pattern-recognition-specialist finding.
**Learnings:** a strict nested check invites the same question of its parent.
