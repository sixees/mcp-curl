---
status: pending
priority: p2
issue_id: 009
tags: [code-review, spr-dry, api-design, simplicity]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Make `httpOnlyUrl(description?)` optional + lock scheme list in JSDoc

## Problem Statement

Three related issues with the helper's call-site ergonomics and SRP:

1. **Required `description` is a footgun.** Compared to `z.url()` which allows `.describe(...)` to be added later (or omitted), `httpOnlyUrl()` won't compile without a string. Custom-tool authors who forget put a placeholder.
2. **Scheme constraint duplicated in three English locations** — `.refine()` message, JSDoc, *and* `validator.ts:91` description (`"Base URL (must use http or https)"`). The other call site (`server/schemas.ts:12` — `"The URL to request"`) does NOT repeat. Inconsistent. SRP says the rule lives in one place.
3. **No defence against future scheme-list relaxation under pressure.** Without a JSDoc warning, a downstream PR may legitimately think "let's add `mailto:` because tool X wants links" and widen the helper. The plan's whole point is the strict allowlist.

## Findings

- **File:** `src/lib/utils/url.ts:25-37`
- **File:** `src/lib/schema/validator.ts:91`
- **Reviewer (Simplicity, C1, C3, C5):** description SRP, parameter naming clash with Zod's `.description` accessor.
- **Reviewer (Security, S6):** "footgun, and the empty-description check on `applySpotlighting` is the same kind of validation that's missing here."
- **Reviewer (Architecture, A4):** "Add a JSDoc note: 'Strict HTTP/HTTPS-only by design. If a future caller needs a different allowlist, add a `urlScheme(allowedSchemes, description)` factory rather than relaxing this helper.'"

## Proposed Solutions

1. **Make `description` optional** with a sensible default (`"URL (http or https)"`). Effort: S.
2. **Remove the parenthetical scheme constraint from `validator.ts:91`** — the helper enforces it; the call site description should describe *what the URL is for* (e.g., `"Base URL of the API"`). Effort: S.
3. **Rename parameter `description` → `purpose` or `label`** to disambiguate from Zod's `.description` accessor. Effort: S. Optional.
4. **Add JSDoc warning** against scheme-list relaxation; point to a hypothetical `urlScheme(allowedSchemes, description)` factory as the right shape if a different allowlist is ever needed. Effort: S.

Recommended: 1 + 2 + 4. Defer 3 (cosmetic, low value).

## Acceptance Criteria

- [ ] `httpOnlyUrl()` callable with no argument; description defaults to `"URL (http or https)"`
- [ ] `validator.ts:91` description text says what the URL is *for*, not the scheme constraint
- [ ] JSDoc warning prevents future scheme-list relaxation under pressure
- [ ] No call-site behaviour change (descriptions still surface correctly via `globalRegistry`)

## Resources

- `src/lib/utils/url.ts`
- `src/lib/schema/validator.ts`
- `src/lib/server/schemas.ts`
