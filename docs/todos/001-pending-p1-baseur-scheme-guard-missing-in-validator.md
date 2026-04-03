# TODO: Add scheme allowlist `.refine()` to `ApiInfoSchema.baseUrl`

**Priority:** P1 — security | **Tags:** security, code-review

## Problem

`validator.ts:90` validates `baseUrl` with `z.url()` but no scheme guard:

```ts
baseUrl: z.url("Base URL must be a valid URL"),
```

In Zod v4, `z.url()` uses the WHATWG URL constructor, which accepts `ftp://`, `file://`, `data:`, `javascript:`, `gopher://`, and other dangerous schemes without error. A YAML schema file with `baseUrl: "ftp://evil.com"` passes `validateApiSchema()` and enters the codebase as trusted data. The value is then composed into every generated tool URL via `buildUrl()` in `generator.ts:346`.

The SSRF validator (`ssrf.ts:86`) catches protocol violations at request time, but the Zod schema layer is supposed to be the first line of defence — not a silent pass-through.

By contrast, `CurlExecuteSchema.url` in `schemas.ts:11–18` correctly applies:
```ts
.refine(
    (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
    { message: "URL must use http or https scheme" }
)
```

This is inconsistent and a defence-in-depth failure introduced when this file was touched in the Zod v4 upgrade.

## Proposed Fix

Apply the same `.refine()` to `ApiInfoSchema.baseUrl` in `src/lib/schema/validator.ts:90`:

```ts
baseUrl: z.url("Base URL must be a valid URL").refine(
    (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
    { message: "Base URL must use http or https scheme" }
),
```

Add a corresponding test in `src/lib/schema/schema.test.ts` asserting that `validateApiSchema()` throws for `baseUrl: "ftp://evil.com"`.

## Location

- `src/lib/schema/validator.ts:90`
- `src/lib/schema/schema.test.ts` (add test)
