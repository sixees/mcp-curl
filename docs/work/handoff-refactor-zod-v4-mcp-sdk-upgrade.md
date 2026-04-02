# Work Handoff: Zod v4 + MCP SDK Upgrade

**Date:** 2026-04-03 | **Branch:** refactor/zod-v4-mcp-sdk-upgrade | **Plan:** docs/plans/2026-04-03-refactor-upgrade-zod-v4-mcp-sdk-plan.md | **Status:** complete

## Summary

Upgraded `@modelcontextprotocol/sdk` from `^1.12.0` to `^1.29.0` and `zod` from `^3.23.8` to `^4.0.0`. Applied all Zod v4 breaking change fixes (~8 call sites across 5 source files), added 9 security regression tests, and bumped to `v3.0.0` (major — breaking TypeScript API surface). Two commits for bisectability as planned.

## What was implemented

### Commit 1: SDK bump (bisect anchor)
- **What:** `@modelcontextprotocol/sdk ^1.12.0 → ^1.29.0` in `package.json`
- **Key files:** `package.json`, `package-lock.json`
- **Approach:** Isolated to make failures attributable. Confirmed 297/304 tests green before proceeding.

### Commit 2: Zod v4 upgrade + all code fixes
- **What:** Bumped `zod ^3.23.8 → ^4.0.0`; fixed 8 breaking call sites across 5 files
- **Key files created/modified:**
  - `src/lib/server/schemas.ts` — `z.string().url()` → `z.url()` (preserving `.refine()` protocol guard), `z.record(z.string())` → `z.record(z.string(), z.string())` for `headers` and `form`
  - `src/lib/schema/validator.ts` — same `z.url()` / `z.record()` fixes; `import type { ZodIssue }` + `z.ZodIssue[]` → `ZodIssue[]`
  - `src/lib/schema/generator.ts` — `const shape: z.ZodRawShape` → `Record<string, z.ZodTypeAny>` (Zod v4 makes `ZodRawShape` Readonly, blocking index assignment)
  - `src/lib/prompts/api-test.ts`, `api-discovery.ts` — `z.string().url()` → `z.url()`
- **Approach:** Manual edits (surface area small, ~8 sites). `ToolCallback` casts verified clean via `npm run build` — TypeScript accepted them unchanged.

### Security regression tests
- **What:** New test file `src/lib/server/schemas.test.ts` — 9 tests
- **Key files:** `src/lib/server/schemas.test.ts` (new)
- **Approach:** Direct `safeParse` / `parse` on `CurlExecuteSchema`. Since `CURL_EXECUTE_TOOL_META.inputSchema = CurlExecuteSchema` and the MCP SDK calls `CurlExecuteSchema.parse()` before invoking the handler, schema-level tests are equivalent to the "SDK registration path" acceptance criterion.

### CHANGELOG + version bump
- **What:** `package.json` version `2.0.1 → 3.0.0`; CHANGELOG entry under `[3.0.0] - 2026-04-03`

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Two commits (SDK-only, then Zod) | Bisectability — failures attributable to specific change | Single commit |
| `Record<string, z.ZodTypeAny>` for generator shape | Zod v4's `ZodRawShape` is `Readonly<...>` so index assignment fails; local mutable type used before passing to `z.object()` | Casting `as z.ZodRawShape` |
| Schema-level tests for "SDK path" insecure default | `CURL_EXECUTE_TOOL_META.inputSchema = CurlExecuteSchema` means SDK calls `parse()` on this schema; testing schema directly is accurate | Mock McpServer + callTool (more complex, same coverage) |
| Major version bump (3.0.0) | `ZodIssue` type structure changed, error codes changed (`invalid_string` → `invalid_format`), `zod` peer divergence — TypeScript contract broken for consumers on v2 | Minor bump (would be incorrect under semver) |

## What to pay attention to during review

- **Risk: `.refine()` preserved** — Verify `schemas.ts` URL field is `z.url("Must be a valid URL").refine(url => ["http","https"].includes(...))`. The security test (`ftp://`, `file://`) covers this, but visually confirm the refine is not lost.
- **Risk: `generator.ts` shape type** — `Record<string, z.ZodTypeAny>` is a local mutable type, passed to `z.object(shape)`. Return type is still `z.ZodObject<z.ZodRawShape>` — verify this assignment is still accepted by TypeScript (it is, per clean build).
- **Edge case: `z.url()` message handling** — In Zod v4, `z.url("message")` passes the message as a string argument, not an options object. `validator.ts` previously used `z.string().url({ message: "..." })`. The new form `z.url("Base URL must be a valid URL")` is correct Zod v4 API.
- **`ToolCallback` casts** — `tool-wrapper.ts:131,177` still uses `as ToolCallback<typeof CurlExecuteSchema>`. Build is clean, but a reviewer should confirm the cast's structural validity if the SDK's type internals changed (the plan's "structural review required" note).

## Known issues and limitations

- The plan mentioned reviewing the MCP SDK 1.26–1.29 changelog as Step 1. This was skipped per user instruction (pre-work confirmed already done). If there are undocumented SDK changes in those versions, they are not covered here.
- `ToolCallback` casts in `tool-wrapper.ts` paper over a type mismatch (passing `ZodObject` where SDK expects a raw shape). This pre-existed and was not introduced by this PR. The build is clean, but the casts should be flagged as technical debt.
- 7 tests are skipped (platform-specific, pre-existing).

## Testing summary

- **Tests added:** 9 (URL scheme rejection × 4, valid URL acceptance × 2, boolean defaults × 3) | **Passing:** yes | **Linting:** N/A (no linter configured)
- **Manual testing:** `npm run build` (clean), `npm test` (306/313)
- **Test gaps:** No integration test exercising the full MCP protocol path (tool dispatch → schema parse → handler). Coverage relies on the schema-level equivalence argument above.

## Commit history

```
10925fa refactor(zod): upgrade to Zod v4 and apply all breaking change fixes
251efe7 chore(deps): bump @modelcontextprotocol/sdk to ^1.29.0
```

## Review context

- Review `src/lib/server/schemas.ts` first — the URL `.refine()` guard is the highest-risk change.
- Then `src/lib/schema/validator.ts` — public API type change (`ZodIssue`).
- Then `src/lib/schema/generator.ts` — the `ZodRawShape` → `Record` fix.
- The prompt files (`api-test.ts`, `api-discovery.ts`) are trivial one-liners.

## Follow-up work

- [ ] Replace `as ToolCallback<...>` casts in `tool-wrapper.ts` with the SDK's correct structural type (ongoing tech debt, not introduced here)
- [ ] Consider publishing to npm as `mcp-curl@3.0.0` with migration notes in README
