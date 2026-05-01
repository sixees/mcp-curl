---
status: complete
priority: p2
issue_id: 006
tags: [code-review, mcp, json-schema, llm-context]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# JSON Schema emitted to the LLM does not carry the http(s) constraint

## Problem Statement

The MCP SDK 1.29.0 emits tool input schemas via Zod's `toJSONSchema`. For `httpOnlyUrl("The URL to request")` the result is:

```json
{ "type": "string", "format": "uri", "description": "The URL to request" }
```

The `.refine()` (the actual http/https constraint) is **not** reflected. The LLM sees `format: "uri"` and a free-form description that *does not mention* the http(s) restriction (the `validator.ts` baseUrl description does, but `server/schemas.ts:12` does not). LLMs that try `file:///…` or `ftp://…` will get a runtime validation error with no schema-level guidance, wasting a turn.

## Findings

- **File:** `src/lib/utils/url.ts:26-37`
- **File:** `src/lib/server/schemas.ts:12` — description is just `"The URL to request"`
- **File:** `src/lib/schema/validator.ts:91` — already correct (`"Base URL (must use http or https)"`)
- **Reviewer (TypeScript, T5):** verified the JSON Schema shape end-to-end via `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:75-83`.

## Proposed Solutions

1. **Description-only fix** — update `CurlExecuteSchema.url` description to `"The URL to request (must use http or https)"`. Cheap; relies on LLM reading the description. Effort: S.
2. **Encode the constraint in JSON Schema** — add `pattern` so the constraint is machine-checkable: change `httpOnlyUrl` to `z.string().url().regex(/^https?:\/\//i).refine(...)`. Effort: M. Tradeoff: regex parses URL surface differently from WHATWG and could accept things WHATWG rejects (or vice versa). Requires careful test coverage to keep the two layers consistent.
3. **Custom Zod converter** — emit `pattern` from `.refine()` metadata via Zod's `.meta()`. Most correct; most complex. Effort: L.

Recommended: solution 1 immediately, plus open a follow-up to evaluate solution 3 once the rest of the hardening series settles.

## Acceptance Criteria

- [ ] `CurlExecuteSchema.url` description text mentions the http(s) constraint
- [ ] Snapshot or assertion test confirms the description string ends up in the JSON Schema seen by clients
- [ ] (Optional) decision recorded on whether to pursue `pattern`-emission for the constraint

## Resources

- `src/lib/server/schemas.ts:12`
- `src/lib/utils/url.ts:26`
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:75-83`
