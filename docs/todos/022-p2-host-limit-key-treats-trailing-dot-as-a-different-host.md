---
status: pending
severity: medium
effort: s
tags: [code-review, security, rate-limiter, ssrf, hostname]
dependencies: []
---

# The per-host limit key treats two spellings of one host as two hosts, so each spelling gets its own budget

## Problem Statement

Both per-host gates key on the hostname exactly as `validateUrlAndResolveDns` returns
it: lowercased, but not canonicalised. `new URL("https://Example.COM./x").hostname` is
`example.com.`. That key differs from `example.com`, so the trailing-dot form gets its
own window.

The keying itself is older than this branch. The branch makes it matter: before, the
per-host gate was a 60/min guard against hammering. `rateLimit` is now documented as
"at most `max` requests to any one host in any `windowMs` span", with hour-scale windows
meant to sit under an upstream quota.

**Failure:**
1. An embedder sets `rateLimit: { max: 100, windowMs: 3_600_000 }` to stay under an upstream limit of 100 per hour.
2. The model uses up the `api.example.com` log.
3. The model then sends `https://api.example.com./…`, which has a fresh log.
4. 200 requests per hour reach the same upstream on the same credential, and the per-client cap (300/min) does not stop it.

Whether curl, SNI and the upstream all accept the trailing-dot form is unverified,
which is why the reviewer gave medium confidence.

**Who is affected:** the model, which is the hostile end this project defends against
(it picks the URL). The harm is a quota overrun against the embedder's credential.

## Findings

Reviewer: security-sentinel (P3, `fail-open-default`, CWE-178, OWASP A04:2021).

**Escalated to P2 by the learnings join.** learnings-researcher assigned RC-31 the
`Class` `fail-open-default`. RC-31's mechanism (validation added to close a channel
switched the defence off) is a different mechanism from this one, and the researcher
called its relevance "by shape and not by subject". The join is on the class noun only,
so the operator may judge the recurrence coarse.

**Instances:**
- `src/lib/security/rate-limiter.ts::checkSlidingHostLimit`: `hostSlidingLog.get(hostname)` keys on the hostname as given. Confirmed, and in the diff.
- `src/lib/tools/curl-execute.ts::executeCurlRequest`: `checkRateLimits(dnsResult.hostname, …)`, where the hostname still carries the trailing dot. Confirmed. This file is not in the diff, and it is the only production caller.
- `src/lib/security/ssrf.ts::validateUrlAndResolveDns`: the source, where the hostname is lowercased and not canonicalised. Suspected (not opened by the orchestrator), and out of the diff.

**Sweep:** `rg -n "checkRateLimits\(" src --glob '!*.test.ts'` finds 1 production
candidate, confirmed (reproduced by the orchestrator). `node -e 'console.log(new URL("https://Example.COM./x").hostname)'`
prints `example.com.` (also reproduced).

## Proposed Solutions

### Option 1: canonicalise once, inside `checkRateLimits`

Strip one trailing `.` before either gate reads the key, so the fixed and the sliding
path both get it. URL parsing already handles case and IDNA.
**Effort:** s · **Risk:** low

### Option 2: canonicalise at the source, `validateUrlAndResolveDns`

Every consumer of `dnsResult.hostname`, the SSRF checks included, then sees one
spelling.
**Cons:** this widens the change into `ssrf.ts`, which carries numbered invariants
(read ARCHITECTURE.md first).
**Effort:** s–m · **Risk:** medium

### Option 3: document it

Say in `docs/configuration.md` that the limit applies per spelling of the host.
**Effort:** s

## Recommended Action

_Pending._

## Acceptance Criteria

- [ ] With `{ max: 1, windowMs: 60_000 }` installed, `checkRateLimits("api.example.com")` followed by `checkRateLimits("api.example.com.")` throws on the second call.
- [ ] Teeth: removing the canonicalisation fails that test.

## Work Log

### 2026-10-21 - Filed from Surface 2 review (round 2) of feat/host-rate-limit-window

**By:** Claude Code
**Actions:** Reproduced the sweep and the URL-parse probe, and escalated P3 to P2 on the
RC-31 `Class` join.
