# TODO: Add README example for sanitizing external input in registerCustomTool

## Problem

`McpCurlServer.registerCustomTool()` accepts `description` and `title` from the caller.
When those values come from external sources (databases, user input, remote APIs), callers
need to know they should sanitize them with `sanitizeDescription()` before registering.
This is documented in the JSDoc but not shown in the README with a concrete example.

## Proposed Fix

Add a code example to the README (or API docs) showing the pattern:

```typescript
import { McpCurlServer, sanitizeDescription } from "mcp-curl";

const toolMeta = await fetchToolMetaFromDb();
server.registerCustomTool(
    "my_tool",
    {
        title: sanitizeDescription(toolMeta.title),
        description: sanitizeDescription(toolMeta.description),
        inputSchema: z.object({ q: z.string() }),
    },
    handler
);
```

Note: when `meta.description` comes from a trusted internal source (not external input),
calling `sanitizeDescription()` is not required — `registerCustomTool()` already applies
it internally.

## Location

- `README.md` — Extension system / custom tools section

## Source

PR #20 code review (coderabbitai)
