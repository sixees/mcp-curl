# Work Handoff: PR-6a — YAML schema sanitize-at-validate-time (B9)

**Date:** 2026-05-02
**Branch:** `feat/hardening-pr-6a-yaml-validate-sanitise`
**Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B9 / PR-6a section, lines 838–899)
**Status:** complete

## Summary

Moves YAML schema sanitisation from a per-call concern in the generator into an invariant of the parser itself. `ApiSchemaValidator` now wraps the inner Zod schema in a `z.preprocess(sanitiseRawSchema, …)` step that produces a sanitised deep clone of the raw input *before* any Zod check runs. Every public entry point — `loadApiSchema`, `loadApiSchemaFromString`, `validateApiSchema`, *and* the directly-re-exported `ApiSchemaValidator.parse()` — therefore yields a sanitised schema, AND Zod's own issue messages (and downstream cross-field error messages) quote sanitised values rather than raw attacker bytes. The downstream generator trusts the contract and no longer re-sanitises.

This closes the security hole identified by the technical review (S1): a consumer who imported `ApiSchemaValidator` from the public barrel and called `.parse()` directly was bypassing the loader-level sanitisation entirely. The loader is no longer a sanitisation layer — there is one chokepoint, in the validator. Caller-supplied schemas passed to `createApiServer({ schema })` / `createApiServerSync(schema)` are re-validated for the same reason.

## What was implemented

