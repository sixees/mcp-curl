---
status: pending
severity: medium
effort: s
tags: [code-review, correctness, rate-limiter, extensible, mcp-curl-server, lifecycle]
dependencies: []
---

# Recorded admissions are discarded whenever ownership changes, even for an identical limit, so a restart gets a fresh quota inside the window

## Problem Statement

`releaseHostRateLimit` and `installHostRateLimit` both clear `hostSlidingLog`. An empty
log is then read as "nothing admitted recently". The install docblock gives the reason:
"a log recorded under one window says nothing about another". That reason covers a
changed limit. It does not cover an identical one.

**Failure:**
1. An embedder sets `rateLimit: { max: 100, windowMs: 3_600_000 }` to stay under an hourly upstream quota.
2. They spend 100 requests.
3. They call `shutdown()` and then `start()` on the same instance. `shutdown()` resets state "to allow potential reuse". A second server with the same limit taking over after the first shuts down has the same effect.
4. The next 100 requests are admitted at once, so 200 go out within the hour. That is the `2 × max` burst the rate-limiter header says the sliding log exists to prevent.

`docs/configuration.md` already says a process restart starts the counter from zero.
It does not say an in-process restart does.

**Who is affected:** an embedder who restarts a server in-process, or hands the limit
from one server to another, against an hourly quota. Whether anyone does is the
operator's call (rule 42). The reviewer could not answer it from the diff.

## Findings

Reviewer: data-integrity-guardian (P3, `fail-open-default`. Its note says the defect is
more exactly lost state at handover).

**Escalated to P2 by the learnings join.** learnings-researcher assigned RC-31 the
`Class` `fail-open-default`, the same coarse, noun-only join as todo 022. This class
shares that `class-id` with 022 and has no instance in common with it. The two are
kept apart because their instance lists say they are different defects (review-findings
→ *one noun will carry several distinct defects*).

**Instances** (both in the diff):
- `src/lib/security/rate-limiter.ts::releaseHostRateLimit`: `hostSlidingLog.clear()` on release. Confirmed.
- `src/lib/security/rate-limiter.ts::installHostRateLimit`: `hostSlidingLog.clear()` on install. Confirmed.

**Sweep:** `rg -n "\.clear\(\)" src/lib/security/ --glob '!*.test.ts'` finds 8
candidates, of which 2 are confirmed (reproduced by the orchestrator). The other 6 are
not instances:
- `cleanupExpiredLogs` runs only when no limit is installed.
- `clearRateLimitMaps` is test-only.
- 4 clear other maps.

## Proposed Solutions

### Option 1: keep the log when the new limit equals the old one

Clear it only when `{ max, windowMs }` actually changes. Pruning by `windowMs` already
drops stale entries.
**Effort:** s · **Risk:** low

### Option 2: never clear on release

Keep the log until the next install decides, so it survives the gap between two servers.
**Effort:** s · **Risk:** low

### Option 3: document it

State in the `installHostRateLimit` docblock and in `docs/configuration.md` that an
in-process restart or handover starts a new quota.
**Effort:** s

## Recommended Action

_Pending._

## Acceptance Criteria

- [ ] In the "McpCurlServer rateLimit lifecycle" block, with `max: 1`: start, make one request, shut down, start the same instance again. The next request is refused with `Rate limit exceeded for host` (Options 1 and 2). For Option 3, the docs state the reset.
- [ ] Teeth: reverting the fix fails that test.

## Work Log

### 2026-10-21 - Filed from Surface 2 review (round 2) of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Reproduced the sweep (8 candidates, 2 confirmed), and escalated P3 to P2 on
the RC-31 `Class` join.
