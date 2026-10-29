---
status: pending
effort: s
tags: [code-review, docs, security, host-policy, config-security, typings, dist]
dependencies: []
---

# A security-boundary docblock in the published typings states the opposite of what the code enforces

## Problem Statement

`src/lib/config/security/host-policy.ts` says three times that redirect hops are not checked against the host list. Since PR-3 (#52), `executeCurlRequest`'s `gateHop` checks every hop. This branch corrected the sibling `McpCurlConfig.allowedHosts` doc-block in `src/lib/types/public.ts`, then rebuilt `dist/`, which now ships both statements: the `HostPolicy` JSDoc says hops are not checked, and the `allowedHosts` JSDoc says they are.

## Findings

- class: a security-boundary docblock in the published typings states the opposite of what the code enforces, and contradicts a sibling docblock the same change corrected.
- failure: an embedder of 5.2.0 reads the `HostPolicy` JSDoc ("Redirect hops cURL follows are not checked against it") beside the `allowedHosts` JSDoc ("again on every followed redirect hop's host"). A maintainer of `host-policy.ts` reads its header as the design and can treat the per-hop gate as surplus. No harm today, because the stale text understates the protection.
- instances:
  - `src/lib/config/security/host-policy.ts::HostPolicy` — "Redirect hops cURL follows are not checked against it." — confirmed, out of diff
  - `src/lib/config/security/host-policy.ts::deriveHostPolicy` — "Only the request URL is checked, not the redirect hops cURL follows." — confirmed, out of diff
  - the file-header comment of `src/lib/config/security/host-policy.ts` — "(redirect hops are not checked)" — confirmed, out of diff
  - `dist/generator-DHAfrcwD.d.ts::HostPolicy` — the same sentence, in a typings file this branch added — confirmed, in diff
- sweep: `rg -i "redirect hops (cURL follows )?are not checked|not the redirect hops|does not bound|followed redirect reaches"` over src, dist, docs and README — 4 candidates → 4 confirmed.
- root: source. The three `host-policy.ts` sentences predate this branch; the rebuild ships them.
- Found by: security-sentinel, Surface 2 review, 2026-10-29.

## Proposed Solutions

### Option 1: Reword the three sentences and rebuild
Say the policy is checked on the request URL and on every followed hop by `executeCurlRequest`'s `gateHop`, then rebuild `dist/`.
- Effort: s. Risk: none.

### Option 2: Run `/sixees-workflow:sync-comments --branch` over the release branch
Catches this and any sibling the sweep missed, at the cost of a wider pass.
- Effort: s. Risk: none.

## Recommended Action

_To be decided at triage._

## Acceptance Criteria

- [ ] `rg -i "not checked" src/lib/config/security/host-policy.ts dist/*.d.ts` returns nothing.
- [ ] `dist/` is rebuilt after the change.

## Work Log

### 2026-10-29 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** filed security-sentinel's `stale-comment` class (P3); in scope through the added `dist/generator-DHAfrcwD.d.ts`.
**Learnings:** fixing one docblock of a fact without sweeping its siblings is the K-8 shape; the rebuild made the pair ship together.