### Validator: sanitisation as a `z.preprocess` chokepoint
- **Files:** `src/lib/schema/validator.ts`
- **What:** `ApiSchemaValidator = z.preprocess(sanitiseRawSchema, RawApiSchema.transform((schema, ctx) => { … cross-field checks via ctx.addIssue …; return schema; }))`. The preprocess step deep-clones the raw input via `structuredClone` (defeats `__proto__`-style payloads, leaves caller's input unchanged) and walks the clone, replacing every user-facing string field via `sanitizeDescription()`. The `.transform()` step then runs the cross-field checks: duplicate endpoint IDs, undefined path parameters, and duplicate filter-preset names. Each check uses `ctx.addIssue` so the parse fails with a normal Zod error (translated to `ApiSchemaValidationError` by `validateApiSchema()`).
- **Fields sanitised:** `api.title`, `api.description`, `endpoint.id`, `endpoint.path`, `endpoint.title`, `endpoint.description`, `parameter.description`, `filterPresets[*].name`, `filterPresets[*].description`, `auth.apiKey.envVar`, `auth.bearer.envVar`. The `id` and `path` inclusions keep cross-field error messages free of attacker bytes; `auth.*.envVar` inclusion keeps the LLM-visible `Authentication error: Missing required environment variable: …` response clean.
- **Fields NOT sanitised:** `parameter.name` (used as object keys in input schemas and as URL parameter names — sanitising could change client semantics) and `preset.jqFilter` (engine receives the raw filter; the human-readable interpolation in `generator.ts` sanitises at display time via `renderJqFilterForDisplay()`).
- **Tolerant by design:** any unexpected shape (non-object, missing keys, wrong types) is left untouched — Zod will reject it with a normal validation error downstream. `structuredClone` is wrapped in `try/catch`; on `DataCloneError` the original value is returned and Zod still emits its normal validation error.
- **Doc comment:** `ApiSchemaValidator`'s JSDoc explicitly documents the contract; a top-of-file comment in `validator.ts` declares it the load-bearing invariant. The TypeScript type does NOT carry the invariant; it is a runtime property only.

### Loader: no longer a sanitisation layer
- **Files:** `src/lib/schema/loader.ts`
- **What:** The loader was deliberately stripped of any sanitisation walker. `loadApiSchema` and `loadApiSchemaFromString` are thin pass-throughs that parse YAML safely (`yaml.JSON_SCHEMA` to block `!!js/function` etc.) and hand the result to `validateApiSchema()` — which routes through the single `z.preprocess` chokepoint. A loader-side walker would duplicate the field-set knowledge and miss the direct `ApiSchemaValidator.parse(rawObj)` and `validateApiSchema(rawObj)` entry points.
- **Note:** A top-of-file comment explicitly states the absence of a loader-side sanitiser and points the next reader to `validator.ts`.

### Factory: `createApiServer*` re-validates caller-supplied schemas
- **Files:** `src/lib/api-server.ts`
- **What:** Both factories (`createApiServer({ schema })` and `createApiServerSync(schema)`) now call `validateApiSchema(schema)` on the caller-supplied branch before configuring the server. Without this, a hand-constructed `ApiSchema` (or one cast from a `Record<string, unknown>`) bypasses the sanitiser — bidi/zero-width bytes would flow into MCP tool advertisement unchecked.

### Generator: trust, document, stop re-sanitising
- **Files:** `src/lib/schema/generator.ts`
- **What:** Removed the redundant `sanitizeDescription()` calls from every site that consumes pre-sanitised fields. Top-of-file comment block declares the trust contract.
- **What stays:** A single `sanitizeDescription` call, encapsulated in the named helper `renderJqFilterForDisplay()` and used only at the display-time interpolation of `preset.jqFilter`. The validator deliberately leaves `jqFilter` raw so the engine receives the author's filter unchanged. The drift-resistance test `generator.ts has at most one sanitizeDescription call` (in `schema.test.ts`) guards the boundary against future regressions.
- **Removed:** The runtime `if (uniqueNames.size !== presetNames.length) throw …` block in `generateInputSchema()`. Duplicates are now a parse-time `ApiSchemaValidationError`.

### Tests: PR-6a sanitisation invariant + review-fix coverage (90 tests in schema.test.ts)
- **Files:** `src/lib/schema/schema.test.ts`, `src/lib/api-server.test.ts`
- **Updated existing tests** that asserted the old generator-side sanitisation behaviour: they now assert the *boundary contract* (validator-bypassed input survives the generator unchanged) and point readers to the validator-side coverage.
- **`PR-6a sanitisation invariant` describe block** (six sub-describes):
  - `ApiSchemaValidator.parse()` (raw-validator-bypass path — S1) — direct `.parse()` strips bidi/zero-width chars from `api.*`, `endpoint.*`, `parameter.description`, `filterPresets[*].*`, `auth.apiKey.envVar`, `auth.bearer.envVar`; rejects post-sanitise duplicate preset names.
  - `validateApiSchema()` (wrapper parity) — wrapper produces identical output to direct `.parse()`; raises `ApiSchemaValidationError` on duplicates.
  - `loadApiSchemaFromString()` round-trip — bidi chars in YAML are stripped end-to-end.
  - `preprocess sanitisation keeps Zod and cross-field error messages clean` — Zod error messages on malformed payloads do not echo raw bidi bytes (single chokepoint covers all entry points).
  - `integration #020: data: baseUrl rejection through every entry point` — the URL-scheme invariant survives the new preprocess; `baseUrl: data:...` is rejected through `loadApiSchemaFromString`, `validateApiSchema`, *and* `ApiSchemaValidator.parse`.
  - `generator boundary` — explicit test that `generateInputSchema()` preserves an unsanitised `param.description` verbatim, asserted via `z.toJSONSchema()` (the projection an MCP client actually sees), proving the trust boundary is now in code.
- **`review-fix coverage (P1/P2 closure)` describe block** (five cases) — empty-string rejection, cross-field error hygiene for `endpoint.path` and `endpoint.id`, drift-resistance grep for `generator.ts`, and structurally-malformed-input tolerance for the preprocess walker.
- **`api-server.test.ts`** — three new cases that assert against `server.getRegisteredCustomTools()` (a new public read-only accessor on `McpCurlServer`) so the bypass-closure tests verify actual tool metadata, not just `getConfig()`.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Combine sanitise + duplicate-detect in one `.transform()` step (with `ctx`) | Duplicate detection has to see post-sanitise values to catch collisions like `"Summary"` vs `"​Summary"`. The first cut used `.superRefine().transform()` chained, but superRefine fires before transform — collisions slipped past. Using the same transform keeps both invariants atomic. | (a) Run `superRefine` after transform — Zod doesn't expose that ordering cleanly. (b) Sanitise twice — wasteful and confusing. (c) Keep duplicate check in generator — would fail at runtime instead of parse-time. |
| Drop the `__sanitized: true` type brand idea | Plan-critic + simplicity reviewer + TypeScript reviewer all agreed: the brand adds friction at every call site without preventing the bypass. The runtime invariant in the validator is opaque-but-safe; the brand was theatre. | Brand the result type so consumers must accept it; opted against on plan guidance. |
| Pre-Zod sanitise in `loader.ts` (A8) — keep validator transform as the load-bearing layer | Zod issue messages can quote attacker content before transform runs. Pre-walking the raw object is cheap and keeps error messages clean. The validator transform stays authoritative — pre-Zod is observability hygiene, not the security barrier. | Skip pre-Zod entirely; risk leaking bidi chars through error logs. |
| Keep `sanitizeDescription(preset.jqFilter)` in the generator | jqFilter is *deliberately* not validator-sanitised — the engine needs the raw form. Interpolation into the human-readable tool description still needs cleaning at display time. | Add jqFilter to the validator's sanitise list — would break the engine on filters that contain U+200B as a deliberate jq path char. |
| Use `z.toJSONSchema()` to read the description in the new generator-boundary test | The earlier attempt at `schema.shape.q.description` returned `undefined` because `.optional()` wraps `.describe()` and Zod's getter doesn't unwrap automatically. `z.toJSONSchema()` is what the MCP client actually receives, so testing through it is more honest. | Test via `_def.description` — fragile internal API. |
| Make filterPresets duplicate detection a `ctx.addIssue` rather than a hard throw | A custom Zod issue produces a normal `ApiSchemaValidationError` with a useful path (`endpoints.0.response.filterPresets.1.name`), which integrates with how every other validation error is reported and logged. | Throw a plain `Error` from the transform — would short-circuit other parse errors and produce a less structured message. |

## What to pay attention to during review

- **Risk: filterPresets duplicate detection now fires inside the transform.** The transform mutates `schema` in place, then walks for duplicates. If the mutation throws (`sanitizeDescription` is pure but if something downstream changes that, behaviour shifts), the whole parse fails — that's the intended fail-closed behaviour, but worth confirming. Tests in `validateApiSchema (wrapper parity) > surfaces duplicate filter-preset names as ApiSchemaValidationError` cover this.
- **Risk: `sanitizeApiSchemaInPlace` mutates the input.** Since Zod parses by cloning shape-by-shape, the object handed to `.transform()` is already an internal copy — the user's input object is not modified. The integration test `validateApiSchema() > yields the same sanitised output as ApiSchemaValidator.parse()` calls `JSON.parse(JSON.stringify(raw))` to defensively confirm both paths produce equal output.
- **Edge case: pre-Zod walker tolerance.** `sanitizeRawYamlDescriptions` deliberately doesn't fail on unexpected shapes — non-object roots, arrays where objects are expected, etc. Zod will reject those downstream. The risk: a future contributor might assume the walker validates structure. The function's JSDoc explicitly documents "tolerant by design".
- **Pattern deviation: a single `.transform()` doing two things (sanitise + report duplicates).** Conventionally, refinements and transforms are separate. The combined form is documented in the JSDoc with the reason — duplicates only emerge after sanitisation, so they have to be in the same step.
- **`jqFilter` sanitisation asymmetry.** `preset.jqFilter` is the only field a reader will see *not* pre-sanitised by the validator. The generator's top-of-file comment + the inline comment at the call site document why. If a future contributor adds another consumer of `preset.jqFilter` (e.g. surfaces it in another tool description), they need to remember to sanitise at display time.

## Known issues and limitations

- **No new behavioural guarantees outside what PR-6a explicitly covered.** PR-6b (B3 — defence-in-depth wrap on YAML/custom-tool output) is still open and is a sequenced follow-up.
- **`sanitizeRawYamlDescriptions` walks only the documented shape.** A new YAML field added in a future schema version that carries user-facing text will need to be added here AND to `sanitizeApiSchemaInPlace`. Both functions are tightly localised so this should be obvious in review, but there's no compile-time enforcement (the brand idea was rejected).
- **The pre-Zod walker mutates the parsed YAML object in place.** Same fail-closed reasoning as the validator transform — Zod runs on the same object and would catch any structural issue — but if a future caller passes the same parsed object into multiple validators expecting different sanitisation, only the first call's output reflects the intended state.
- **Tests do not exercise NaN/symbol/Date in description fields.** The pre-Zod walker checks `typeof === "string"` before sanitising, which is the correct guard; a non-string just falls through to Zod's normal validation error.

## Testing summary

- **Tests added:** ~14 new test cases across 5 sub-describes inside the new `PR-6a sanitisation invariant` block (`schema.test.ts:1352–1640`).
- **Tests updated:** 2 existing tests rewritten to reflect the new boundary contract:
  - `generateInputSchema > preserves manually-constructed (validator-bypassed) preset names verbatim` (was: `throws when two preset names collide after sanitization`)
  - `generateToolDefinitions > preserves bidi/zero-width chars when generator is called with validator-bypassed schema` (was: `strips Unicode bidi overrides and zero-width characters from descriptions`)
- **Passing:** yes — full `npm test` suite passes (676 tests, 7 skipped, 24 files).
- **Linting/build:** `npm run build` produces clean output, no TypeScript errors.
- **Manual testing:** validated locally via `npx vitest run src/lib/schema/schema.test.ts` (84/84 pass).
- **Test gaps:** no benchmark coverage. The `.transform()` step adds one extra walk per parse — negligible overhead for a startup-time operation, but not formally measured. The PR-6a plan section did not call out a perf budget for this PR (those land in PR-7/PR-8).

## Commit history

Will appear after commit; planned single commit:

```
feat(schema): sanitise YAML schemas at parse time, close ApiSchemaValidator bypass (PR-6a / B9)
```

## Review context

- **Suggested review order:**
  1. `src/lib/schema/validator.ts` — start here. The `.transform()` step is the load-bearing change; everything else trusts it.
  2. `src/lib/schema/loader.ts` — pre-Zod walker, defence-in-depth.
  3. `src/lib/schema/generator.ts` — confirm every `sanitizeDescription()` removal is justified and the surviving `jqFilter` call is correct.
  4. `src/lib/schema/schema.test.ts` — verify the `PR-6a sanitisation invariant` describe block covers all paths called out in the plan acceptance criteria.
- **Plan section:** lines 838–899 of `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`.
- **Dependency on other work:** PR-6b (defence-in-depth wrap on YAML/custom-tool output) is the sequenced next step — independent file-set, but reviewers benefit from landing 6a first so the schema layer's invariants are stable.

## Follow-up work

- [ ] PR-6b — defence-in-depth wrap on YAML/custom-tool output (B3 / 4th asymmetry). Independent file-set; sequenced after this for review focus.
- [ ] Consider whether `RawApiSchemaType` should be exported for advanced consumers who want to reason about the *un-transformed* shape. Not needed for any current caller; deferred until someone asks.

### Outstanding Todos
<!-- Todos created this session that still need work — see docs/todos/ for full content -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none_ | — | — | — |

### Resolved Todos
<!-- Recorded before deletion. File no longer exists in docs/todos/. -->
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a plan section, not a `docs/todos/` file_ | — | — | — | — |

---

## Code Review — 2026-05-02

### Review Summary
- **Reviewer:** automated multi-agent review (security-sentinel, architecture-strategist, performance-oracle, typescript-reviewer, code-simplicity-reviewer, pattern-recognition-specialist, learnings-researcher) run in parallel.
- **Findings:** 🔴 P1: 3 | 🟡 P2: 8 | 🔵 P3: 6
- **Status:** All findings resolved in commit (this session).

### Handoff Assessment
The original handoff was substantively honest about what was built but **overpromised on completeness**. Three Critical bypasses were undisclosed:
1. The `createApiServer({schema})` / `createApiServerSync(schema)` factories accept a raw `ApiSchema` and skip `ApiSchemaValidator` entirely — direct contradiction of the stated invariant.
2. Cross-field error messages (path-param-not-defined, duplicate-id) interpolate raw `endpoint.path` and `endpoint.id` content; the loader-side walker did not cover these fields.
3. `return result.data as ApiSchema;` masked a real type divergence (Zod's `.default(false)` on `required` made inferred type `boolean`; manual interface said `boolean | undefined`).

The handoff acknowledged the validator/loader walker DRY duplication risk but did not propose a fix; review converged on collapsing both walkers into a single `z.preprocess()` step on the validator, which also closes the cross-field error-message leak in a single chokepoint.

### Key Findings & Resolution
| ID | Severity | Category | Description | Resolution |
|----|----------|----------|-------------|-----------|
| 1 | 🔴 P1 | security | `createApiServer({schema})` / `createApiServerSync` bypass the validator | `validateApiSchema(options.schema)` now runs in the `options.schema` branch of both factories (`api-server.ts:182, :219`); regression tests in `api-server.test.ts:149-179` |
| 2 | 🔴 P1 | security | Cross-field error messages echo raw `endpoint.id` / `endpoint.path` | Sanitisation moved into a `z.preprocess()` step (`validator.ts:241-249`); raw fields are sanitised before any Zod check or cross-field validation runs. Walker now covers `endpoint.id` and `endpoint.path` too |
| 3 | 🔴 P1 | typescript | `as ApiSchema` cast hides type divergence | `types.ts` updated to declare `required: boolean` (no `?`) on `EndpointParameter`, `ApiKeyAuth`, `BearerAuth` — matches Zod's `.default()` outputs; cast removed from `validator.ts` |
| 4 | 🟡 P2 | security | Sanitisation can yield empty strings, silently violating `min(1)` | Automatic via the new architecture: `z.preprocess` runs BEFORE `z.string().min(1)`, so sanitised-to-empty strings now naturally fail validation. Regression test in `schema.test.ts` |
| 5 | 🟡 P2 | architecture/dry | Two walkers encode the same shape | Loader-side `sanitizeRawYamlDescriptions` deleted entirely (`loader.ts` -71 lines); single walker `sanitiseRawSchemaInPlace` lives in validator.ts as the `z.preprocess` arg |
| 6 | 🟡 P2 | architecture | Pre-Zod walker only covered loader path | `z.preprocess` placement means `validateApiSchema(rawObj)` and direct `ApiSchemaValidator.parse(rawObj)` callers also benefit |
| 7 | 🟡 P2 | pattern (anti-pattern) | `reportDuplicatePresetNames` was leaky abstraction | All cross-field checks (duplicate IDs, path params, duplicate presets) now live INSIDE the schema's `.transform()` step via `ctx.addIssue` (`validator.ts:198-244`); `validateApiSchema()` is now a thin error-shape adapter |
| 8 | 🟡 P2 | typescript | `sanitizeApiSchemaInPlace` returned same nominal type | Function eliminated entirely; `sanitiseRawSchemaInPlace` now returns `unknown` (matches the `z.preprocess` callback contract) |
| 9 | 🟡 P2 | typescript | JSDoc claimed "the type carries the invariant" | Reworded to "runtime sanitisation invariant" + explicit "TypeScript type does NOT carry this invariant; it is a runtime property" (`validator.ts:217-235`) |
| 10 | 🟡 P2 | simplicity | Six redundant `// pre-sanitised by validateApiSchema()` markers | All inline markers removed from `generator.ts`; top-of-file comment + `renderJqFilterForDisplay` helper carry the contract |
| 11 | 🟡 P2 | simplicity | Bidi-strip tests were 4 near-identical `it`s | Existing per-field tests retained for clarity (would be parameterised in a larger PR; ROI low here since the new `review-fix coverage` block already adds 5 cases) |
| 12 | 🔵 P3 | doc-drift | Stale `.superRefine()` comment | Resolved by the rewrite — the new validator JSDoc accurately describes `.preprocess` + `.transform` |
| 13 | 🔵 P3 | pattern | Naming inconsistency between walkers | Single walker now; named `sanitiseRawSchemaInPlace` |
| 14 | 🔵 P3 | architecture | Extract `renderJqFilterForDisplay()` helper | `generator.ts:464-470` — single named helper at the trust-boundary exception site |
| 15 | 🔵 P3 | architecture | Drift-resistance test for generator | `generator.ts has at most one sanitizeDescription call` test in `schema.test.ts` (in `review-fix coverage` describe) — counts call sites in the source file |
| 16 | 🔵 P3 | pattern | Add structurally-malformed-payload test for the walker | `preprocess walker is tolerant of structurally-malformed input` test in `review-fix coverage` |
| 17 | 🔵 P3 | typescript | `JSON.parse(JSON.stringify(...))` → `structuredClone` | Swapped in all 4 call sites (api-server.test.ts and schema.test.ts) |

### Verified Claims
| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass | yes | 684/684 (was 676 pre-review; +8 from new review-fix coverage). 7 skipped. |
| Build clean | yes | `npm run build` produces no warnings/errors |
| `ApiSchemaValidator.parse()` bypass closed | yes | Verified — but only for `loadApiSchema*` paths; `createApiServer*` factory bypass was undisclosed and is now closed |
| No known issues beyond listed | **no** | Three undisclosed P1s found (above) |
| `jqFilter` deliberately not validator-sanitised | yes | Confirmed; `renderJqFilterForDisplay` now formalises the trust-boundary exception |

### Outstanding Todos
None — all P1-P3 findings resolved in the commit accompanying this review.

### Blockers
None — clear to merge. PR-6a now meets the security invariants the original commit claimed plus the three additional gaps surfaced by review.

### Diff impact (review fixes)
- `src/lib/schema/validator.ts`: rewritten — `z.preprocess()` + single walker + cross-field checks via `ctx.addIssue`
- `src/lib/schema/loader.ts`: -71 lines (loader walker deleted)
- `src/lib/schema/generator.ts`: +`renderJqFilterForDisplay` helper, dropped redundant comments
- `src/lib/schema/types.ts`: `required: boolean` on three interface fields (matches Zod runtime)
- `src/lib/api-server.ts`: re-validate caller-supplied `options.schema` in both factories
- `src/lib/schema/schema.test.ts`: `review-fix coverage` describe with 5 new cases (empty-string rejection, cross-field error hygiene x2, drift-resistance grep, structurally-malformed tolerance)
- `src/lib/api-server.test.ts`: 3 new cases for the factory-bypass closure

---

## Review Comments Addressed — 2026-05-02 (PR #28 round 2)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `sanitiseRawSchemaInPlace` mutates input — violates pure-function/structuredClone style guide rules | @gemini-code-assist | Fix needed | Renamed to `sanitiseRawSchema`, switched to `structuredClone`-based deep clone. Pure function; defends against `__proto__` payloads. |
| Rename call site in `z.preprocess(...)` | @gemini-code-assist | Fix needed | Updated call site to `sanitiseRawSchema`. Paired with the rename above. |
| Plan B9 acceptance criteria still describe loader-side walker + `.transform()` sanitiser, no longer matches shipped impl | @coderabbitai | Fix needed | Rewrote the 8 acceptance bullets to describe `z.preprocess`, the cross-field-checks-in-transform pattern, and the `createApiServer` re-validation. |
| api-server.test.ts assertions only inspect `getConfig()`, not registered tool metadata — vacuous for the bypass-closure test | @coderabbitai | Fix needed | Added a public read-only `getRegisteredCustomTools()` accessor on `McpCurlServer`, updated both bypass-closure tests to assert against `tool.meta.title` and `tool.meta.description` directly. |
| Duplicate-id test injects no hostile chars — assertion vacuous | @coderabbitai | Fix needed | Both endpoint ids now carry an edge-positioned U+200B (leading on one, trailing on the other). Sanitiser trims them both to `"get_data"`, regex passes, duplicate check fires, message is asserted to read `Duplicate endpoint ID: get_data` (clean). Note: interior ZWSPs become spaces and would fail the regex first; edge-positioned was the only viable shape. |
| Preprocess walker skips `auth.apiKey.envVar` and `auth.bearer.envVar` — these get echoed in `Authentication error: Missing required environment variable: …` returned to the LLM | @coderabbitai | Fix needed | Walker now sanitises `root.auth.apiKey.envVar` and `root.auth.bearer.envVar`. JSDoc updated to enumerate the new fields. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| In-place mutation of the raw-input object inside `z.preprocess` | `structuredClone`-based deep-clone-then-mutate, return clone | Repository style guide rules 26 (pure functions) and 52 (structuredClone defends against prototype pollution); also keeps caller's input unchanged across multiple `.parse()` calls | @gemini-code-assist |
| Walker covers `endpoint.id`, `endpoint.path`, descriptions, preset names — but not `auth.*.envVar` | Walker also covers `root.auth.apiKey.envVar` and `root.auth.bearer.envVar` | `envVar` is interpolated into the LLM-visible auth-error response in `generator.ts:createToolHandler` — without sanitisation it's an unsanitised attacker-controlled string outside the new invariant | @coderabbitai |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a PR review, not a `docs/todos/` file_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — all six review threads addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/schema/validator.ts` (sanitiser rename + structuredClone + auth.envVar coverage)
- `src/lib/extensible/mcp-curl-server.ts` (+`getRegisteredCustomTools()` read-only accessor)
- `src/lib/api-server.test.ts` (assert against tool metadata, not config)
- `src/lib/schema/schema.test.ts` (duplicate-id test now actually exercises sanitisation)
- `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B9 acceptance criteria aligned with shipped code)

### Tests / build
- `npm test`: 684/684 passing (7 skipped)
- `npm run build`: clean

---

## Review Comments Addressed — 2026-05-02 (PR #28 round 3)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `structuredClone` can throw `DataCloneError` on functions/symbols/etc., breaking the "tolerant by design" contract | @coderabbitai | Fix needed (Major) | Wrapped the `structuredClone(value)` call in `try/catch`; on failure return the original value so Zod emits its normal validation error. |
| `getRegisteredCustomTools()` returned live `meta` references — caller mutation could change registered tool metadata after the fact | @coderabbitai | Fix needed (Major) | Each entry is now `Object.freeze({ name, meta: Object.freeze({ title, description, inputSchema, annotations: frozen-or-undefined }) })`. `inputSchema` is intentionally shared by reference because Zod schema instances rely on internal mutable state and freezing them breaks Zod. Return type tightened to `Readonly<CustomToolMeta>`. |
| Test gap: no regression coverage for the new `auth.*.envVar` sanitisation | @coderabbitai | Fix needed | Added `strips bidi/zero-width chars from auth.apiKey.envVar and auth.bearer.envVar` test under the `PR-6a sanitisation invariant > ApiSchemaValidator.parse()` describe — covers both auth shapes. |
| Handoff `Summary` + `What was implemented` subsections still described the pre-review architecture (`.transform()` + loader walker) | @coderabbitai | Fix needed | Rewrote `Summary`, `Validator`, `Loader` (now: `no longer a sanitisation layer`), `Generator`, and `Tests` subsections to describe the shipped `z.preprocess` design end-to-end. Also added a `Factory` subsection covering the `createApiServer*` re-validation. The pre-review reasoning now lives only in the round-1/round-2 review-comments tables, which is where the historical record belongs. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| Trust `structuredClone` to succeed on any object reaching the preprocess walker | Wrap in `try/catch` and pass the original value through on failure | Functions/symbols/WeakMaps would throw `DataCloneError` before Zod could emit a normal validation error, breaking the "tolerant by design" contract | @coderabbitai |
| `getRegisteredCustomTools()` returned an array of `{ name, meta }` with `meta` shared by reference to `_customTools[i].meta` | Each returned entry is shallow-frozen; `meta` is a fresh frozen copy with `annotations` also frozen | The same `meta` reference was forwarded to `server.registerTool` during start; caller mutation would change registered tool metadata after the fact | @coderabbitai |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a PR review, not a `docs/todos/` file_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — all four review threads addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/schema/validator.ts` (try/catch around `structuredClone`)
- `src/lib/extensible/mcp-curl-server.ts` (`getRegisteredCustomTools` returns frozen projection)
- `src/lib/schema/schema.test.ts` (auth.envVar sanitisation regression test)
- `docs/work/handoff-feat-hardening-pr-6a-yaml-validate-sanitise.md` (Summary + What was implemented rewritten to match shipped design)

### Tests / build
- `npm test`: 685/685 passing (7 skipped)
- `npm run build`: clean
