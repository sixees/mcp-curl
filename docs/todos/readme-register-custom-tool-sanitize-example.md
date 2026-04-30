# TODO: Add README example for sanitizing inputSchema field descriptions

## Problem

`McpCurlServer.registerCustomTool()` already sanitizes the top-level `title` and
`description` it receives — callers do not need to call `sanitizeDescription()`
on those fields.

What is **not** sanitized internally is the `inputSchema` Zod object: in particular,
`.describe()` strings on individual fields. When those descriptions come from an
external source (database row, remote API, user-authored YAML), they can carry
the same Unicode-attack characters (bidi overrides, zero-width chars, Tags block,
soft hyphen, etc.) that `sanitizeDescription()` strips from top-level metadata.
Tool consumers (LLM clients) read field-level descriptions when deciding how to
populate arguments, so an attacker who controls a field description has the same
leverage as one who controls the tool description.

The library exports `sanitizeDescription` (and `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH`)
specifically so callers can apply it at the schema-construction boundary, but the
README has no concrete example showing where to do that.

## Proposed Fix

Add a code example to the README showing the pattern for externally-sourced
field descriptions (NOT for top-level title/description, which are already
handled internally):

```typescript
import { z } from "zod";
import { McpCurlServer, sanitizeDescription } from "mcp-curl";

const fieldMeta = await fetchFieldDescriptionsFromDb();

server.registerCustomTool(
    "my_tool",
    {
        // title and description: sanitized internally by registerCustomTool —
        // callers MAY pre-sanitize defensively but do not need to.
        title: "My tool",
        description: "Searches the catalog and returns matching items.",
        // inputSchema field descriptions: sanitized by the CALLER, because the
        // library never inspects inside the Zod schema.
        inputSchema: z.object({
            q: z.string().describe(sanitizeDescription(fieldMeta.q)),
            limit: z.number().int().min(1).max(100)
                .describe(sanitizeDescription(fieldMeta.limit)),
        }),
    },
    handler
);
```

Add a paired note clarifying the boundary:

> `registerCustomTool()` sanitizes `title` and `description`. It does **not**
> reach into `inputSchema` — apply `sanitizeDescription()` to any `.describe()`
> string sourced from outside your own code. For trusted internal strings, no
> sanitization is required.

## Location

- `README.md` — Extension system / custom tools section
- See also: `docs/custom-tools.md` (already has a paired example block; consider
  cross-linking)

## Source

PR #20 code review (coderabbitai); refined per PR #22 review (coderabbitai)
