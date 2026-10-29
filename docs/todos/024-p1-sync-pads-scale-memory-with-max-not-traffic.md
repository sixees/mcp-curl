---
status: pending
severity: high
effort: m
tags: [code-review, performance, security, rate-limiter, header-sync]
dependencies: []
pr: ""
---

# One upstream response grows a host's sliding log by up to `max` entries

## Problem Statement

`rateLimit.syncFromHeaders` lets a response header pad the answering host's sliding log up to `max − remaining` entries in one call. The log stores one array element per unit of quota. So retained memory follows the configured `max` multiplied by the number of distinct hosts that answer, not the requests admitted. Before this branch, a log grew only by one entry per admitted request.

**Severity:** reviewers graded this P2 (performance-oracle) and P3 (data-integrity-guardian). It is escalated to **P1** because `.sixees/LESSONS.md` → RC-31 records `unbounded-growth` as a divergence this codebase has already been burned by (Surface 2, `/sixees-workflow:review` §4.1).

## Findings

- **Class:** a rate-limit log stores one element per unit of quota, and a single remote-supplied count can write the whole quota in one call.
- **Failure:** with `rateLimit: { max: 5000, windowMs: 3_600_000, syncFromHeaders: { remaining: "x-ratelimit-remaining" } }` and a host policy that admits many hosts, each host answering `remaining: 0` adds 5,000 numbers for an hour.
  - Measured: 3,000 hosts use 160.7 MB, against 1.1 MB without sync.
  - Extrapolated at the `MAX_TRACKED_KEYS` cap (30,000): about 1.6 GB. At max 50,000 the process runs out of memory.
  - A single host at max 10M retains 119 MB.
- **Instances:**
  - `src/lib/security/rate-limiter.ts::applyServerRemaining` — `while (log.length < used) log.push(now);` — confirmed (in diff)
  - `src/lib/tools/curl-execute.ts::executeCurlRequest` — calls it on every hop, including hosts a redirect chose — confirmed (in diff; this is the reach, not a second writer)
- **Sweep:** `rg -n "while \(.*\.length\s*<|for \(let .*< *(used|count|remaining|max)\b|new Array\(|Array\.from\(\{ *length|\.fill\(" src --glob '!*.test.ts'` — 2 candidates → 1 confirmed. The other hit is a test fixture. The orchestrator reproduced this sweep.
- **Root:** source — the log represents quota units as elements, and `applyServerRemaining` is the first writer that adds more than one per event.
- **Population:** reaching this needs an embedder to configure `syncFromHeaders` together with a large `max` or a wide host list. The one known consumer uses a single `baseUrl` host with an hourly quota of about 240. That suggests the population is small, but this todo leaves that call to the operator.
- **Reviewers:** performance-oracle (P2, measured), data-integrity-guardian (P3).

## Proposed Solutions

### Option 1: Run-length log
**Approach:** Store `[stamp, count]` runs plus a running total.
- `checkSlidingHostLimit` compares `total >= max`.
- `pruneLog` drops expired runs and subtracts their counts.
- `applyServerRemaining` appends one run.

**Pros:** memory is O(events) whatever `max` is; tighten-only behaviour and expiry are unchanged.
**Cons:** touches the admission path, and `slidingLogLength` has to report the weighted total.
**Effort:** m · **Risk:** medium (core limiter)

### Option 2: One pad record per host
**Approach:** Keep a `{ padAt, padCount }` per host beside the log. Admission compares `log.length + padCount` against `max`, and the pad expires when `padAt` leaves the window.
**Pros:** a smaller change than Option 1.
**Cons:** two representations of one count; the sweep has to handle both.
**Effort:** m · **Risk:** medium

### Option 3: Cap `max` in `parseHostRateLimit`
**Pros:** one line.
**Cons:** limits a legitimate configuration to work around how the data is stored, and the many-hosts multiplier remains.
**Effort:** s · **Risk:** low

## Recommended Action

_(pending — the operator chooses)_

## Acceptance Criteria

- [ ] After `applyServerRemaining(host, 0)` with `max: 10_000_000`, the host's stored element count is O(1), and the next `checkRateLimits(host)` throws `LOCAL_RATE_LIMITED`.
- [ ] Two hosts padded under a large `max` use storage independent of `max`.
- [ ] The existing limiter tests (sliding, expiry, backward clock, capacity) still pass.
- [ ] Teeth probe: reverting to per-element padding fails the storage-size test.

## Work Log

### 2026-10-29 - Filed from Surface 2 review of feat/header-sync-refusal-shape
**By:** Claude Code
**Actions:** Merged performance-oracle and data-integrity-guardian findings on a shared confirmed instance. Escalated P2 → P1 on an RC-31 class-id match. Reproduced the sweep.
**Learnings:** `MAX_TRACKED_KEYS` bounds the map's keys, not its memory.
