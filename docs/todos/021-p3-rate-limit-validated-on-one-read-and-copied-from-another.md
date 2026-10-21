---
status: pending
severity: low
effort: s
tags: [code-review, correctness, rate-limiter, security, extensible, mcp-curl-server, config]
dependencies: []
---

# rateLimit is validated on one read and copied from a second read, at two sites

## Problem Statement

`assertHostRateLimit` is an `asserts` guard and not a parser. It reads `max` and
`windowMs`, checks them, and throws the values away. Each caller then reads the same
properties again to build its own copy, so two things follow:

1. **A value whose reads differ passes with one value and is stored as another.**
   An accessor or a Proxy can do this. `configure({ rateLimit: { get max() { return calls++ ? NaN : 1 }, windowMs: 3_600_000 } })`
   passes validation with `max` 1 and stores `NaN`. `log.length >= NaN` is always
   false, so the per-host limit never refuses. The comment in `configure()`, "so the
   value validated is the value used", is false for that input.
2. **Two hand-written copies of `{ max, windowMs }`.** One is in `configure()`. The
   other is in `installHostRateLimit`, whose only caller passes the copy `configure()`
   already froze. If a field is added to `HostRateLimit` and only one copy is
   updated, the field shows in `getConfig()` but is silently dropped from the limit
   actually enforced.

**Who is affected:** only an embedder (a teammate) who deliberately writes a stateful
getter, so close to nobody for item 1. Item 2 is maintenance drift. Who is harmed is
the operator's call (rule 42).

## Findings

The two reviewers below each filed a class, and the two classes share confirmed
instances at `mcp-curl-server.ts::McpCurlServer.configure` and
`rate-limiter.ts::installHostRateLimit`, so they are merged here.
- typescript-reviewer, P3, `stale-observation`
- code-simplicity-reviewer, P3, `repeated-computation`

- aliases: repeated-computation (code-simplicity-reviewer)

**Instances** (all in the diff):
- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.configure`: `assertHostRateLimit(config.rateLimit)` and then `Object.freeze({ max: config.rateLimit.max, windowMs: config.rateLimit.windowMs })`. Confirmed.
- `src/lib/security/rate-limiter.ts::installHostRateLimit`: `assertHostRateLimit(limit)` and then `hostLimit = { max: limit.max, windowMs: limit.windowMs }`. Confirmed. Today it is reachable only through `configure()`'s frozen plain copy, because it is not exported from `src/lib.ts`.

**Sweep:** `rg -n "assertHostRateLimit|installHostRateLimit" src --glob '!*.test.ts'`
finds 2 production call sites, both confirmed (reproduced by the orchestrator).

**Reversal note (rule 03):** this todo has two options below. Option 2 would remove the
copy in `installHostRateLimit`, which the previous round's fix (`308d53e`) added on
purpose ("so the seam does not trust its caller"). That copy was the builder's choice,
not an operator decision. Todo 022's acceptance criterion was rewritten by the builder
and never ruled on, so the reviewers who called the two copies "operator-settled" were
wrong about that. The operator decides between Option 1 and Option 2.

## Proposed Solutions

### Option 1: make the guard a parser (typescript-reviewer)

`parseHostRateLimit(limit: unknown): Readonly<HostRateLimit>` reads each field once,
validates those local values, and returns `Object.freeze({ max, windowMs })`.
`configure()` stores what it returns, and `installHostRateLimit` calls the same parser
and stores its result. That leaves one rule, one copy literal and one read, and the
seam still does not trust its caller. Delete the misleading comment.
**Effort:** s · **Risk:** low

### Option 2: drop the seam's copy (code-simplicity-reviewer)

Store the frozen value `installHostRateLimit` receives. Keep `assertHostRateLimit` at
both sites. This removes one literal but does not close item 1 at `configure()`, and
it reverses the previous round's change.
**Effort:** s · **Risk:** low

### Option 3: decline on population

Record that stateful getters on config objects are not a supported input.
**Effort:** none

## Recommended Action

_Pending._

## Acceptance Criteria

- [ ] `configure()` with a `max` accessor that returns 1 on its first read and `NaN` afterwards, then `start()`: the second request to one host is refused with `Maximum 1 requests per 3600 s`.
- [ ] One copy literal of `{ max, windowMs }` exists in production code.
- [ ] Teeth: reverting the fix fails that test.

## Work Log

### 2026-10-21 - Filed from Surface 2 review (round 2) of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Merged two reviewers' classes on two shared confirmed instances, and
reproduced the sweep.
