# Work Handoff: PR-5 — Auto-sanitise Zod field descriptions on `registerCustomTool()` (B4)

**Date:** 2026-05-01 | **Branch:** `feat/hardening-pr-5-custom-tool-zod-rebuild` | **Plan:** [`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`](../plans/2026-04-30-chore-pre-bigwork-hardening-plan.md) (PR-5 / B4) | **Status:** complete

## Summary

Closes plan item **B4**. `McpCurlServer.registerCustomTool()` now auto-sanitises every `.describe()` string inside `inputSchema` at registration time — top-level fields, nested `ZodObject`, `ZodArray`, `ZodUnion`, and through `ZodOptional` / `ZodDefault` / `ZodNullable` wrappers. The walk uses Zod v4's public `field.description` getter and re-applies sanitised descriptions via `field.describe()` (clone-and-register against `z.globalRegistry`), avoiding the runtime no-op trap of mutating `_def.description`. A WeakMap memoisation cache keys on both input and output identity so repeated registrations or re-feeds short-circuit. Standard-Schema regression check uses `z.toJSONSchema()` to verify sanitised values are visible at every depth.

## What was implemented

### Deep `inputSchema` sanitisation
- **What:** Three new helpers in `src/lib/extensible/mcp-curl-server.ts`:
  - `sanitizeFieldDescriptionsDeep(schema: z.ZodObject<z.ZodRawShape>)` — top-level entry point used by `registerCustomTool`. WeakMap-cached. Rebuilds the shape via `sanitizeFieldDeep` per key, returns a new `z.object(...)` with the parent's own (sanitised) description re-applied.
  - `sanitizeFieldDeep(field: z.ZodTypeAny)` — recursive worker. Dispatches on instance type: `ZodObject` → recurse via top-level helper; `ZodOptional` / `ZodNullable` / `ZodDefault` → recurse into `.unwrap()`, re-wrap, re-apply outer wrapper's description; `ZodArray` → recurse into `.element`, rebuild via `z.array()`; `ZodUnion` → recurse into each `.options[i]`, rebuild via `z.union()`. Plain leaves (`ZodString`, `ZodNumber`, ...) → re-apply sanitised description if present, else return identity.
  - `reapplyDescription(rebuilt, original)` — reads `original.description` via the public getter, sanitises it, and calls `.describe()` on `rebuilt` if non-empty. Returns identity when there is no description.
- **Wiring:** `registerCustomTool()` calls `sanitizeFieldDescriptionsDeep(meta.inputSchema)` inside the existing `sanitizedMeta` block.
- **Key files:**
  - `src/lib/extensible/mcp-curl-server.ts` (modified — import `z` value-side, add cache + helpers, wire helper into `sanitizedMeta`, expand JSDoc on `registerCustomTool`)
  - `src/lib/extensible/mcp-curl-server.test.ts` (modified — new `describe(...)` block with 11 cases at end of file)
  - `README.md` (B2 example — wording softened to "defensive" since registration-time deep sanitisation is now authoritative)
  - `docs/custom-tools.md` (Tool metadata and schema descriptions section — updated to describe deep-walk contract; example marked optional/defensive)
