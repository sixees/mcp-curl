# TODO: Add scheme guard to prompt `argsSchema` URL fields

**Priority:** P2 — security | **Tags:** security, code-review

## Problem

`api-test.ts:18` and `api-discovery.ts:18` use bare `z.url()` with no `.refine()` protocol guard:

```ts
// api-test.ts
url: z.url().describe("The API endpoint URL to test"),

// api-discovery.ts
base_url: z.url().describe("Base URL of the API"),
```

In Zod v4, `z.url()` accepts `javascript:alert(1)`, `gopher://evil.com`, `data:text/html,...`, `ftp://`, and `file:///` without error. The MCP SDK calls `safeParseAsync` on `argsSchema` before invoking the prompt callback, so dangerous scheme URLs pass validation and are interpolated directly into LLM message text.

Example injection path (`api-discovery.ts:27`):
```ts
text: `Explore the REST API at: ${base_url}`
```

An LLM receiving `Explore the REST API at: gopher://evil.com/_exploit` might attempt to call `curl_execute` with that value. The `CurlExecuteSchema` `.refine()` and `ssrf.ts` block actual execution — but the prompt layer provides no filtering at all, and prompt-injection with dangerous schemes can manipulate LLM behaviour before the safety layers are reached.

## Proposed Fix

Add the same `.refine()` used in `CurlExecuteSchema`:

```ts
// api-test.ts
url: z.url().refine(
    (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
    { message: "URL must use http or https scheme" }
).describe("The API endpoint URL to test"),

// api-discovery.ts — same pattern on base_url
```

## Location

- `src/lib/prompts/api-test.ts:18`
- `src/lib/prompts/api-discovery.ts:18`
