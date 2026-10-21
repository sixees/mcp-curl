---
status: complete
severity: high
effort: s
tags: [code-review, correctness, rate-limiter, security, extensible, mcp-curl-server, lifecycle]
dependencies: []
---

# The process-global host-limit seam has no owner and trusts every caller

## Problem Statement

`rate-limiter.ts::setHostRateLimit` keeps one process-wide slot. Every `McpCurlServer`
lifecycle path writes to it unconditionally, and the setter stores whatever it is given
without checking it. Three effects follow, and all three fail toward a looser limit:

1. **Ownerless reset.** One instance's `start()` without `rateLimit`, its `shutdown()`, or
   a `start()` that fails before it ever installed a limit (bad `authToken`) resets
   another live instance's configured limit to the fixed 60/min default. It also clears
   that instance's sliding logs, so a fresh burst of `max` is admitted. Nothing is logged.
2. **Validated at `configure()`, used at `start()` from the caller's object.**
   `configure()` stores `rateLimit` by reference after `validateRateLimit` passes, and the
   copy is taken in `freezeConfig` at `start()`. Mutating the object in between (for
   example `rl.max = Number(process.env.UNSET)`) installs `max: NaN`. `log.length >= NaN`
   is always false, so the per-host limit is silently off. That breaks the documented
   promise that no typo or unset variable can disable the limiter.
3. **The copy lives in two places and the teardown is spelled twice.** `setHostRateLimit`
   copies its argument "so a later mutation changes nothing", and `freezeConfig` copies
   the same fields. The undo sequence for `start()`'s process-wide effects is written out
   separately in the rollback and in `shutdown()`, and this branch had to add
   `setHostRateLimit(undefined)` to both.

**Escalated from P2 by the RC-19 join** (`learnings-researcher` `Class`:
`misplaced-decision`, paired with `fail-open-default`). RC-19 is the rate limiter's own
entry. Its recorded mechanism is a constant sized for another subsystem's cost model,
which is a different mechanism from this one. The join is on the class noun, so the
operator may judge the recurrence to be coarse.

**Population.** Effect 1 needs two `McpCurlServer` instances in one process. The plan
records that population as empty ("the team runs one wrapper per process"). Effect 2
needs an embedder that mutates a config object after `configure()`. Neither is
attacker-reachable, because the embedder is trusted config. Who is harmed is the
operator's call (rule 42).

## Findings

Merged from five reviewers: security-sentinel (P3, two classes), typescript-reviewer (P2
and P3), architecture-strategist (P2), pattern-recognition-specialist (P3, two classes)
and code-simplicity-reviewer (P3). They overlap at `rate-limiter.ts::setHostRateLimit`,
`mcp-curl-server.ts::McpCurlServer.start` and `::shutdown`.

- aliases: fail-open-default (security-sentinel, typescript-reviewer, pattern-recognition-specialist), stale-observation (security-sentinel, typescript-reviewer), dead-code (code-simplicity-reviewer), duplicated-logic (pattern-recognition-specialist)

