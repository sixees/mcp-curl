---
title: "refactor: Upgrade Zod to v4 and MCP SDK to latest"
type: refactor
status: completed
date: 2026-04-03
---

# refactor: Upgrade Zod to v4 and MCP SDK to latest

## Overview

A recommendation from working on another TypeScript MCP server was to ensure we're on the latest MCP SDK and using `zod/v4` imports. Research confirms we're already using `server.registerTool()` ✅, but we're on Zod v3 and have a stale declared SDK version. This refactor upgrades both and fixes the handful of breaking API changes in the codebase.

**Semver decision:** This is a **major version bump** (e.g., `v3.0.0`). The public API surface (`src/lib.ts`) directly exports `CurlExecuteInput`, `JqQueryInput`, `ApiSchemaValidationError.issues: ZodIssue[]`, and `CustomToolMeta.inputSchema: z.ZodObject<z.ZodRawShape>` — all of which carry Zod type parameters. Consumers on `mcp-curl` v2.x with their own `zod@^3.x` will get TypeScript type mismatches after this upgrade. This is a breaking change in the public TypeScript contract.

## Current State

| Dependency | Declared | Installed | Latest |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.12.0` | `1.25.3` | `1.29.0` |
| `zod` | `^3.23.8` | `3.25.76` | `4.3.6` |

Both packages stay in `dependencies`. Neither is a peer dep — both are used at runtime throughout the codebase and mcp-curl is not a peer plugin in the React-component-library sense. Adding them to `peerDependencies` would create dual-declaration conflicts with package managers and is semantically wrong.

**Good news:** `server.registerTool()` is already the only pattern used. The SDK v1.x supports both Zod v3 and v4 via its internal `zod-compat.js` layer — no registration API changes are needed.

## What Is "zod/v4"?

`zod/v4` is a subpath export within the `zod` npm package itself (not a separate package):
- Pre-July 2025: `zod@3.25+` shipped Zod 4 under the `zod/v4` subpath; root `"zod"` still resolved to v3
- Post-July 2025: `zod@4.0.0` published as npm `latest`; root `"zod"` now resolves to v4 natively

For this project, upgrading to `zod@^4.0.0` and keeping `import { z } from "zod"` is the clean path.

## Pre-Work: SDK Changelog Review

**Do this before writing any code.** Review the `@modelcontextprotocol/sdk` changelog for versions 1.26–1.29 to identify any non-Zod breaking changes. Key risk: `registerPrompt`'s `argsSchema` is used in `api-test.ts:17` and `api-discovery.ts:17` with inline Zod schemas. If the `PromptArgsRawShape` type constraint changed, these may break independently of the Zod migration.

If the changelog reveals additional breaking changes, add them to the Confirmed Breaking Changes section below before proceeding.

## Confirmed Breaking Changes in This Codebase

### 1. `z.record(z.string())` — Hard Runtime Crash (3 locations)

Zod v4 requires two arguments for `z.record()`. Single-argument form builds silently but **crashes at parse time** (`Cannot read properties of undefined (reading '_zod')`). Every tool call including headers or form data would crash.

| File | Line | Current | Fix |
|---|---|---|---|
| `src/lib/server/schemas.ts` | 24 | `headers: z.record(z.string())` | `z.record(z.string(), z.string())` |
| `src/lib/server/schemas.ts` | 30 | `form: z.record(z.string())` | `z.record(z.string(), z.string())` |
| `src/lib/schema/validator.ts` | 99 | `headers: z.record(z.string())` | `z.record(z.string(), z.string())` |

Note: CRLF injection protection for header values lives in the curl args builder (`validateNoCRLF`), not the schema. Do not remove those downstream checks when updating the schema.

### 2. `z.string().url()` → `z.url()` — Deprecated + Error Code Change + `.refine()` must be preserved (4 locations)

The error code changes from `invalid_string` → `invalid_format`, which silently breaks test assertions. Migrate to `z.url()`.

**Critical:** The `url` field in `CurlExecuteSchema` (`schemas.ts:12–19`) has a two-step guard:
1. `z.string().url()` — URL format check
2. `.refine(scheme => ["http","https"].includes(...))` — explicit protocol allowlist

The `.refine()` is the schema-layer protocol gate. Migrate to `z.url().refine(...)`, preserving the `.refine()` unchanged. Do not lose this guard.

| File | Line | Current | Fix |
|---|---|---|---|
| `src/lib/server/schemas.ts` | 12 | `z.string().url("Must be a valid URL").refine(...)` | `z.url().refine(...)` — preserve `.refine()` unchanged |
| `src/lib/schema/validator.ts` | 89 | `z.string().url()` | `z.url()` |
| `src/lib/prompts/api-test.ts` | 18 | `z.string().url()` | `z.url()` |
| `src/lib/prompts/api-discovery.ts` | 18 | `z.string().url()` | `z.url()` |

In Zod v4, `z.url()` returns a `ZodString` with a format check, so `.refine()`, `.optional()`, and `.describe()` chain off it identically to before.

### 3. `z.ZodIssue` — Public API Type Change (1 location)

`ApiSchemaValidationError.issues: z.ZodIssue[]` in `validator.ts:121` is part of the public API exported from `src/lib.ts`. In Zod v4, `ZodIssue` structure changes (no `received` key on `invalid_type` issues). Replace the namespace-qualified access with a direct named import — this is a deliberate public API type change, not just a compile fix.

| File | Line | Current | Fix |
|---|---|---|---|
| `src/lib/schema/validator.ts` | 121 | `public readonly issues: z.ZodIssue[]` | Add `import type { ZodIssue } from "zod"` → `public readonly issues: ZodIssue[]` |

Document this in CHANGELOG: `ApiSchemaValidationError.issues` now carries Zod v4's `ZodIssue` (no `received` field on `invalid_type` issues).

### 4. `ToolCallback` generic casts — Structural review required

The `as ToolCallback<typeof CurlExecuteSchema>` casts in `tool-wrapper.ts:131,177` and the `ToolCallback<z.ZodObject<z.ZodRawShape>>` type in `mcp-curl-server.ts:40,56,240` need structural review, not just build verification.

The casts work today because they paper over a type mismatch: the code passes a `ZodObject` instance where the SDK expects a raw shape. After upgrading to Zod v4, the SDK's `zod-compat` layer detects Zod version via the `_zod` property. If the compat detection changes in SDK 1.29.0, the handler's `params` could silently become less typed, meaning boolean defaults (`insecure`, `follow_redirects`) lose type guarantees at the handler boundary.

**Action:** After running `npm run build`, verify the casts still correctly infer handler param types. If the SDK moved to a different type path for v4 schemas, replace the `as ToolCallback<z.ZodObject<...>>` casts with the correct SDK-expected pattern (passing `.shape` or using the `AnySchema` path).

## Proposed Solution

> **Recommended approach:** Two commits on the same branch for bisectability — commit 1 upgrades the SDK only (Zod stays v3, all tests must pass), commit 2 upgrades Zod and applies all code fixes. This makes failures attributable.

### Step 1 — Pre-work (before any code)
Review `@modelcontextprotocol/sdk` changelog for versions 1.26–1.29. Add any new findings above before proceeding.

### Step 2 — Commit 1: Bump SDK only
- Update `@modelcontextprotocol/sdk` to `^1.29.0` in `package.json`
- Run `npm run build` + `npm test` — must be green before proceeding

### Step 3 — Commit 2: Zod v4 upgrade + fixes
1. Bump `zod` to `^4.0.0` in `package.json`
2. Replace `z.record(z.string())` → `z.record(z.string(), z.string())` at the 3 locations
3. Replace `z.string().url()` → `z.url()` at all 4 locations — preserve the `.refine()` on `schemas.ts:12` unchanged
4. Add `import type { ZodIssue } from "zod"` in `validator.ts`; change `z.ZodIssue[]` → `ZodIssue[]`
5. Run `npm run build` — fix any TypeScript errors on `ToolCallback` generics (see above)
6. Grep test files for hardcoded Zod error codes/messages: `grep -r "invalid_string\|Invalid url\|Invalid string" src/` — fix any matches

### Step 4 — Security regression tests (required before merging)
Add explicit tests for the items below. These are not covered by the existing suite.

### Step 5 — CHANGELOG + version bump
- Bump to next major version (e.g., `v3.0.0`)
- CHANGELOG entry: Zod v4 upgrade, major semver, breaking changes for TypeScript consumers, `.url()` error code change

## Acceptance Criteria

### Functional
- [ ] `package.json` declares `zod: "^4.0.0"` and `@modelcontextprotocol/sdk: "^1.29.0"` in `dependencies` only (no `peerDependencies` section added)
- [ ] All three `z.record(z.string())` calls replaced with `z.record(z.string(), z.string())`
- [ ] All four `z.string().url()` usages replaced with `z.url()`; `.refine()` on `schemas.ts:12` is unchanged
- [ ] `import type { ZodIssue } from "zod"` in `validator.ts`, `z.ZodIssue` references removed
- [ ] `npm run build` exits cleanly (zero TypeScript errors)
- [ ] `npm test` passes (all tests green)
- [ ] No grep hits for `z.string().url\(\)` or `z.record(z.string())` (single-arg) in `src/`

### Security (new tests required)
- [ ] `CurlExecuteSchema.safeParse({ url: "ftp://evil.com" })` returns `success: false`
- [ ] `CurlExecuteSchema.safeParse({ url: "file:///etc/passwd" })` returns `success: false`
- [ ] `CurlExecuteSchema.safeParse({ url: "data:text/html,<script>" })` returns `success: false`
- [ ] `CurlExecuteSchema.safeParse({ url: "javascript:alert(1)" })` returns `success: false`
- [ ] Passing `{ url: "https://example.com" }` to the registered tool handler (via the MCP SDK registration path) results in `params.insecure === false` at the executor

### Release
- [ ] Package bumped to next **major** version
- [ ] CHANGELOG documents: Zod v4, major semver rationale, `ZodIssue` type structure change, `invalid_string` → `invalid_format` error code change for `.url()` validators

## Technical Considerations

**`ToolCallback` casts:** These already paper over a type mismatch (passing `ZodObject` where SDK expects a raw shape). After upgrading, verify the handler inference still produces correctly typed `params`. If broken, the fix is to align with the SDK's expected type path rather than widening the cast.

**`.default()` timing in Zod v4:** Defaults apply the same way for `safeParse()`. The risk is if the SDK calls `parseAsync()` or handles schema defaults differently. The new `insecure` test (acceptance criteria above) covers this path.

**`.url()` error message change:** In v4, URL validation failures produce a different error message and code (`invalid_format` vs `invalid_string`). Library consumers pattern-matching on `issue.message` or `issue.code` from `ApiSchemaValidationError.issues` will silently break — document in CHANGELOG.

**MCP SDK v2 alpha:** There's a `2.0.0-alpha.2` on GitHub (monorepo split, ESM-only, Node 20+). Not upgrading to that — staying on 1.29.0 stable.

**No codemod needed:** The surface area is small (~7 call sites). Manual edits are faster and more reviewable.

## Work Breakdown & PR Plan

| # | Task | Depends On | Est. Files | Effort |
|---|------|-----------|-----------|--------|
| 1 | SDK changelog review (pre-work) | — | 0 | S |
| 2 | Bump SDK to `^1.29.0`, build + test green | 1 | 1 | S |
| 3 | Bump Zod to `^4.0.0`, fix `z.record()` (3 sites) | 2 | 2 | S |
| 4 | Migrate `z.string().url()` → `z.url()` (4 sites) | 2 | 4 | S |
| 5 | Fix `z.ZodIssue` → direct `ZodIssue` import | 2 | 1 | S |
| 6 | `npm run build` + fix `ToolCallback` generics if needed | 3, 4, 5 | 0–2 | S–M |
| 7 | Add security regression tests | 3, 4 | 1–2 | S |
| 8 | Grep + fix hardcoded error code strings in tests | 6 | test files | S |
| 9 | `npm test` full pass | 6, 7, 8 | — | S |
| 10 | CHANGELOG + major version bump | 9 | 1 | S |

### PR Plan

| PR | Includes Tasks | Est. Files | Review Complexity | Can Start After |
|----|---------------|-----------|-------------------|-----------------|
| PR-1 | 1–10 (all) | 8–12 | Low–Medium | Immediately |

**Single PR** — all changes are tightly related dependency upgrade work. Use two commits internally (SDK only, then Zod + fixes) for bisectability.

## Dependencies & Risks

**Risk: `.refine()` dropped during `.url()` migration** — The scheme check (`http`/`https` only) could be silently lost. Mitigation: the security acceptance criteria above cover this; add those tests before merging.

**Risk: `ToolCallback` cast breaks with v4 type hierarchy** — Mitigation: `npm run build` surfaces this immediately. The fix is structural alignment with the SDK's expected input type, not widening the cast.

**Risk: `insecure` default not applied via SDK path** — Mitigation: new test exercising the full registration path.

**Risk: Test assertions on Zod error codes** — Mitigation: `grep -r "invalid_string" src/` before running tests.

**Risk: SDK 1.25.3 → 1.29.0 unknown changes** — Mitigation: changelog review as step 1 (pre-work).

**Not a risk:** `server.registerTool()` — already correct, no change needed.

## References & Research

### Internal References

- Tool registration: `src/lib/server/registration.ts`
- Core schemas: `src/lib/server/schemas.ts:10-96`
- Schema validator: `src/lib/schema/validator.ts:99,121`
- Prompt schemas: `src/lib/prompts/api-test.ts:18`, `src/lib/prompts/api-discovery.ts:18`
- Public API types: `src/lib/extensible/mcp-curl-server.ts:40,56`
- ToolCallback casts: `src/lib/extensible/tool-wrapper.ts:131,177`
- Public exports: `src/lib.ts`
- SSRF validation (downstream URL check): `src/lib/security/ssrf.ts:86`
- CRLF validation (downstream header check): curl args builder

### External References

- [Zod v4 Migration Guide](https://zod.dev/v4/changelog)
- [Zod v4 Versioning Strategy](https://zod.dev/v4/versioning)
- [MCP SDK npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- Codemod (if preferred over manual): `npx zod-v3-to-v4 src/`
