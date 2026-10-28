---
status: pending
severity: low
effort: s
tags: [code-review, duplicated-logic, redirects, tools, security-ssrf]
dependencies: []
---

# The per-hop gate sequence is written twice, once per arm of `gateHop`

## Problem Statement

An ordered safety check — host list, then SSRF/DNS pin, then rate limit — is spelled
out twice: once for the first hop and once for redirect hops. The two copies differ
in how they report a refusal and in how the host-list check reads the host: hop 1
reads it through `safeHostname(url, "")` and leaves an unparseable URL to the SSRF
gate's own message, while a redirect hop's URL is already a parsed `href`. A change
made to one arm only (a new option to
`validateUrlAndResolveDns`, a reorder, a new check) leaves the other ungated, and
redirect hops are the ones whose host the remote chose.

## Findings

Class `duplicated-logic` (pattern-recognition-specialist, Surface-2 review of
`feat/per-hop-redirects`, 2026-10-28). Confidence medium. Found with `rg`, confirmed by reading.

**Failure:** an option threaded into the hop-1 arm's `validateUrlAndResolveDns`
call only would leave redirect hops validating without it, breaking the guarantee
that every redirect hop is validated and pinned like hop 1 (invariant 2;
`architecture.md` → *Network / SSRF Defense — strategy*), with the suite green unless the redirect suite
covers that option.

**Instances:**
- `src/lib/tools/curl-execute.ts::gateHop` (the `requestsSent === 0` arm) — `isHostAllowed`, `validateUrlAndResolveDns(url, { allowLocalhost })`, `checkRateLimits`, each throwing its own error — confirmed
- `src/lib/tools/curl-execute.ts::gateHop` (the redirect arm) — the same three calls in the same order, each mapped to `refuse(reason)`; the host-list check takes `new URL(url).hostname` where hop 1 takes `safeHostname(url, "")` — confirmed

**Sweep:** `rg -n 'validateUrlAndResolveDns\(|checkRateLimits\(|isHostAllowed\(' src -g '*.ts' -g '!*.test.ts'` — 9 hits: 3 definitions, 6 call sites (all in `gateHop`); 2 sequences confirmed.

## Proposed Solutions

### Option 1: One sequence, error mapping at the end
**Approach:** walk a `[reason, step]` list once; hop 1 rethrows the original error,
redirect hops throw `refuse(reason)`. **Pros:** order and options stated once.
**Cons:** a little indirection. **Effort:** s. **Risk:** low.

### Option 2: Keep both arms, pin them with a test
**Approach:** assert `validate` gets the same options on every hop.
**Pros:** no restructuring. **Cons:** the duplication stays; the test catches one drift only. **Effort:** s. **Risk:** low.

## Recommended Action

_Not yet decided — pending a human call._

## Acceptance Criteria

- [ ] The three gate calls and their order appear once in `gateHop`.
- [ ] Hop 1 still refuses in each check's own words; redirect hops still refuse with `LOCAL_REDIRECT_REFUSED` and a fixed reason (`curl-execute.redirects.test.ts`, `curl-execute.host-policy.test.ts` green).

## Work Log

### 2026-10-28 - Filed from Surface-2 review
**By:** Claude Code
**Actions:** Filed from pattern-recognition-specialist's finding on `feat/per-hop-redirects` (`831042a..HEAD`), in scope: `gateHop` is new on that branch.
**Learnings:** code-simplicity-reviewer read the same two arms as load-bearing (RC-30 needs the redirect arm's fixed reasons) — the duplication is in the sequence, not in the error mapping.
