---
status: pending
priority: p3
issue_id: 015
tags: [code-review, documentation, typescript]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Add `@param` and `@returns` to `httpOnlyUrl` JSDoc

## Problem Statement

The JSDoc on `httpOnlyUrl` explains *why* WHATWG is used but says nothing about the `description` parameter — what it's for, how it surfaces (forwarded to `.describe()` → JSON Schema `description` field seen by LLM clients). No `@param` / `@returns`. For a public exported helper, IDE hover should explain the contract.

## Findings

- **File:** `src/lib/utils/url.ts:16-25`
- **Reviewer (TypeScript, T2):** "the JSDoc should surface that contract."
- **Reviewer (TypeScript, T8):** also flag that "calling per-request leaks into `z.globalRegistry`" — module-level use only.

## Proposed Solutions

Add tags:

```ts
/**
 * Zod schema for a URL restricted to http/https schemes.
 * ...
 *
 * Intended for module-level use. Each call writes to z.globalRegistry; calling
 * per-request would leak entries (the registry never reclaims them).
 *
 * @param description - Forwarded to .describe(). Becomes the JSON Schema
 *   "description" field that LLM clients render in tool input docs. Should
 *   describe what the URL is *for*; the http(s) constraint is enforced by
 *   the helper itself.
 * @returns Zod schema accepting only http(s) URLs.
 */
```

## Acceptance Criteria

- [ ] `@param description` documents the forwarding behaviour
- [ ] `@returns` documents the schema's contract
- [ ] JSDoc note on module-level-only intended use (globalRegistry behaviour)

## Resources

- `src/lib/utils/url.ts:16-25`
