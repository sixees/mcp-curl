# Work Handoff: PR-1 — URL helper hardening + public-barrel symmetry

**Date:** 2026-05-01 | **Branch:** `feat/hardening-pr-1-url-helpers` | **Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` | **Status:** complete

## Summary

PR-1 of the 9-PR pre-bigwork hardening track. Closes 5 items (A1, A2, A3, A4, B6) covering the URL-validation helper and public-API symmetry. Replaces the string-split scheme check in `httpOnlyUrl()` with a WHATWG-parser-based check; consolidates two inline copies to call the helper; adds `httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, and `detectInjectionPattern` to the package public exports; locks `data:` URL rejection at the prompt-schema layer with regression tests. Also lands the consolidating plan and removes the now-superseded `docs/todos/*` and `docs/upstream-contributions.md`.

## What was implemented

### A1 — `httpOnlyUrl()` parser-based scheme guard
- **What:** replaced `.split(":")[0].toLowerCase()` with `new URL(url).protocol`-based check, wrapped in a try/catch so malformed inputs reject rather than throw.
- **Key files:** `src/lib/utils/url.ts` (helper), `src/lib/utils/url.test.ts` (12 new test cases under `describe("httpOnlyUrl")`).
- **Approach:** matches how `src/lib/security/ssrf.ts` and Node `fetch` parse URLs — schema-layer guard now agrees with the network-layer guard.

### A2 — consume `httpOnlyUrl()` in built-in schemas
- **What:** removed two inline `.refine()` scheme checks; both now call the shared helper.
- **Key files:** `src/lib/schema/validator.ts:90-93` (was `apiInfoSchema.baseUrl`), `src/lib/server/schemas.ts:11-19` (was `CurlExecuteSchema.url`).
- **Approach:** single source of truth; removes a regression vector where helper hardening doesn't flow to inline copies.

### A3 + B6 — public-barrel exports
- **What:** added 4 helpers to `src/lib.ts` exports — `httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`. Also updated `docs/custom-tools.md` with two new subsections.
- **Key files:** `src/lib.ts` (exports), `docs/custom-tools.md` ("Validating URL parameters" + "Replicating the response-side defence" subsections under `## Sanitizing External Tool Metadata`).
- **Approach:** purely additive; verified all four exports landed in `dist/lib.d.ts` after build.

### A4 — `data:` URL prompt-schema regression tests
- **What:** added one test per prompt to assert `data:text/plain;base64,SGVsbG8=` rejects.
- **Key files:** `src/lib/prompts/api-discovery.test.ts`, `src/lib/prompts/api-test.test.ts`.
- **Approach:** both prompt schemas already use `httpOnlyUrl()`, so A1's hardening flows through automatically. Per-consumer regression test locks the boundary in case the helper changes.

### Source-file consolidation (separate commit, preceding the implementation)
- **What:** deleted 9 `docs/todos/*.md` files plus `docs/upstream-contributions.md`. Added `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` as the new single source of truth.
- **Why:** the plan consolidates the 13 actionable items those source files described. Plan WBS item 15 originally specified deletion as the final cleanup commit, but the working tree had them pre-deleted at session start; we committed the deletion at the start of the branch instead. Plan's Enhancement Summary documents this is the agreed cadence.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|-------------------------|
| WHATWG parser over regex | Matches SSRF layer's URL parsing; rejects `:::foo`, `https::` that the split-form silently allowed. | Stricter regex (`/^https?:\/\//i`) — rejected: doesn't catch parser-vs-string-split disagreement on edge cases like IPv6 `https://[::1]/`. |
| Consolidate deletes in first branch commit | Working tree had pre-deletes; committing at branch tip is cleaner than restoring then re-deleting at the end. | Restore + delete at end of all 9 PRs (strict WBS item 15 reading) — rejected: noisy working tree across all 9 PRs. |
| Logical commit per item (A1, A2, A3+B6, A4) | Easier to revert pieces; squash-merge will fold them. | Single PR commit — rejected: harder to bisect if one item regresses later. |
| Comments preserved in `url.test.ts` referencing the old `.split(":")[0]` form | They explain why the regression tests exist. Removing them would lose the reasoning. | Strip comments — rejected: future contributor reads the test, sees `httpx://` rejection, has no idea why we explicitly tested it. |

