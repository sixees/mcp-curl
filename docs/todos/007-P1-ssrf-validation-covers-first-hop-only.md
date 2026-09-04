---
id: 007
title: "SSRF validation covers the first hop only; redirects are resolved by cURL unchecked"
status: open
severity: P1
tags: [security, ssrf, pre-existing]
class-id: misplaced-decision
aliases: [missing-authz]
source: /simplify altitude lane (architecture-strategist), 2026-09-03
reviewers: [architecture-strategist]
created: 2026-09-03
---

# SSRF validation covers the first hop only

## Problem

`validateUrlAndResolveDns` runs once, in `tools/curl-execute.ts::executeCurlRequest`,
before the spawn. It takes one URL and has no concept of a hop. Meanwhile
`buildCurlArgs` emits `-L` and `--max-redirs` whenever `follow_redirects !== false`
— the default — and pins exactly one `--resolve hostname:port:ip`.

So hop 1 is validated and pinned. **Hops 2..N are resolved and connected by cURL
itself**, and `isBlockedIp` / `isBlockedHostname` / `isAllowedLocalhostPort` never
see them.

## Evidence

- `src/lib/execution/curl-args-builder.ts:110-114` — `-L`, `--max-redirs`, `--proto-redir`
- `src/lib/execution/curl-args-builder.ts::buildCurlArgs` — a single `--resolve` triple
- `src/lib/tools/curl-execute.ts:158` — the one and only validation call
- `rg -n 'isBlockedIp|isBlockedHostname|validateUrlAndResolveDns' src -g '!*.test.ts'`
  — zero per-hop checks anywhere in the tree

A hostile origin replies `302 Location: http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
The scheme passes `--proto-redir`; the host is not covered by `--resolve`; cURL
resolves and connects; the body returns to the model. Identical for `http://10.0.0.5/`
and for a rebinding host on hop 2.

Invariant 2's own wording is *"Any change that lets cURL resolve a name itself
reopens DNS rebinding"* — hop 2 onward has always let it.

## Why this is filed rather than fixed

`/simplify`'s remit is quality, not correctness, and this is a behaviour change:
requests that succeed today would start failing. Invariant 11 covers exported
**behaviour** as well as signatures, so the code fix is a MAJOR bump and the
operator's call.

`ARCHITECTURE.md` and `docs/architecture/architecture.md` record no acceptance of
this residual — `docs/architecture/architecture.md` → *Network / SSRF Defense*
states pinning "defeats rebinding" with no limit stated, which `CONVENTIONS.md` →
*Documentation* forbids ("state a limit rather than implying coverage").

## Fix

Two options, and the cheap one is honest rather than complete.

1. **Code (rung 3 — move the precondition to a layer that can answer).** Drop
   `-L`, cap cURL at zero redirects, read `Location` off the header descriptor
   (already structural and remote-unwritable, invariant 13), re-enter
   `validateUrlAndResolveDns` per hop, bounded by `max_redirects`. Strictly widens
   the defence; narrows nothing. Effort: l. MAJOR bump.
2. **Interim, if 1 is too large now.** Amend invariant 2 and
   `docs/architecture/architecture.md` to state that the pin covers the first hop
   only, so the next reviewer meets a known residual rather than a coverage claim.
   Not a contract change. **This is a stopgap, not a resolution — do not close
   this todo on it.**

## Acceptance criteria

- [ ] A fixture origin that 302s to `http://127.0.0.1:<privileged port>/` causes
      `curl_execute` to error with the blocked-IP/localhost message rather than
      returning the redirect target's body. Fails today.
- [ ] The same for a 302 to an RFC1918 address and to `169.254.169.254`.
- [ ] Whichever option is taken, invariant 2's stated reach matches the code.

## Since filed

The **documentation half of option 2 is done**; the code gap is untouched and this
todo stays open on that.

`docs/architecture/architecture.md` (npm-published) now states that the pin closes
rebinding on the first hop only and that redirect targets are neither pinned nor
re-validated, in all three places it previously claimed otherwise: *Business Rules / Invariants*,
*Network / SSRF Defense — strategy*, and the design-decision table.
`curl-args-builder.ts::CurlArgsParams.dnsResolve` says the same and cites this file.

`ARCHITECTURE.md` → *Invariants* is deliberately unchanged. Invariant 2 reads *"Any
change that lets cURL resolve a name itself reopens DNS rebinding"* — which the
redirect path does, so the invariant is currently **violated rather than mis-stated**.
Amending its wording is a decision for whoever takes this todo, not a documentation
tidy-up: it is the difference between recording the gap and accepting it.
