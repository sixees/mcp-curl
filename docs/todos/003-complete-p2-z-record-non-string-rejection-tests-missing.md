# TODO: Add tests asserting `headers`/`form` reject non-string values

**Priority:** P2 — testing gap | **Tags:** security, testing, code-review

## Problem

The Zod v4 upgrade changes `z.record(z.string())` → `z.record(z.string(), z.string())` in two locations:

```ts
// schemas.ts:23
headers: z.record(z.string(), z.string()).optional(),

// schemas.ts:29
form: z.record(z.string(), z.string()).optional(),
```

This is arguably the most behaviour-changing fix in the PR — single-arg `z.record()` in Zod v4 crashes at parse time, and the two-arg form now adds **value type enforcement** (non-string values are rejected where previously they may have slipped through). Yet `schemas.test.ts` has zero tests for this path.

If a future refactor accidentally reverts to single-arg `z.record()`, the crash would only surface at runtime under load, not in the test suite.

## Proposed Fix

Add to `src/lib/server/schemas.test.ts`:

```ts
describe("CurlExecuteSchema — headers/form record validation", () => {
    it("accepts string-valued headers", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            headers: { "Content-Type": "application/json" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects numeric header values", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            headers: { "X-Count": 42 },
        });
        expect(result.success).toBe(false);
    });

    it("accepts string-valued form data", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            form: { field: "value" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects non-string form values", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            form: { count: 3 },
        });
        expect(result.success).toBe(false);
    });
});
```

## Location

- `src/lib/server/schemas.test.ts` (add tests)
- `src/lib/server/schemas.ts:23,29` (the changed lines being tested)
