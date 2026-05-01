---
status: pending
priority: p2
issue_id: 001
tags: [code-review, typescript, public-api, forward-compat]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Pin `httpOnlyUrl()` return type for public-barrel stability

## Problem Statement

`httpOnlyUrl()` has an implicit return type. After build, `dist/lib.d.ts:17` emits `declare function httpOnlyUrl(description: string): z.ZodURL` — which (a) hides the `.refine()` constraint from downstream type tooling and (b) couples the public signature to whatever `z.url().refine()` returns in the current Zod minor. A future Zod 4.x patch that switches `.refine()` to return `ZodEffects<ZodURL>` (Zod 3 behaviour) would silently flip the public type and break consumer inferred types.

## Findings

- **File:** `src/lib/utils/url.ts:26`
- **Reviewer (TypeScript):** "the signature implies a plain `z.url()`, hiding from downstream consumers that there is a refine on top — they could legitimately expect that the schema is exactly `z.url()` and write tests/casts that accept e.g. `ftp://` because the type says `ZodURL`."
- **Reviewer (Architecture, A7):** Standard Schema migration (MCP SDK 2.0) will eventually rewrite `.refine()` semantics — pinning the return type contains the blast radius.

## Proposed Solutions

1. **Annotate `z.ZodType<string>`** — most stable, hides Zod-version drift. Tradeoff: loses `.optional()`/`.default()` chainability of `ZodURL` for callers that tried to extend the schema. (Verify nobody does.) Effort: S.
2. **Annotate `ReturnType<typeof z.url>` (or the explicit refined type)** — preserves chainability, but pins to Zod's internal naming. Effort: S.
3. **Add a `satisfies` clause + JSDoc note + regression test** asserting `z.infer<ReturnType<typeof httpOnlyUrl>>` is `string`. Effort: S.

Recommended: option 3 (declarative, type-test locks it).

## Acceptance Criteria

- [ ] `httpOnlyUrl()` has an explicit return-type annotation
- [ ] A type-level test asserts `z.infer<ReturnType<typeof httpOnlyUrl>>` is `string`
- [ ] JSDoc adds a "Standard Schema migration" note: when SDK 2.0 lands, `.refine()` becomes a `validate()` callback; caller signature is unchanged
- [ ] `dist/lib.d.ts` regenerates with the pinned signature; no consumer-visible type drift

## Resources

- `src/lib/utils/url.ts:26-37`
- `dist/lib.d.ts:17`
- Plan PR-9 (MCP SDK 2.0 migration)
