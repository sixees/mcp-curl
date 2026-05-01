---
status: pending
priority: p3
issue_id: 016
tags: [code-review, tests, mcp, forward-compat]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Add JSON Schema snapshot test for `CurlExecuteSchema.url`

## Problem Statement

The MCP SDK 1.29.0 emits tool input schemas via `toJsonSchemaCompat()`. If SDK 2.0 changes the converter (e.g., adopts one that *does* honour `.refine()` → `pattern`), the schema-level rejection messages and LLM-visible fields will shift silently. No CI signal would catch the change.

## Findings

- **File:** `src/lib/server/schemas.ts:11-12`
- **Reviewer (TypeScript, T7):** "Add a snapshot test that captures the JSON Schema emitted for `CurlExecuteSchema.url` so a SDK upgrade flags any change."

## Proposed Solutions

Add a snapshot test in a new `src/lib/server/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CurlExecuteSchema } from "./schemas.js";

describe("CurlExecuteSchema JSON Schema fidelity", () => {
    it("emits a stable JSON Schema for the url field", () => {
        const schema = z.toJSONSchema(CurlExecuteSchema.shape.url);
        expect(schema).toMatchSnapshot();
    });
});
```

## Acceptance Criteria

- [ ] Snapshot test added; passes
- [ ] Snapshot file committed under `__snapshots__/` or inline (project convention)
- [ ] CI catches future Zod / MCP-SDK version bumps that change the emitted shape

## Resources

- `src/lib/server/schemas.ts`
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:75-83`
- Plan PR-9 (MCP SDK 2.0 migration)
