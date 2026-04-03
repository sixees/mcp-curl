# TODO: Complete boolean defaults test coverage in `schemas.test.ts`

**Priority:** P2 — testing gap | **Tags:** testing, code-review

## Problem

`schemas.test.ts` includes a "boolean defaults (Zod v4 .default() parity)" test block covering only `insecure` and `follow_redirects`. `CurlExecuteSchema` has six fields with `.default()`:

| Field | Default | Tested |
|---|---|---|
| `follow_redirects` | `true` | ✅ |
| `insecure` | `false` | ✅ |
| `verbose` | `false` | ❌ |
| `include_headers` | `false` | ❌ |
| `compressed` | `true` | ❌ |
| `include_metadata` | `false` | ❌ |

`compressed` is particularly notable — it defaults to `true` like `follow_redirects`. A silent regression to `false` would change response handling behaviour with no test catching it.

The test also lacks a case asserting explicit `follow_redirects: false` is preserved (the inverse of "preserves explicit `insecure: true`").

## Proposed Fix

Extend the defaults test block in `src/lib/server/schemas.test.ts`:

```ts
it("applies verbose: false default when not provided", () => {
    const result = CurlExecuteSchema.parse({ url: "https://example.com" });
    expect(result.verbose).toBe(false);
});

it("applies compressed: true default when not provided", () => {
    const result = CurlExecuteSchema.parse({ url: "https://example.com" });
    expect(result.compressed).toBe(true);
});

it("applies include_headers: false default when not provided", () => {
    const result = CurlExecuteSchema.parse({ url: "https://example.com" });
    expect(result.include_headers).toBe(false);
});

it("applies include_metadata: false default when not provided", () => {
    const result = CurlExecuteSchema.parse({ url: "https://example.com" });
    expect(result.include_metadata).toBe(false);
});

it("preserves explicit follow_redirects: false when provided", () => {
    const result = CurlExecuteSchema.parse({ url: "https://example.com", follow_redirects: false });
    expect(result.follow_redirects).toBe(false);
});
```

## Location

- `src/lib/server/schemas.test.ts` (add tests)
