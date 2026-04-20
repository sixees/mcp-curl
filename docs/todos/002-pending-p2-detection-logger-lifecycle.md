---
status: pending
priority: p2
issue_id: "002"
tags: [spr-dry, architecture, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# Detection Logger Missing Lifecycle Wrappers (DRY vs Rate Limiter Pattern)

## Problem Statement

`detection-logger.ts` exposes `cleanupInjectionDetectionMap()` but does NOT provide `startInjectionCleanup()` / `stopInjectionCleanup()` lifecycle wrappers — unlike the sibling `rate-limiter.ts`, which encapsulates its `setInterval` into `startRateLimitCleanup()` / `stopRateLimitCleanup()`.

This forces `mcp-curl-server.ts` to:
1. Hardcode the magic number `60_000` (duplicating `THROTTLE_WINDOW_MS` from `detection-logger.ts`)
2. Directly manage `setInterval` / `clearInterval` in three separate locations (start, shutdown, rollback)

The `THROTTLE_WINDOW_MS` constant is defined in `detection-logger.ts` but is NOT exported, so the caller can't reference it. If the throttle window changes, the interval frequency in `mcp-curl-server.ts` will silently drift.

## Findings

- `src/lib/security/detection-logger.ts:4` — `const THROTTLE_WINDOW_MS = 60_000` (not exported)
- `src/lib/extensible/mcp-curl-server.ts:349` — `setInterval(cleanupInjectionDetectionMap, 60_000)` (hardcoded)
- `src/lib/extensible/mcp-curl-server.ts:386-388` — manual `clearInterval` in `shutdown()`
- `src/lib/extensible/mcp-curl-server.ts:464-479` — manual `clearInterval` in rollback path
- Compare: `src/lib/security/rate-limiter.ts:90-107` — encapsulates interval into `startRateLimitCleanup()` / `stopRateLimitCleanup()`

## Proposed Solutions

### Option 1: Add startInjectionCleanup / stopInjectionCleanup (Mirrors Rate Limiter)

Add lifecycle wrappers to `detection-logger.ts` matching the rate-limiter pattern:

```typescript
export function startInjectionCleanup(): NodeJS.Timeout {
    const interval = setInterval(cleanupInjectionDetectionMap, THROTTLE_WINDOW_MS);
    interval.unref();
    return interval;
}

export function stopInjectionCleanup(interval: NodeJS.Timeout): void {
    clearInterval(interval);
}
```

Update `mcp-curl-server.ts` to call these instead of raw `setInterval`/`clearInterval`.

**Pros:**
- Exactly mirrors the established rate-limiter pattern — consistent
- Single source of truth for `THROTTLE_WINDOW_MS`
- `mcp-curl-server.ts` no longer needs to know the cleanup frequency

**Cons:**
- Small API surface increase on detection-logger

**Effort:** 30–45 minutes

**Risk:** Low

---

### Option 2: Export THROTTLE_WINDOW_MS and Keep Inline Interval

Export the constant so `mcp-curl-server.ts` can reference it rather than duplicating the magic number.

```typescript
export const THROTTLE_WINDOW_MS = 60_000;
```

**Pros:**
- Minimal change

**Cons:**
- Still inconsistent with rate-limiter pattern
- `mcp-curl-server.ts` still manages three `clearInterval` sites manually

**Effort:** 5 minutes

**Risk:** Low

---

## Recommended Action

Option 1 — add lifecycle wrappers and update `mcp-curl-server.ts`. Keeps all cleanup concerns in one module and matches the established rate-limiter pattern.

## Technical Details

**Affected files:**
- `src/lib/security/detection-logger.ts` — add `startInjectionCleanup` / `stopInjectionCleanup`; keep `THROTTLE_WINDOW_MS` private (used in interval setup)
- `src/lib/extensible/mcp-curl-server.ts:349,386-388,464-479` — replace raw setInterval/clearInterval with lifecycle calls

## Acceptance Criteria

- [ ] `startInjectionCleanup()` exported from `detection-logger.ts`
- [ ] `stopInjectionCleanup(interval)` exported from `detection-logger.ts`
- [ ] `mcp-curl-server.ts` uses lifecycle wrappers — no raw `setInterval(cleanupInjectionDetectionMap, ...)` calls
- [ ] No magic number `60_000` in `mcp-curl-server.ts` for injection cleanup
- [ ] All existing tests pass

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Compared detection-logger.ts API surface with rate-limiter.ts
- Located three manual clearInterval sites in mcp-curl-server.ts
- Identified duplicated magic number 60_000