## What to pay attention to during review

- **Risk areas:**
  - `httpOnlyUrl()` is now wrapped in `try { … } catch { return false }`. The catch is silent — any `new URL()` throw rejects the input. This is intentional (we don't want to leak parser errors back to the caller), but if a future caller wants to distinguish "malformed URL" from "wrong scheme", they'll need a different helper.
  - The IPv6 test case (`https://[::1]/`) deserves a second look. The previous `.split(":")[0]` form silently parsed scheme as `"https"` and host as `"["` — passed by accident. The parser-based form correctly returns `"https:"`. The test asserts the new behaviour but the old behaviour wasn't tested at all, so this is genuinely a behaviour change for any consumer that was passing IPv6 URLs.
- **Edge cases considered:**
  - `httpx:` (look-alike scheme) — both old and new forms reject; locked with explicit test.
  - `https::` (double-colon) — old form passed (split gave `"https"`); new form rejects via parser. Behaviour change locked with test.
  - `""` (empty string) — `z.url()` rejects before `.refine()` runs; behaviour unchanged.
- **Under-tested:**
  - No integration test confirming a `data:` or `javascript:` URL passed to a YAML schema endpoint actually hits the validator and rejects (only unit-level coverage). Plan A2 mentions this should exist; deferring to a future PR since the unit tests cover the helper invariant and consumer schemas use it.
  - No test of what happens if `URL` global is shadowed in a consuming codebase. Realistic? Probably not; flagging anyway.
- **Pattern deviations:** none. The PR follows existing helper-consolidation patterns in the codebase (compare `src/lib/utils/error.ts:createConfigError` reuse).

## Known issues and limitations

- **Comments in `url.test.ts` reference `.split(":")[0]`.** These are intentional regression-context markers. Grep for the pattern in `src/` confirms only test-file comments remain (verified via `Grep`). If a future cleanup pass removes them, the test names still convey the intent.
- **The plan contains a "Technical Review Corrections" section that is authoritative on conflicts.** This PR-1 work follows the original plan's A1-A4 + B6 sections faithfully — none of the 36 technical-review findings target PR-1 directly. Future PRs (PR-5 / B4, PR-6 / B3+B9) **must** read the corrections section before implementation.
- **No security-sentinel reviewer agent run on the implementation.** The review was on the plan, not the code. If desired, run `Task feature-dev:code-reviewer` against the diff before merging.

## Testing summary

- Tests added: 14 (12 new `httpOnlyUrl` cases in `url.test.ts`, 1 `data:` rejection in each of two prompt test files).
- Tests passing: **499 passed | 7 skipped | 0 failed** (full vitest suite, `npm test`).
- Linting: pass (`npm run build` succeeds with no TypeScript errors; project doesn't expose a separate lint target).
- Manual testing: verified `dist/lib.d.ts` after `npm run build` lists all 4 new exports (`httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`).
- Test gaps:
  - No end-to-end test of a YAML schema endpoint rejecting a `data:` URL through the full HTTP transport. Unit coverage is sufficient given consumer schemas all delegate to `httpOnlyUrl`.
  - No timing benchmark of the parser-based check vs the split-based check. The check runs once per `.parse()`; impact is negligible. Plan PR-9 will baseline overall pipeline perf — this helper's overhead is below that noise floor.

## Commit history

```
git log --oneline main..HEAD
697be5d test(prompts): add data: URL rejection regression tests
af06996 feat(api): re-export httpOnlyUrl + spotlighting helpers from public barrel
8749572 refactor: consume httpOnlyUrl() helper in built-in schemas
a7ee43e fix(security): harden httpOnlyUrl() with WHATWG URL parser
570f6a5 chore: consolidate todos + upstream-contributions into hardening plan
```

## Review context

- **Suggested review order:** read commits bottom-up (570f6a5 → 697be5d). The first commit is just deletes + plan addition; commits 2–5 implement A1–B6 in dependency order.
- **Related docs:**
  - `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` — full plan, sections "A1 — Harden `httpOnlyUrl()`" through "B6 — Re-export spotlighting helpers".
  - `docs/custom-tools.md` — updated with two new subsections under "Sanitizing External Tool Metadata".
- **Dependencies on other work:** none. PR-1 unblocks PR-2 through PR-9 but has no dependencies of its own.

## Follow-up work

- [ ] PR-2: jq-query unit tests (B1) — next plan item, can start immediately.
- [ ] PR-3: README example for sanitizing field descriptions (B2).
- [ ] PR-4: `authToken` printable-ASCII validation (B5).
- [ ] PR-5: Auto-sanitize Zod field descriptions on `registerCustomTool()` (B4) — read Technical Review Corrections C3 + A7 + S3 first; rebuild needs nested recursion + Standard-Schema test.
- [ ] PR-6a/PR-6b: B9 + B3 — read Technical Review Corrections S1 (`ApiSchemaValidator.parse()` bypass) and A1+A2+A3+A6+S2+S4 (B3 layer placement, idempotence symbol, hook-executor short-circuit) **before** implementation.
- [ ] PR-7: Response-side sanitization expansion (B7-sub-1-3 + B8) — read Technical Review Corrections S5+S6+S7+S9.
- [ ] PR-8: Detection-pattern expansion (B7-sub-4-5) — blocked on `unicode-confusables` integration per S8 + C11.
- [ ] PR-9: CI perf budgets — measure baseline first, no thresholds before measurement (C1, A9).

### Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none created this session_ | | | |

### Resolved Todos

This session deleted the entire `docs/todos/` directory because its content has been consolidated into the plan. The deletions are recorded in commit `570f6a5`. The 9 deleted todo files are NOT marked "resolved by this PR" — only the items A1, A2, A3, A4, B6 (which map to entries in the deleted `public-api-spotlighting-symmetry.md`) were closed by the PR-1 implementation. The remaining 8 todos are still pending (PR-2 through PR-9).

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| `docs/todos/public-api-spotlighting-symmetry.md` | Public API spotlighting helpers | Re-export `applySpotlighting`/`sanitizeResponse`/`detectInjectionPattern`/`httpOnlyUrl` from `src/lib.ts`; add docs example | PR-1 / commit `af06996` | 2026-05-01 |
| `docs/todos/auth-token-sanitize-consideration.md` | (still pending — scoped to PR-4) | Add `authToken` validation | PR-4 (not yet implemented) | _pending_ |
| `docs/todos/injection-defense-html-tag-stripping.md` | (still pending — scoped to PR-7) | Strip `<script>`/`<style>` blocks | PR-7 (not yet implemented) | _pending_ |
| `docs/todos/injection-defense-threat-model-expansion.md` | (still pending — scoped to PR-7+PR-8) | Expand whitespace/Unicode coverage; widen detection | PR-7 + PR-8 (not yet implemented) | _pending_ |
| `docs/todos/jq-query-unit-tests.md` | (still pending — scoped to PR-2) | Add `executeJqQuery` unit tests | PR-2 (not yet implemented) | _pending_ |
| `docs/todos/readme-register-custom-tool-sanitize-example.md` | (still pending — scoped to PR-3) | Add README sanitization example | PR-3 (not yet implemented) | _pending_ |
| `docs/todos/sanitize-custom-tool-zod-descriptions.md` | (still pending — scoped to PR-5) | Auto-sanitize Zod field descriptions | PR-5 (not yet implemented) | _pending_ |
| `docs/todos/sanitize-yaml-schema-at-load.md` | (still pending — scoped to PR-6a) | Sanitize YAML schema at validate time | PR-6a (not yet implemented) | _pending_ |
| `docs/todos/spotlighting-yaml-driven-tools.md` | (still pending — scoped to PR-6b) | Defence-in-depth parity for YAML/custom-tool output | PR-6b (not yet implemented) | _pending_ |

The deletion is intentional: from this point forward the plan is the single source of truth for the remaining items. If any of the future PRs is reassessed and wants to revive a todo, the content can be reconstructed from the plan's matching section.
