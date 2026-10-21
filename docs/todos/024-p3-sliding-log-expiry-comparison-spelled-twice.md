---
status: complete
severity: low
effort: s
tags: [code-review, duplication, rate-limiter, security]
dependencies: []
---

# The sliding-log expiry comparison is written out twice instead of in one shared check

## Problem Statement

The per-request check and the background sweep each decide for themselves whether a
timestamp has left the window. The fixed-window code in the same module sends both of
these decisions through `windowClosed`, so they cannot disagree.

If someone changes the boundary in one copy only, the two stop agreeing:
- If the sweep deletes a log the check still counts, the host can make more than `max` requests in one window.
- In the reverse case, expired hosts stay tracked and use up `MAX_TRACKED_KEYS`.

RC-62 records the same shape for a comparator: state it once and use it on both sides.

## Findings

Reviewer: pattern-recognition-specialist (P3, `duplicated-logic`).

**Instances** (confirmed):
- `src/lib/security/rate-limiter.ts::pruneLog`: `now - log[expired] >= windowMs`
- `src/lib/security/rate-limiter.ts::cleanupExpiredLogs`: `now - log[log.length - 1] >= hostLimit.windowMs`
- The convention this departs from: `rate-limiter.ts::windowClosed`, which both `checkRateLimitInternal` and `cleanupExpiredEntries` use.

**Sweep:** `rg -n 'now - .*>= ' src/lib/security/rate-limiter.ts` found 3 candidates.
2 are confirmed new copies; the third is `windowClosed` itself (reproduced by the
orchestrator).

## Proposed Solutions

### Option 1: one `leftWindow(t, now, windowMs)` beside `windowClosed`

Call it from `pruneLog` and `cleanupExpiredLogs`, and optionally express `windowClosed`
through it as well.
**Effort:** s · **Risk:** low

### Option 2: decline

There are two sites and both were written in the same commit, and the boundary is
pinned by the slide test. The drift is possible, but nobody is editing either site.
**Effort:** none

## Recommended Action

**Option 1.** `leftWindow` sits beside `windowClosed`, and `windowClosed` is expressed through it.

## Acceptance Criteria

- [x] The two sites share one comparison.
- [x] A boundary test at exactly `windowMs` shows the check and the sweep agree.

## Work Log

### 2026-10-21 - Filed from Surface 2 review of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Reproduced the sweep.

### 2026-10-21 - Resolved

**By:** Claude Code
**Actions:**
- `rate-limiter.ts::leftWindow` is now used by `pruneLog`, `cleanupExpiredLogs` and `windowClosed`.
- New test: "check and sweep agree at exactly windowMs".
- Probe: changing the sweep's comparison to `>` fails that test.
