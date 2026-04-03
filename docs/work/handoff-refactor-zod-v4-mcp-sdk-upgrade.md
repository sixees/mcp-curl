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
- **`ToolCallback` casts** — Removed in `3d887b3`. `tool-wrapper.ts` now uses typed `const handler: ToolCallback<typeof Schema>` declarations instead of `as` casts. Build is clean and structurally sound.

## Known issues and limitations

- The plan mentioned reviewing the MCP SDK 1.26–1.29 changelog as Step 1. This was skipped per user instruction (pre-work confirmed already done). If there are undocumented SDK changes in those versions, they are not covered here.
- `ToolCallback` casts in `tool-wrapper.ts` were replaced in `3d887b3` with proper typed `const handler: ToolCallback<typeof Schema>` declarations. No remaining casts.
- 7 tests are skipped (platform-specific, pre-existing).

## Testing summary

```bash
npm run build   # must exit clean (zero TypeScript errors)
npm test        # must pass — 7 pre-existing skips are expected
```

- **Tests added:** 9 (URL scheme rejection × 4, valid URL acceptance × 2, boolean defaults × 3) | **Passing:** yes | **Linting:** N/A (no linter configured)
- **Result:** `npm run build` clean, `npm test` 306/313 (7 pre-existing skips)
- **Test gaps:** No integration test exercising the full MCP protocol path (tool dispatch → schema parse → handler). Coverage relies on the schema-level equivalence argument above.

## Commit history

```text
c32eb8a docs: fix MD022 blank-line violations in plan file
3d887b3 refactor: remove ToolCallback casts and extract enum schema helpers
ad43a8d docs: remove completed P1/P2 todo files
19c2324 fix(security): add http/https scheme guard to baseUrl and prompt URL fields
3ffa14e docs: add review findings to handoff document and create todos
53ecd70 feat(release): v3.0.0 — Zod v4, MCP SDK 1.29, security tests
10925fa refactor(zod): upgrade to Zod v4 and apply all breaking change fixes
251efe7 chore(deps): bump @modelcontextprotocol/sdk to ^1.29.0
```

## Review context

- Review `src/lib/server/schemas.ts` first — the URL `.refine()` guard is the highest-risk change.
- Then `src/lib/schema/validator.ts` — public API type change (`ZodIssue`).
- Then `src/lib/schema/generator.ts` — the `ZodRawShape` → `Record` fix.
- The prompt files (`api-test.ts`, `api-discovery.ts`) are trivial one-liners.

## Follow-up work

- [x] Replace `as ToolCallback<...>` casts in `tool-wrapper.ts` with the SDK's correct structural type — done in `3d887b3`
- [ ] Consider publishing to npm as `mcp-curl@3.0.0` with migration notes in README

---

## Code Review — 2026-04-03

### Review Summary
- **Reviewer:** automated multi-agent review (security-sentinel, typescript-reviewer, code-simplicity-reviewer)
- **Tests verified:** 306/313 ✅ (7 pre-existing skips confirmed)
- **Build verified:** clean ✅
- **Findings:** 🔴 P1: 1 | 🟡 P2: 3 | 🔵 P3: 2

### Handoff Assessment
Builder's self-assessment surfaced the key structural risks (`.refine()` guard, generator shape type, ToolCallback casts). The core `CurlExecuteSchema` `.refine()` is intact and functioning — dangerous scheme test cases verified. `ApiInfoSchema.baseUrl` in `validator.ts` also has an explicit http/https scheme guard (added in `19c2324`), with scheme rejection covered in tests.

### Key Findings — All Resolved

| ID | Severity | Category | Description | Resolution |
|----|----------|----------|-------------|------------|
| 1 | ~~🔴 P1~~ ✅ | Security | `validator.ts:90` `baseUrl` — scheme allowlist `.refine()` initially missing. | Fixed in `19c2324` |
| 2 | ~~🟡 P2~~ ✅ | Security | `api-test.ts`, `api-discovery.ts` prompt URL fields — no scheme guard. | Fixed in `19c2324` |
| 3 | ~~🟡 P2~~ ✅ | Testing | No tests for `headers`/`form` rejecting non-string values. | Fixed in `19c2324` |
| 4 | ~~🟡 P2~~ ✅ | Testing | Boolean defaults incomplete coverage. | Fixed in `19c2324` |
| 5 | ~~🔵 P3~~ ✅ | TypeScript | `ToolCallback` casts — pre-existing technical debt. | Removed in `3d887b3` |
| 6 | ~~🔵 P3~~ ✅ | DRY | Enum-to-literal fallback pattern duplicated in `generator.ts`. | Extracted in `3d887b3` |