**Instances** (all confirmed):
- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.start`: the install call `setHostRateLimit(this._frozenConfig.rateLimit)` writes `undefined` when unset. The rollback calls `setHostRateLimit(undefined)` unconditionally, including when the failure came before the install line.
- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.shutdown`: unconditional `setHostRateLimit(undefined)`.
- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.configure`: stores `rateLimit` by reference after validating it.
- `src/lib/extensible/mcp-curl-server.ts::freezeConfig`: the first copy is taken at `start()`, with no second validation.
- `src/lib/security/rate-limiter.ts::setHostRateLimit`: stores without validating ("The caller validates `limit`"), copies redundantly, and clears every host's log on every call.
- `src/lib/security/rate-limiter.test.ts`: the test "copies the limit, so mutating the caller's object changes nothing" pins the redundant copy.

**Sweep:** `rg -n "setHostRateLimit\(" src --glob '!*.test.ts'` gives 3 call sites plus
the definition, 4 confirmed (reproduced by the orchestrator). Other process-global
setters (`export function (set|configure)\w*` in `src/lib`): 2 candidates, 0 further
(`lifecycle.ts::setHttpServer`, `bounded-throttle.ts::setBounded`).

## Proposed Solutions

### Option 1: make the seam own the rule (recommended by architecture-strategist and security-sentinel)

**Approach:**
- `setHostRateLimit` validates with `assertPositiveInteger` and returns an opaque handle.
- `releaseHostRateLimit(handle)` clears the limit and the logs only while that handle is still installed.
- `start()` installs only when its config has `rateLimit`, and keeps the handle in a field set after the install line.
- The rollback and `shutdown()` release through that handle, using one private `releaseProcessState()` helper.
- `validateRateLimit` returns a frozen copy, and `configure()` stores that copy.

**Pros:** no caller can forget either rule, and both effects close at the seam.
**Cons:** a small API change to an internal (unexported) function.
**Effort:** s · **Risk:** low

### Option 2: validate at the sink, and document the shared reset

**Approach:** `setHostRateLimit` asserts both fields. `configure()` stores the validated
copy. `docs/configuration.md` and the setter docblock say that any instance's
`shutdown()` or failed `start()` restores the default for the whole process.
**Pros:** closes effect 2 and keeps the population decision for effect 1 explicit.
**Cons:** effect 1 remains, documented.
**Effort:** s · **Risk:** low

### Option 3: decline effect 1 on population, and fix effect 2 only

**Approach:** as Option 2, with the decline recorded in the handoff and against the plan's
"one wrapper per process" population.
**Effort:** s · **Risk:** low if the population really is empty

## Recommended Action

**Option 1**, chosen by the operator on 2026-10-21. Their reasons: effect 2 is not
hypothetical, because the consumer's own quota guard already fails open on
`NaN` from a mistyped environment variable. And "one server per process" is a
convention nothing enforces, so declining on it (Option 3) or documenting it
(Option 2) leaves a silent reset in place.

**Two servers setting a limit:** first holder wins, and a second `start()` with
any `rateLimit`, even an equal one, throws. Replacing it would trade a silent
reset for a silent override. A server without `rateLimit` installs nothing,
releases nothing, and its requests count under the held limit, which is the
tightening direction.

## Acceptance Criteria

- [x] `configure({ rateLimit: rl })`, then `rl.max = NaN`, then `start()`: either `start()` throws or the per-host limit is still enforced at the original `max`.
- [x] `setHostRateLimit({ max: NaN, windowMs: 1 })` throws (if Option 1 or 2 is chosen).
- [x] Start A with `{ max: 1, windowMs: 3_600_000 }` and spend its one request. Then B with no `rateLimit`, through each of: `start()` success, `start("http")` failing on a bad `authToken`, and `shutdown()`. A's second request is still refused (Option 1), or the docs state the reset (Options 2 and 3).
- [x] ~~Exactly one copy of `{ max, windowMs }` between `configure()` and the limiter.~~ Replaced, because there are now two copies, each at its own boundary. `configure()` copies the caller's object into the server, and that copy is what fixes effect 2. `installHostRateLimit` copies the server's value into process state, so the seam does not trust its caller. `freezeConfig`'s third copy is gone.
- [x] Teeth: removing each guard fails a named test.

## Work Log

### 2026-10-21 - Filed from Surface 2 review of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Merged five reviewers' classes on shared confirmed instances, reproduced the
`setHostRateLimit` sweep (3 call sites), and escalated P2 to P1 on the RC-19 `Class` join.
**Learnings:** The setter's `undefined` arm cannot say "clear only if mine", so every
teardown has to choose between clearing blindly and never clearing.

### 2026-10-21 - Resolved (Option 1)

**By:** Claude Code
**Actions:**
- `rate-limiter.ts::installHostRateLimit` validates (`assertHostRateLimit`), refuses a second install, copies the limit, and returns a handle.
- `rate-limiter.ts::releaseHostRateLimit` is a no-op for any handle that does not hold the limit.
- `rate-limiter.ts::assertHostRateLimit` replaces `mcp-curl-server.ts::validateRateLimit`, so `configure()` and the seam share one rule.
- `McpCurlServer.configure` stores a frozen copy.
- `McpCurlServer.start` claims the limit before any other side effect, and only when `rateLimit` is set.
- `McpCurlServer.releaseProcessState` is the one teardown used by both the rollback and `shutdown()`.
- `setHostRateLimit` is removed.
- Tests: an ownership suite in `rate-limiter.test.ts`, plus a mutate-before-start test and four second-server tests in `mcp-curl-server.test.ts`.
- Six mutation probes each fail a named test, and the files were restored with `cmp`.
- Full suite: 1499 passed, 7 skipped.
