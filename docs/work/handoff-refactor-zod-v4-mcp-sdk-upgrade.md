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

---

## Code Review — 2026-04-03

### Review Summary
- **Reviewer:** automated multi-agent review (security-sentinel, typescript-reviewer, code-simplicity-reviewer)
- **Tests verified:** 306/313 ✅ (7 pre-existing skips confirmed)
- **Build verified:** clean ✅
- **Findings:** 🔴 P1: 1 | 🟡 P2: 3 | 🔵 P3: 2

### Handoff Assessment
Builder's self-assessment was honest and surfaced the right structural risks (`.refine()` guard, generator shape type, ToolCallback casts). The core CurlExecuteSchema `.refine()` is intact and functioning — all four dangerous scheme test cases verified. Key undisclosed issue: `ApiInfoSchema.baseUrl` in `validator.ts` was touched during migration and left without the scheme guard, despite being in the same codebase and feeding the same execution path. The builder's "Known issues" list did not flag this gap. The handoff was accurate on what it mentioned; incomplete on what it omitted.

### Key Findings

| ID | Severity | Category | Description | Todo File |
|----|----------|----------|-------------|-----------|
| 1 | 🔴 P1 | Security | `validator.ts:90` `baseUrl` uses bare `z.url()` — no scheme allowlist `.refine()`. Accepts `ftp://`, `file://`, `gopher://` through schema validation. Blocked downstream by SSRF, but defence-in-depth is broken. | `001-pending-p1-baseur-scheme-guard-missing-in-validator.md` |
| 2 | 🟡 P2 | Security | `api-test.ts:18`, `api-discovery.ts:18` prompt `argsSchema` URL fields also have no scheme guard. Dangerous scheme URLs pass schema validation and are interpolated into LLM prompt text verbatim. | `002-pending-p2-prompt-argschema-no-protocol-guard.md` |
| 3 | 🟡 P2 | Testing | No tests for `headers`/`form` rejecting non-string values. The `z.record()` two-arg fix is the most behaviour-changing change in the PR and has zero test coverage. | `003-pending-p2-z-record-non-string-rejection-tests-missing.md` |
| 4 | 🟡 P2 | Testing | `schemas.test.ts` boolean defaults only cover `insecure` and `follow_redirects`. Four defaults untested: `verbose`, `include_headers`, `compressed` (default `true`), `include_metadata`. | `004-pending-p2-schema-boolean-defaults-incomplete-coverage.md` |
| 5 | 🔵 P3 | TypeScript | `ToolCallback` casts in `tool-wrapper.ts:131,177` and `mcp-curl-server.ts:56,240` — structurally valid today but pre-existing technical debt. Acknowledged by builder. | `005-pending-p3-toolcallback-cast-technical-debt.md` |
| 6 | 🔵 P3 | DRY | Enum-to-literal fallback pattern duplicated 3× in `generator.ts:74,100,106`. Should be a private helper. | `006-pending-p3-generator-enum-to-literal-duplication.md` |

### Important Verified Facts (not in handoff)
- `z.url()` in Zod v4 accepts **every** dangerous scheme: `javascript:`, `data:`, `ftp://`, `file://`, `gopher://`, `blob:`, `vbscript:`, `ssh://`. It uses the WHATWG URL constructor. The `.refine()` in `schemas.ts` is NOT defence-in-depth — it is the **sole** protocol enforcement mechanism at the schema layer.
- The test comment "rejects `data:` URLs" is technically accurate (test passes), but `z.url()` itself accepts `data:` — only the `.refine()` rejects it. This matters for any future reader who might consider removing the refine.
- `generator.ts` return type `z.ZodObject<z.ZodRawShape>` is correct: `Record<string, z.ZodTypeAny>` is structurally identical to `z.ZodRawShape` in Zod v4 (confirmed via type definitions and clean build).

### Verified Claims
| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (306/313) | ✅ Yes | Independently run, confirmed |
| `ToolCallback` casts verified clean via build | ✅ Yes | Structurally sound via SDK compat layer |
| `.refine()` preserved on `schemas.ts` URL | ✅ Yes | Intact, confirmed blocking ftp/file/data/javascript |
| Schema-level tests ≡ SDK registration path | ⚠️ Partial | Accurate only if `CURL_EXECUTE_TOOL_META.inputSchema` is the exact `CurlExecuteSchema` object — not independently verified through the full registration path |
| No issues beyond listed | ❌ Incomplete | `validator.ts:90` scheme guard gap not disclosed; 4 of 6 boolean defaults untested; `z.record()` fix untested |

### Blockers
P1 finding must be resolved before merge:
- **`001`**: Add `.refine()` scheme guard to `ApiInfoSchema.baseUrl` in `validator.ts:90`
