# TODO: Auto-sanitize Zod field descriptions on custom tool registration

## Problem

`McpCurlServer.registerCustomTool()` sanitizes `meta.title` and
`meta.description`, but explicitly delegates Zod-field-description
sanitization (`z.string().describe(...)` on `meta.inputSchema`) to the caller.
A caller that passes externally-sourced strings into a Zod field's
`.describe()` will leak bidi/zero-width chars into tool advertisement.

The contract is documented in `mcp-curl-server.ts:217-220`, but the trust
boundary is fragile — the documentation is not enforcement.

## Proposed Fix

Either:

1. Best-effort traversal of the top-level Zod object's `.shape`, sanitizing
   each field's `_def.description` in place at registration time.
2. Reject any `meta.inputSchema` whose serialised description fields contain
   characters that fail a `sanitizeDescription()` round-trip (loud failure
   instead of silent passthrough).

Option 1 matches the convenience contract of `meta.title` / `meta.description`
sanitization. Option 2 makes the contract auditable.

## Location

- `src/lib/extensible/mcp-curl-server.ts:266-291` — `registerCustomTool`

## Source

PR #21 comprehensive review (security-sentinel)
