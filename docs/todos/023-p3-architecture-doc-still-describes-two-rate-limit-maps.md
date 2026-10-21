---
status: pending
severity: low
effort: s
tags: [code-review, docs, rate-limiter, architecture-doc]
dependencies: []
---

# The architecture doc still describes the rate limiter as two fixed-window maps

## Problem Statement

This branch partly updated `docs/architecture/architecture.md`. Two sibling sentences
still describe the old construction of the rate limiter, so the document contradicts
itself. A reader of either sentence would conclude that the sliding log is outside the
`MAX_TRACKED_KEYS` cap, or that only `checkRateLimitInternal` enforces that cap.

## Findings

Reviewer: architecture-strategist (P3, `stale-comment`). Out of lane, from
pattern-recognition-specialist: one more stale citation of the same kind, in a code
comment this branch made stale.

**Instances** (all confirmed):
- `docs/architecture/architecture.md · section: Data Stores`: the row reads "Rate limiter | Two `Map`s (host, client) | Fixed-window counters".
- `docs/architecture/architecture.md · section: Rate Limiting`: "enforced at the write in `rate-limiter.ts::checkRateLimitInternal`". The rule now lives in `rate-limiter.ts::ensureCapacity`, which `checkSlidingHostLimit` also reaches.
- `src/lib/security/bounded-throttle.ts`, the header and the `setBounded` docblock: "the rejecting half lives at its two call sites" and they name `checkRateLimitInternal`. Out of the diff, but this branch made the citation stale.

**Sweep:** `rg -n "Two \`Map\`s|checkRateLimitInternal" docs/architecture/architecture.md src/lib/security/bounded-throttle.ts`
found 3 stale sites, all 3 confirmed (reproduced by the orchestrator).

## Proposed Solutions

### Option 1: correct all three in place

Change the Data Stores row to "Three `Map`s — host and client fixed-window counters,
plus a per-host timestamp log while `rateLimit` is set". Name `ensureCapacity` as the
enforcement site in the cap paragraph and in `bounded-throttle.ts`.
**Effort:** s · **Risk:** none

### Option 2: run `/sixees-workflow:sync-comments --branch` before the PR

That command catches the code-comment instance and the two touched doc sections.
**Effort:** s · **Risk:** none

## Recommended Action

_Pending._

## Acceptance Criteria

- [ ] No sentence in `docs/architecture/architecture.md` says the rate limiter holds two maps, or that the cap is enforced only in `checkRateLimitInternal`.
- [ ] `bounded-throttle.ts` cites `rate-limiter.ts::ensureCapacity`.

## Work Log

### 2026-10-21 - Filed from Surface 2 review of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Reproduced the sweep (3 sites).
**Learnings:** The doc edit updated the sentences that state "60/min". It missed the
sentences that state the structure.
