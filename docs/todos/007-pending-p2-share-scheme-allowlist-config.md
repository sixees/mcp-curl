---
status: pending
priority: p2
issue_id: 007
tags: [code-review, architecture, dry, defense-in-depth]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Share `["http:", "https:"]` allowlist between schema layer and SSRF layer

## Problem Statement

The same allowlist (`["http:", "https:"]`) is now defined in two layers:

- Schema-time: `src/lib/utils/url.ts:30`
- DNS-time: `src/lib/security/ssrf.ts:86-88`

Two boundary points enforcing the same allowlist is intentional defense-in-depth, but the **scheme list is duplicated, not shared**. If someone adds `wss:` support tomorrow they have to find both sites. SRP/DRY violation.

## Findings

- **Reviewer (Architecture, A1):** "the architecture doesn't have an obvious home for 'security predicates that are pure / state-free' — `config/security/` is the closest fit (it already holds blocked-IP/blocked-hostname predicates and validation regexes)."
- **Reviewer (Simplicity, C1):** scheme constraint also duplicated in *English* across `.refine()` message, JSDoc, and one caller's description.

## Proposed Solutions

1. **Add `config/security/url-schemes.ts`** exporting `ALLOWED_URL_SCHEMES = ["http:", "https:"] as const`. Both `httpOnlyUrl` and `ssrf.ts:86-88` import from it. Effort: S. Single source of truth.
2. **Inline only — accept duplication.** Effort: 0. Rationale: the list is two strings; defense-in-depth justifies multiple call sites; consolidation overhead exceeds risk. Pure-language English duplication addressed separately by todo #009.

Recommended: solution 1. The constant cost is minimal and PR-6a/PR-6b benefit from having a clear home for security primitives.

## Acceptance Criteria

- [ ] `src/lib/config/security/url-schemes.ts` exists and exports `ALLOWED_URL_SCHEMES`
- [ ] `httpOnlyUrl` and `validateUrlAndResolveDns` both import it
- [ ] One-paragraph layer-decision comment at the top of `src/lib/utils/url.ts`: pure schema predicate; stateful enforcement in `security/ssrf.ts`; both share the constant

## Resources

- `src/lib/utils/url.ts`
- `src/lib/security/ssrf.ts`
- `src/lib/config/security/`
- CLAUDE.md "Module Map"
