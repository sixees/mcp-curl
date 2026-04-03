# TODO: Replace `ToolCallback` casts with SDK-correct structural type

**Priority:** P3 — TypeScript debt | **Tags:** typescript, code-review

## Problem

Two casts in `tool-wrapper.ts` and two type annotations in `mcp-curl-server.ts` work around a type mismatch between handler signatures and the MCP SDK's `ToolCallback` type:

```ts
// tool-wrapper.ts:131
}) as ToolCallback<typeof CurlExecuteSchema>

// tool-wrapper.ts:177
}) as ToolCallback<typeof JqQuerySchema>

// mcp-curl-server.ts:56
handler: ToolCallback<z.ZodObject<z.ZodRawShape>>;

// mcp-curl-server.ts:240
handler as ToolCallback<z.ZodObject<z.ZodRawShape>>
```

The casts suppress TypeScript's ability to verify that the handler's parameter type matches the schema's inferred output. As of SDK 1.29, `ToolCallback<typeof CurlExecuteSchema>` resolves correctly (the SDK uses `_zod` property detection to take the Zod v4 path, and the handler param type does match `CurlExecuteInput`). The build is clean and there is no runtime safety issue.

However, any future SDK update that changes the compat detection logic could silently break the type inference — the cast would paper over the mismatch rather than surface a compiler error.

## Proposed Fix

Investigate the SDK's recommended type path for wrapping `ZodObject` handlers:
- Check if `server.registerTool()` overloads accept a `ZodObject` schema with a properly-typed handler without casting
- If the SDK exposes a `ZodObjectHandler<typeof MySchema>` or similar, use it
- Alternatively, explicitly annotate handler parameter types using `z.infer<typeof CurlExecuteSchema>` to make the types self-documenting without relying on cast inference

The fix should eliminate the `as ToolCallback<...>` casts without changing runtime behaviour. Mark as resolved once `npm run build` passes without any casts on the affected lines.

## Location

- `src/lib/extensible/tool-wrapper.ts:131,177`
- `src/lib/extensible/mcp-curl-server.ts:56,240`
