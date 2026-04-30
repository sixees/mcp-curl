# TODO: Spotlighting bypass for YAML-driven tools

## Problem

`maybeApplySpotlighting` runs only inside `tool-wrapper.ts`, which wraps the
two built-in tools (`curl_execute`, `jq_query`). Tools registered via
`generateToolDefinitions()` / `registerEndpointTools()` in
`src/lib/schema/generator.ts:497-502` register handlers directly with
`server.registerTool()` and never pass through the wrapper.

Result: a YAML-configured server with `enableSpotlighting: true` silently does
NOT spotlight YAML-driven endpoints. The trust boundary is asymmetric. This is
acknowledged in `src/lib/types/public.ts:35-39`, but the `enableSpotlighting`
flag is misleading in this configuration.

## Proposed Fix

Either:

1. Apply spotlighting in the YAML-tool handler path (move the wrapping into a
   shared helper that both `tool-wrapper.ts` and `generator.ts` invoke).
2. Refuse to start (or print a hard warning to stderr) when both
   `enableSpotlighting` is true and a YAML schema is registered, so operators
   know the flag is partially honoured.

Option 1 is the right long-term fix; option 2 is a stopgap.

## Location

- `src/lib/schema/generator.ts` — `registerEndpointTools()`,
  `generateToolDefinitions()`
- `src/lib/extensible/tool-wrapper.ts` — `maybeApplySpotlighting`
- `src/lib/types/public.ts:35-39` — `enableSpotlighting` doc comment

## Source

PR #21 comprehensive review (security-sentinel, architecture-strategist)
