---
status: pending
priority: p2
issue_id: 021
tags: [code-review, naming, conventions, public-api]
dependencies: []
source_pr: 23
review_date: 2026-05-01
review_pass: 2
---

# `httpOnlyUrl` naming drifts from established conventions in `src/lib/utils/`

## Problem Statement

The new public-barrel export `httpOnlyUrl(description: string)` is a noun-phrase factory that returns a Zod schema. It conforms to neither of the two naming conventions already established in this codebase:

- **Verb-prefixed exported functions** in `src/lib/utils/` and `src/lib/security/`: `sanitize*`, `detect*`, `apply*`, `resolve*`, `safe*`, `validate*`, `parse*`, `is*`, `create*`, `get*`. Examples: `sanitizeDescription`, `detectInjectionPattern`, `applySpotlighting`, `resolveBaseUrl`, `safeHostname`, `validateApiSchema`, `createValidationError`.
- **`Schema` suffix on Zod schema values**: `CurlExecuteSchema`, `JqQuerySchema`, `apiTestUrlSchema`, `apiDiscoveryBaseUrlSchema`, `apiInfoSchema`.

`httpOnlyUrl` is a factory (camelCase like a function) that returns a schema (so calls would expect `Schema` somewhere) but reads as a noun. Drive-by readers can't tell from the import whether they're getting a value, a function, or a schema.

This was not flagged in the first review pass.

## Findings

- **File:** `src/lib/utils/url.ts:26`
- **Pattern-recognition reviewer (F1, second pass):** "Every other exported function in `src/lib/utils/` and `src/lib/security/` is verb-prefixed; every Zod schema *value* uses a `Schema` suffix. `httpOnlyUrl` fits neither bucket."
- **Public-barrel impact:** the symbol is exported from `src/lib.ts` for external custom-tool authors. They will see it without the surrounding context that lets the maintainer infer "factory returning schema". A name that resolves the ambiguity is a low-cost win precisely *because* it's now in the public API and the cost of renaming compounds with each downstream consumer.

## Proposed Solutions

1. **Rename to `createHttpOnlyUrlSchema`** — verb-prefixed (matches `createValidationError`) and `Schema` suffix (matches the codebase's value-naming). Effort: S. Risk: breaking change for any pre-release downstream consumer (low — package is at `3.0.2` and the export was added in this PR).
2. **Rename to `httpOnlyUrlSchema`** — drops the verb prefix but at least signals "schema". Effort: S. Risk: same as above.
3. **Status quo + JSDoc** — document the factory shape explicitly. Effort: 0. Tradeoff: doesn't fix the public-API smell.

Recommended: 1, before the export goes out in any minor release. The rename is cheaper now than after PR-2..PR-9 add more consumers.

## Acceptance Criteria

- [ ] `httpOnlyUrl` is renamed to `createHttpOnlyUrlSchema` (or chosen alternative) with a re-export alias under the old name for one minor version, deprecated via JSDoc `@deprecated`.
- [ ] All call sites (`src/lib/server/schemas.ts`, `src/lib/schema/validator.ts`, `src/lib/prompts/*`) use the new name.
- [ ] `src/lib.ts` re-exports the new name; the deprecated alias still resolves for one release.
- [ ] CHANGELOG entry lists the deprecation.

## Resources

- `src/lib/utils/url.ts:26`
- `src/lib/utils/sanitize.ts` (verb-prefix examples: `sanitizeDescription`, `applySpotlighting`)
- `src/lib/security/ssrf.ts` (verb-prefix: `validateUrl`, `safeHostname`)
- `src/lib/server/schemas.ts` (`Schema` suffix: `CurlExecuteSchema`, `JqQuerySchema`)
