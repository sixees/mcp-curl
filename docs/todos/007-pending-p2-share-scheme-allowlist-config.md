---
status: pending
priority: p2
issue_id: 007
tags: [code-review, architecture, dry, defense-in-depth]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Share `["http:", "https:"]` allowlist between schema, SSRF, and curl-args layers

## Problem Statement

The same allowlist is now defined in **four** sites across three layers (extended in second-pass review — F4):

- **Schema-time:** `src/lib/utils/url.ts:30` — `["http:", "https:"]`
- **DNS-time (port-default ternary):** `src/lib/security/ssrf.ts:83` — `parsed.protocol === "https:" ? 443 : 80`
- **DNS-time (rejection check):** `src/lib/security/ssrf.ts:86-88` — `parsed.protocol !== "http:" && parsed.protocol !== "https:"`
- **Network-time (curl flag):** `src/lib/execution/curl-args-builder.ts:74` (`--proto =http,https`) and `:110` (`--proto-redir =http,https`)

Three boundary points enforcing the same allowlist is intentional defense-in-depth, but the **scheme list is duplicated, not shared**. If someone adds `wss:` support tomorrow they have to find all four sites. SRP/DRY violation.

The first-pass review only covered the first two layers; the meta-review confirmed the curl-args sites are also in scope and would silently drift if the upper layers ever loosened.

## Findings

- **Reviewer (Architecture, A1):** "the architecture doesn't have an obvious home for 'security predicates that are pure / state-free' — `config/security/` is the closest fit (it already holds blocked-IP/blocked-hostname predicates and validation regexes)."
- **Reviewer (Simplicity, C1):** scheme constraint also duplicated in *English* across `.refine()` message, JSDoc, and one caller's description.

## Proposed Solutions

1. **Add `config/security/url-schemes.ts`** exporting `ALLOWED_URL_SCHEMES = ["http:", "https:"] as const`. Both `httpOnlyUrl` and `ssrf.ts:86-88` import from it. Effort: S. Single source of truth.
2. **Inline only — accept duplication.** Effort: 0. Rationale: the list is two strings; defense-in-depth justifies multiple call sites; consolidation overhead exceeds risk. Pure-language English duplication addressed separately by todo #009.

Recommended: solution 1. The constant cost is minimal and PR-6a/PR-6b benefit from having a clear home for security primitives.

## Acceptance Criteria

- [ ] `src/lib/config/security/url-schemes.ts` exists and exports `ALLOWED_URL_SCHEMES = ["http:", "https:"] as const` plus a derived `ALLOWED_URL_SCHEMES_CURL_FLAG = "=http,https" as const`
- [ ] `httpOnlyUrl` (`src/lib/utils/url.ts`) imports `ALLOWED_URL_SCHEMES`
- [ ] `validateUrlAndResolveDns` (`src/lib/security/ssrf.ts:86-88`) imports `ALLOWED_URL_SCHEMES` for the rejection check; the port-default ternary at `:83` references the same constant or a derived helper
- [ ] `buildCurlArgs` (`src/lib/execution/curl-args-builder.ts:74` and `:110`) imports `ALLOWED_URL_SCHEMES_CURL_FLAG` for both `--proto` and `--proto-redir`
- [ ] One-paragraph layer-decision comment at the top of `src/lib/utils/url.ts`: pure schema predicate; stateful enforcement in `security/ssrf.ts`; transport-level enforcement in `execution/curl-args-builder.ts`; all three share the constant
- [ ] Test verifies that flipping `ALLOWED_URL_SCHEMES` (e.g., adding `"ws:"` in a test override) propagates to all three layers

## Resources

- `src/lib/utils/url.ts`
- `src/lib/security/ssrf.ts:83,86-88`
- `src/lib/execution/curl-args-builder.ts:74,110`
- `src/lib/config/security/`
- CLAUDE.md "Module Map"
