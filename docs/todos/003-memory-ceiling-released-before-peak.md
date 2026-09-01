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
