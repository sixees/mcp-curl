---
status: pending
severity: low
effort: s
tags: [code-review, typescript, refusal-shape, redirects]
dependencies: ["025"]
pr: ""
---

# The redirect arm of the refusal union lets any reason carry a wait

## Problem Statement

`LocalRefusal`'s nothing-sent arm allows `retryAfterSeconds` only on `LOCAL_RATE_LIMITED`. The `LOCAL_REDIRECT_REFUSED` arm allows it on every reason. `gateHop`'s `check` forwards any `LocalRefusalError`'s wait without looking at `reason`.

## Findings

- **Failure:** `{ code: "LOCAL_REDIRECT_REFUSED", reason: "host-not-allowed", requestsSent: 1, retryAfterSeconds: 5 }` compiles. If another check ever threw a `LocalRefusalError` carrying a wait, the model would see "Retry in N s." on a host or address refusal. Nothing does that today, which is why this is P3.
- **Instances:**
  - `src/lib/utils/error.ts::LocalRefusal` — redirect arm — confirmed (in diff)
  - `src/lib/tools/curl-execute.ts::gateHop` — `check` forwards the wait — confirmed (in diff)
- **Sweep:** `retryAfterSeconds|LocalRefusalError` over `src/` outside tests — 5 construction sites. Only `check` passes a wait into the redirect arm.
- **Reviewer:** typescript-reviewer (P3, `missing-constraint`).

## Proposed Solutions

### Option 1: Type the redirect arm per reason
Map over `ReasonFor<"LOCAL_REDIRECT_REFUSED">` with `R extends "rate-limited" ? number : never`, and forward the wait only when `reason === "rate-limited"`.
**Pros:** both arms enforce the same rule.
**Cons:** a slightly heavier type.
**Effort:** s · **Risk:** low

### Option 2: Leave the type; guard only in `check`
**Pros:** a minimal change.
**Cons:** the type still admits the invalid combination.
**Effort:** s · **Risk:** low

## Recommended Action

_(pending — the operator chooses)_

## Acceptance Criteria

- [ ] A `@ts-expect-error` for redirect + `host-not-allowed` + wait. It only has teeth once todo 025's type-check gate exists.
- [ ] `check` forwards a wait only for `rate-limited`.

## Work Log

### 2026-10-29 - Filed from Surface 2 review of feat/header-sync-refusal-shape
**By:** Claude Code
**Actions:** Filed from the typescript-reviewer finding.
**Learnings:** K-11 — the other arm of a two-sided type claim.
