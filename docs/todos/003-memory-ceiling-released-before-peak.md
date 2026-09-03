---
id: 003
title: "The global memory ceiling is released before the phase that allocates most"
status: open
severity: P2
tags: [code-review, performance, pre-existing]
class-id: unbounded-growth
aliases: [stale-observation]
source: /sixees-workflow:review rounds 2-3, PR #32
reviewers: [performance-oracle, security-sentinel]
created: 2026-09-01
---

# The memory ceiling is released before the phase that allocates most

## Problem

`execution/command-executor.ts::executeCommand` calls `releaseRequestMemory()` in
its `close` handler, **before** it resolves. Everything downstream — the
`Buffer.concat`, the decodes, `defendText`, `sanitizeAndDetect`, jq, the file
save — runs with this request's accounting at zero, and the freed budget is
immediately available to admit new requests.

Measured by `performance-oracle` on a 10MB response: **30.1MB (ASCII) / 60.8MB
(invalid UTF-8) allocated after the release**. Two such requests overlapping
reach ~142MB live while `getCurrentMemoryUsage()` reads 0, against a
`MAX_TOTAL_RESPONSE_MEMORY` of 100MB. Nothing bounds concurrency: rate limits are
60/min/host and 300/min/client, and the HTTP transport allows 100 sessions.

## Why this is filed rather than fixed

**The release point is pre-existing** — verified with
`git show 16ebce1:src/lib/execution/command-executor.ts`, where the same line sits
in the same handler. PR #32 did not introduce it and, per `performance-oracle`'s
measurement, **improved** the peak it governs (45.3MB → 40.1MB ASCII; 106.3MB →
70.8MB for non-UTF-8 input) by concatenating buffers instead of growing a string.

Round 3 also removed the eager `stdout` decode and released the chunk references
at concat, cutting two of the five live copies. That mitigates the symptom
without moving the release point, which is the actual defect.

## Fix

Hold the accounting across the processing phase rather than the accumulation
phase — release in a `finally` in `executeCurlRequest` after `formatResponse`,
not in the executor's `close` handler. Since the peak is a multiple of the wire
size, the honest form accounts for that multiple rather than for the wire bytes
alone.

This moves ownership of memory accounting across a module boundary, which is why
it wants a review round of its own.

## Instances

- `src/lib/execution/command-executor.ts::executeCommand` — the `close` handler releases before `resolve` — confirmed, pre-existing
- `src/lib/tools/jq-query.ts::executeJqQuery` — reads up to 10MB from disk with **no** memory-tracker accounting at all. A different defect (no accounting vs. accounting released early), flagged by `performance-oracle`, also pre-existing — confirmed

## Sweep

```bash
rg -n 'allocateMemory|releaseMemory|releaseRequestMemory' src --type ts -g '!*.test.ts'
```

7 `releaseRequestMemory()` call sites → 6 are abort/error paths where early
release is correct; 1 confirmed.

## Acceptance criteria

- [ ] `getCurrentMemoryUsage()` is non-zero when `executeCommand`'s promise resolves.
- [ ] A concurrency case: two simultaneous 10MB responses, the second rejected rather than admitted.
- [ ] `jq_query`'s file read is accounted, or its absence is argued explicitly.

## Work log

- 2026-09-01 — filed from review round 3. Pre-existing and therefore out of scope
  for PR #32; the round-3 copy reduction mitigates but does not close it.

---

## Re-confirmed independently, 2026-09-03 (`/simplify` efficiency lane)

`performance-oracle`, reviewing the whole tree at `3d4900b` with no knowledge of
this todo, reached the same class from its own sweep
(`rg -n 'allocateMemory|releaseMemory' src --glob '!*.test.ts'` — 6 hits in 3
files; `command-executor.ts` is the only production caller). Fresh measurements
on a single 9.4 MB body through the real `processResponse`:

```
body bytes             : 9.4MB
heapUsed delta         : 10.1MB
rss delta              : 77.2MB      <- pool reports 0 for all of it
JSON.parse heap delta  : 11.4MB for a 4.5MB document   ratio: 2.5x
```

Two additions to what was filed on 2026-09-01:

1. **`jq_query` charges the pool nothing at any point.** `executeJqQuery` reads a
   file up to `JQ.MAX_QUERY_FILE_SIZE` (= `LIMITS.MAX_RESPONSE_SIZE`, 10 MB) with
   `readFile(…, {encoding:"utf-8"})` and `JSON.parse`s it. At the measured 2.5×
   parse ratio one call can hold ~35 MB with `getCurrentMemoryUsage()` at zero.
   This is a second consumer of the same 100 MB pool, entirely outside it.
2. **The fix belongs in the tracker, not at the two sites.** A scoped
   `withMemoryBudget(bytes, fn)` that charges, runs and releases in a `finally`
   makes a raw `releaseMemory` call outside `memory-tracker.ts` the thing to grep
   for. If `jq_query` charges `stats.size` (already known from `validateFilePath`),
   **say what the multiplier is rather than leaving it implied** — a 10 MB file
   costs ~25 MB parsed, so either charge a multiple or lower `JQ.MAX_QUERY_FILE_SIZE`.

## Prior attempt, discarded

A branch `fix/hold-memory-accounting-across-processing` implemented the release-point
move and the `jq_query` charge (commits `e285f23`, `9f95a03`, `c90e8c9`). It was
**deleted unmerged on 2026-09-03 at the operator's instruction**; the commits were
never pushed and survive only in this clone's reflog. Two findings from its review
round are worth carrying into any retry:

- Moving the release to `executeCurlRequest`'s `finally` is **still short of the
  boundary**: `hook-executor.ts::executeWithHooks` then runs `afterResponse` hooks
  (arbitrary user code, unbounded duration) and `wrap()` → `defendForInline` with
  the pool already at zero. Threading a release handle out of `executeCurlRequest`
  /`executeJqQuery` is a MAJOR bump (invariant 11).
- Making `CommandResult.release` required breaks ~30 mocked `executeCommand`
  returns that `tsc` does **not** catch, because the mock boundary is untyped via
  `as Mock`. Route them through one helper before starting.

**The acceptance criteria above are unchanged and none of them are met at HEAD.**
