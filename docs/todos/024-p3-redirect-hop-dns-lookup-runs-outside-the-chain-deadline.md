---
status: pending
severity: low
effort: s
tags: [code-review, performance, redirects, tools, security-ssrf]
dependencies: []
---

# Redirect-hop DNS lookups run outside the chain's deadline, in the server process

## Problem Statement

An in-process blocking step with no timeout of its own runs inside a loop whose
only deadline check comes after it, so total wall time can overshoot the stated
`timeout` by one full run of that step. Before the per-hop loop, hops 2..N were
resolved inside cURL under `--max-time`; now `executeCurlRequest` resolves each
redirect target itself, via `dns.lookup`, with no time bound.

## Findings

Class `missing-validation` (performance-oracle, Surface-2 review of
`feat/per-hop-redirects`, 2026-10-28). Confidence medium.

**Failure:** hop 1 returns 302 to a hostname whose nameserver drops queries (the
remote picks it). `gateHop` → `validateUrlAndResolveDns` → `resolveDns` →
`lookup` blocks until the OS resolver gives up; only then does the
`remainingMs <= 0` check refuse. The call returns later than `timeout` by up to
one resolver timeout, holding a libuv threadpool thread meanwhile. Bounded at one
lookup per call, because the deadline is re-checked after every gate; internal-only
population — hence P3.

**Instances:**
- `src/lib/tools/curl-execute.ts::gateHop` — the redirect-hop arm awaits `validateUrlAndResolveDns` with no deadline passed in — confirmed
- `src/lib/tools/curl-execute.ts::executeCurlRequest` — `remainingMs` is computed only after `gateHop` resolves — confirmed
- `src/lib/security/ssrf.ts::resolveDns` — `await lookup(hostname)` with no timeout or abort (unchanged; now reached with remote-chosen hosts per hop) — confirmed

**Sweep:** `rg -n "lookup\(|resolve4|resolve6" src/lib --glob '!*.test.ts'` — 1 candidate → 1 confirmed;
`rg -n "deadline" src/lib --glob '!*.test.ts'` — 1 site.

## Proposed Solutions

### Option 1: Race the lookup against the remaining deadline
**Approach:** pass the deadline into `gateHop`; race `validateUrlAndResolveDns`
against a timer for `deadline - Date.now()`, rejecting as the chain timeout.
**Pros:** small; bounds wall time. **Cons:** the threadpool thread stays busy until
getaddrinfo returns. **Effort:** s. **Risk:** low.

### Option 2: Give `resolveDns` its own timeout
**Approach:** optional timeout on `resolveDns`, so every caller is bounded.
**Pros:** fixed at the layer no caller can forget. **Cons:** same threadpool caveat.
**Effort:** s. **Risk:** low.

### Option 3: Move to `dns.Resolver` with `timeout`/`tries`
**Pros:** frees the thread. **Cons:** different resolution semantics from
`lookup` (no `/etc/hosts`, which the localhost path relies on). **Effort:** m. **Risk:** medium.

## Recommended Action

_Not yet decided — pending a human call._

## Acceptance Criteria

- [ ] With hop 2's lookup stubbed never to resolve and `timeout: 1`, `executeCurlRequest` settles within ~1.5 s with the chain-timeout error.
- [ ] The sweep above shows the lookup bounded at every caller the chosen option covers.

## Work Log

### 2026-10-28 - Filed from Surface-2 review
**By:** Claude Code
**Actions:** Filed from performance-oracle's finding on `feat/per-hop-redirects` (`831042a..HEAD`), in scope: `gateHop` is new on that branch.
**Learnings:** The fix the reviewer suggested does not free the threadpool thread on its own (Option 3 does).
