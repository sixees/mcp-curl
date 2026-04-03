# TODO: Extract `buildEnumOrLiteral()` helper in `generator.ts` (DRY)

**Priority:** P3 — DRY | **Tags:** spr-dry, code-review

## Problem

The "Zod enum requires at least 2 elements; fall back to `z.literal()` for single-element enums" pattern appears three times in `src/lib/schema/generator.ts`:

1. **Line 74–83** — `filter_preset` field: string enum or literal
2. **Lines 100–103** — `param.enum` with strings: string enum or literal
3. **Lines 106–112** — `param.enum` with numbers: union of literals or single literal

All three encode the same structural rule. If the rule changes (e.g., Zod v5 allows single-element `z.enum()`), all three sites must be updated. Currently they are not co-located so the duplication is easy to miss.

## Proposed Fix

Extract a helper (can be module-private):

```ts
function buildStringEnum(values: string[]): z.ZodTypeAny {
    if (values.length === 1) return z.literal(values[0]);
    return z.enum(values as [string, ...string[]]);
}

function buildNumberEnum(values: number[]): z.ZodTypeAny {
    if (values.length === 1) return z.literal(values[0]);
    return z.union(
        values.map((v) => z.literal(v)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]
    );
}
```

Replace the three duplicated blocks. The existing `schema.test.ts` suite should cover the behaviour regression.

## Location

- `src/lib/schema/generator.ts:74–83, 100–112`