- **Approach:**
  - Composition with the existing fluent builder pattern. No public API change to `CustomToolMeta`; internal sanitisation happens transparently.
  - Pure functions at module scope (no class state). State lives in the `WeakMap`, which is GC'd alongside the schema instance.
  - Re-build via `.describe()` (Zod's clone-and-register semantics) rather than mutating `_def`. This was the technical-review correction — the original plan diff was a runtime no-op.
  - Per-instance type dispatch via `instanceof` against `z.ZodObject` / `z.ZodOptional` / `z.ZodNullable` / `z.ZodDefault` / `z.ZodArray` / `z.ZodUnion`. Order matters (`ZodOptional`/`ZodDefault`/`ZodNullable` before `ZodObject` is fine since they are disjoint, but the chain is explicit).

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Use `field.describe()` (clone+register) instead of mutating `field._def.description` | Zod v4 stores descriptions in `z.globalRegistry` (a WeakMap); `_def.description` is not the source of truth — mutations are silently ignored by `.parse()`, `.toJSONSchema()`, etc. Verified empirically and via `node_modules/zod/v4/classic/schemas.js:74-77`. | (a) Direct `_def` mutation — broken at runtime. (b) `field.clone()` + manual registry write — fragile, re-implements internal API. |
| Recurse into wrappers via `.unwrap()` / `.element` / `.options`, then re-apply the wrapper's own description | The wrapper is the "field" the caller registered; its description is the user-facing one. Inner schemas may also carry descriptions and must be sanitised independently. | Walking only the outer wrapper would miss nested `.describe()` strings inside `z.optional(z.object({...}))`. |
| WeakMap cache keyed on **both** input and output identity | Idempotence: repeated registration with the same source schema returns the cached rebuild; if a caller re-feeds the rebuilt schema, it short-circuits at the entry check (output is mapped to itself). Ensures `===` reference equality across calls. | Cache only on input → re-feeding the rebuild would do redundant work and produce a third instance, breaking identity expectations. |
| Type the public helper as `z.ZodObject<z.ZodRawShape>`, absorb `$ZodType` ↔ `ZodType` divergence via casts internally | Public surface stays Zod-classic. Zod v4 internals expose the core `$ZodType` base on shape members and wrapper accessors (`unwrap`, `element`, `options`) — converting via `as z.ZodTypeAny` keeps internal calls type-safe without polluting the public type. | Widening `CustomToolMeta.inputSchema` to `StandardSchemaV1` is a future MCP SDK 2.0 migration concern, not a B4 concern. |
| Soften B2 README example wording (now "defensive — also runs at registration") rather than remove the example | The pattern is still useful for callers building Zod schemas dynamically across modules, and is a clear belt-and-braces signal in code review. | Remove the example → loses the discoverability of `sanitizeDescription` as a public helper. |

## What to pay attention to during review

- **Risk areas:**
  - **Zod v4 internal access patterns** in `sanitizeFieldDeep`. We rely on `instanceof` checks against `z.ZodObject`, `z.ZodOptional`, `z.ZodNullable`, `z.ZodDefault`, `z.ZodArray`, `z.ZodUnion` and on `.unwrap()` / `.element` / `.options` accessors. These are all Zod-public, but if the user upgrades to Zod v5 mid-project, this code needs re-verification. The plan calls this out explicitly (PR-5 § Research Insights).
  - **`.default()` value handoff.** `field._def.defaultValue` may be a function or a value. `inner.default(defaultValue)` re-creates the wrapper. Cast site is the only typing fudge here — it goes through `Parameters<typeof inner.default>[0]`. Worth a careful look in case Zod's `defaultValue` typing tightens.
  - **Discriminated unions / intersections.** `ZodDiscriminatedUnion` and `ZodIntersection` are not handled by the dispatch. They fall through to the leaf branch and only get the outer description sanitised — no recursion into options/parts. This is documented in the JSDoc and is a deliberate omission for B4 (no current callers use them); a follow-up could extend the dispatch if a YAML-schema author or custom-tool registration needs it.
  - **Reference identity contract.** The "memoisation idempotence" test relies on `===` reference equality. If a future refactor introduces a layer that wraps or rebuilds the schema again post-sanitisation (e.g. inside `tool-wrapper`), the contract would break silently. Tests assert this — they are the load-bearing check.

- **Edge cases (covered):**
  - Top-level bidi-override strip.
  - `.describe()` chained on `.optional()` and `.default()` wrappers.
  - Nested `ZodObject` (S3).
  - `ZodArray<ZodObject>` nested members (S3).
  - `ZodUnion` of objects (S3).
  - Optional-wrapped nested object (`z.optional(z.object({...}))`) — wrapper description is sanitised AND inner field descriptions are sanitised.
  - Field with no `.describe()` → identity preserved (no-op rebuild path).
  - Memoisation: same schema reference twice → second call returns cached.
  - Memoisation: re-feeding the rebuilt schema → cache short-circuits to itself.
  - `z.toJSONSchema()` output carries the sanitised description at every depth (Standard-Schema regression / A7).

- **Edge cases (not covered):**
  - `ZodRecord`, `ZodMap`, `ZodSet`, `ZodTuple`, `ZodLazy`, `ZodPipeline`, `ZodEffects`, `ZodIntersection`, `ZodDiscriminatedUnion` — fall through to leaf branch, only outer description sanitised. Not currently used by built-in tools or any caller in this repo. If a follow-up introduces them, extend the dispatch.

- **Under-tested:**
  - The `.default()` wrapper with a *function* default (`z.string().default(() => "x")`) — the test uses a literal default. The codepath is the same (`field._def.defaultValue` is forwarded as-is), but a function-default test would tighten the contract.

- **Pattern deviations:** None. The helpers live in the same file as `McpCurlServer` rather than being extracted to `src/lib/utils/`. They are tightly coupled to the `registerCustomTool` lifecycle and have no other consumer; extracting them would expose Zod-v4-internal call patterns at a public surface for no gain. If a future caller needs them (e.g. YAML-tool generator wants to deep-sanitise generated schemas), extraction becomes worthwhile.

## Known issues and limitations

- **Zod v4 only.** Dispatch logic uses `instanceof` against Zod v4's classic schema classes. A Zod v5 upgrade would require revalidating that `field.description`, `field.describe()`, `.unwrap()`, `.element`, `.options`, and `_def.defaultValue` are still the public/stable surface. The plan's research-insights block (lines 632-636 of `2026-04-30-chore-pre-bigwork-hardening-plan.md`) calls this out.
- **No coverage for tuples, records, sets, intersections, discriminated unions, lazy, or pipelines.** These pass through the leaf branch unchanged. Out of scope for B4.
- **Field-key names and `z.enum([...])` literal values are not sanitised.** They are part of the public shape contract — sanitising them would silently change validation behaviour. The README/docs explicitly call this out.

## Testing summary

- **Tests added:** 11 in `src/lib/extensible/mcp-curl-server.test.ts` under `describe("McpCurlServer.registerCustomTool() inputSchema deep sanitisation (B4)", ...)`.
- **Cases:**
  1. Top-level field — bidi override stripped.
  2. `.optional()` field — sanitised through wrapper.
  3. `.default()` field — sanitised through wrapper.
  4. Nested `ZodObject` (S3).
  5. `ZodArray<ZodObject>` (S3).
  6. `ZodUnion` of objects (S3).
  7. `.optional(z.object(...))` — both wrapper description and inner field sanitised (S3).
  8. No-`.describe()` fields — identity preserved (no-op).
  9. Memoisation — same input twice returns the same cached rebuild (C3).
  10. Memoisation — re-feeding rebuilt schema short-circuits (C3 variant — output identity check).
  11. `z.toJSONSchema()` round-trip — sanitised description visible at every depth (Standard-Schema regression / A7).
- **Passing:** yes (645 total / 7 skipped — 634 baseline + 11 new).
- **Linting:** TypeScript `--noEmit` clean apart from the pre-existing `src/lib.test.ts(78,5)` error (a `BeforeRequestResult` generic-arity issue unrelated to this PR; verified present on `main` before this work).
- **Build:** `npm run build` produces clean `dist/`.
- **Manual testing:** N/A — pure registration-time logic, fully covered by unit tests.
- **Test gaps:**
  - Function-typed `.default(() => ...)` (codepath identical to literal default).
  - `ZodDiscriminatedUnion` / `ZodIntersection` / `ZodTuple` / `ZodRecord` / `ZodMap` / `ZodSet` / `ZodLazy` / `ZodPipeline` (out of scope; documented in handoff).

## Commit history

This PR ships as a single feature commit on `feat/hardening-pr-5-custom-tool-zod-rebuild`. After merge:

```
git log --oneline main..HEAD
```

(Log will be populated post-commit; expected single commit titled `feat(custom-tool): deep-sanitise inputSchema field descriptions (PR-5 / B4)`.)

## Review context

**Suggested review order:**

1. `src/lib/extensible/mcp-curl-server.ts` lines ~80-220 (cache + three helpers) and lines ~410-430 (wiring into `registerCustomTool`).
2. `src/lib/extensible/mcp-curl-server.test.ts` final `describe(...)` block.
3. `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` lines 485-637 (B4 spec, technical-review corrections, acceptance criteria — all ticked).
4. `README.md` lines 150-185 (B2 example wording softened).
5. `docs/custom-tools.md` "Tool metadata and schema descriptions" section.

**Related docs:**

- [`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`](../plans/2026-04-30-chore-pre-bigwork-hardening-plan.md) — master plan; PR-5 / B4 is lines 485-637.
- [`docs/work/handoff-feat-hardening-pr-4-auth-token.md`](handoff-feat-hardening-pr-4-auth-token.md) — prior PR; established 634-test baseline.
- [`docs/custom-tools.md`](../custom-tools.md) — public custom-tool docs.
- Zod v4 internals (read-only, for reviewer reference): `node_modules/zod/v4/classic/schemas.js` (`globalRegistry`, `.describe`, `clone`).

**Dependencies on prior PRs:**

- **PR-1** (URL helper hardening): no overlap — `httpOnlyUrl` is unrelated to schema description sanitisation.
- **PR-2** (`executeJqQuery` unit tests): no overlap.
- **PR-3** (README sanitisation example): **direct dependency.** PR-5 softens the wording added in PR-3 (`required` → `defensive — also runs at registration at every depth`). Same example; updated language.
- **PR-4** (HTTP auth token validation): no overlap — separate transport-startup path.
- **No follow-up PRs are blocked by PR-5.** PR-6a/6b/7/8/9 are independent of B4.

## Post-Deploy Monitoring & Validation

**No runtime impact.** B4 is a registration-time pure-function rebuild. There are no logs, no metrics, no network calls, no file writes. Behavioural change is observable only via:

- The output of `z.toJSONSchema(meta.inputSchema)` for any custom tool registered with externally-sourced `.describe()` strings — the JSON Schema description field is now sanitised at every depth.
- The MCP `tools/list` response sent to clients — `inputSchema` description fields are sanitised.

**Validation window:** N/A (no production deploy gate). Confidence is from unit tests and the Standard-Schema round-trip check, not deploy-time observability.

**Failure trigger:** if `mcp-curl-server.test.ts` deep-sanitisation block fails after a Zod minor/patch upgrade, treat it as a Zod-internal API drift signal and re-verify against `node_modules/zod/v4/classic/schemas.js`.

## Follow-up work

- [ ] Consider extending `sanitizeFieldDeep` to handle `ZodTuple`, `ZodRecord`, `ZodIntersection`, `ZodDiscriminatedUnion` if a caller introduces them.
- [ ] If MCP SDK 2.0 lands the Standard Schema migration, replace the helper rather than extend it (per plan §Standard Schema readiness).
- [ ] PR-6a (B9 — `sanitizeApiSchemaInPlace` integration into `ApiSchemaValidator`).
- [ ] PR-6b (B3 — defence-in-depth wrap parity for YAML/custom-tool output).
- [ ] PR-7 (B7 — script/style/markdown-link strip in markup content types).
- [ ] PR-8 (B6 — Unicode/whitespace ranges for `sanitizeResponse`).
- [ ] PR-9 (B8 — broader detection patterns).

### Outstanding Todos
<!-- Todos created this session that still need work — see docs/todos/ for full content -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _(none — no new todos created in this session)_ | | | |

### Resolved Todos
<!-- Recorded before deletion. File no longer exists in docs/todos/. -->
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _(none — no `docs/todos/` input was passed to this session)_ | | | | |