### Important Verified Facts (not in handoff)
- `z.url()` in Zod v4 accepts **every** dangerous scheme: `javascript:`, `data:`, `ftp://`, `file://`, `gopher://`, `blob:`, `vbscript:`, `ssh://`. It uses the WHATWG URL constructor. The `.refine()` is NOT defence-in-depth — it is the **sole** protocol enforcement mechanism at the schema layer.
- `generator.ts` return type `z.ZodObject<z.ZodRawShape>` is correct: `Record<string, z.ZodTypeAny>` is structurally identical to `z.ZodRawShape` in Zod v4 (confirmed via type definitions and clean build).

### Verified Claims
| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (306/313) | ✅ Yes | Independently run, confirmed |
| `ToolCallback` casts verified clean via build | ✅ Yes | Casts subsequently removed in `3d887b3` |
| `.refine()` preserved on `schemas.ts` URL | ✅ Yes | Intact, confirmed blocking ftp/file/data/javascript |
| Schema-level tests ≡ SDK registration path | ✅ Yes | `CURL_EXECUTE_TOOL_META.inputSchema = CurlExecuteSchema` confirmed at `src/lib/tools/curl-execute.ts:112` — the SDK calls `.parse()` on this exact object, so schema tests exercise the same default-application path. Full end-to-end dispatch not separately tested (documented in plan). |

## PR Review Pass — 2026-04-03

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| mcp-sql docs included in branch | @gemini-code-assist | Fix needed | Removed 5 unrelated files (commit 4484ada) |
| Unicode U+200E in docs/todos filenames | @gemini-code-assist | Fix needed | Renamed to remove stray chars (commit 8509833) |
| Incorrect P1 blocker for ApiInfoSchema.baseUrl | @coderabbitai | Fix needed | Corrected stale Code Review section (commit 8509833) |
| Contradictory ToolCallback statements | @coderabbitai | Fix needed | Unified to: casts removed in 3d887b3 (commit 8509833) |
| MD040 missing language on commit-history fence | @coderabbitai | Fix needed | Added `text` tag (commit 8509833) |
| data:/javascript: scheme tests missing | @coderabbitai | Fix needed | Added 2 tests to schema.test.ts (commit 8509833) |
| Stale TODO: filterPresets.description | @coderabbitai | Fix needed | Deleted file — feature already implemented (commit 8509833) |
| Centralize URL-scheme allowlist | @coderabbitai | Fix needed | Extracted httpOnlyUrl() in utils/url.ts (commit 8509833) |
| MD040/MD031 in mcp-sql plan docs (×5 threads) | @coderabbitai | False positive | Moot — files removed |
| Security/code notes on mcp-sql plan code samples (×3 threads) | @coderabbitai | False positive | Plan docs removed; notes valid for future implementation |

### Files Modified
- `src/lib/utils/url.ts` — added `httpOnlyUrl()` helper
- `src/lib/utils/index.ts` — export `httpOnlyUrl`
- `src/lib/prompts/api-test.ts` — use `httpOnlyUrl()`
- `src/lib/prompts/api-discovery.ts` — use `httpOnlyUrl()`
- `src/lib/schema/schema.test.ts` — data: and javascript: scheme tests
- `docs/work/handoff-refactor-zod-v4-mcp-sdk-upgrade.md` — stale findings corrected
- `docs/todos/filter-preset-description.md‎` — deleted
- `docs/todos/cache-utilities.md‎` → `cache-utilities.md` (rename)
- `docs/todos/configure-unknown-fields.md‎` → `configure-unknown-fields.md` (rename)
- Removed: 5 mcp-sql docs/plan files
