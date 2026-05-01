# Work Handoff: PR-1 — URL helper hardening + public-barrel symmetry

**Date:** 2026-05-01 | **Branch:** `feat/hardening-pr-1-url-helpers` | **Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` | **Status:** complete

## Summary

PR-1 of the 9-PR pre-bigwork hardening track. Closes 5 items (A1, A2, A3, A4, B6) covering the URL-validation helper and public-API symmetry. Replaces the string-split scheme check in `httpOnlyUrl()` with a WHATWG-parser-based check; consolidates two inline copies to call the helper; adds `httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, and `detectInjectionPattern` to the package public exports; locks `data:` URL rejection at the prompt-schema layer with regression tests. Also lands the consolidating plan and removes the now-superseded `docs/todos/*` and `docs/upstream-contributions.md`.

## What was implemented

> **Naming note:** at the time of PR-1's initial implementation the helper was exported as `httpOnlyUrl`. It was renamed to `createHttpOnlyUrlSchema` during the P3 review pass (see _Code Review — 2026-05-01 → P3 sweep, finding #021_). The headings, file-path references, and approach descriptions below remain in the original form for historical fidelity; the **shipped public API name is `createHttpOnlyUrlSchema`**.

### A1 — `httpOnlyUrl()` parser-based scheme guard

- **What:** replaced `.split(":")[0].toLowerCase()` with `new URL(url).protocol`-based check, wrapped in a try/catch so malformed inputs reject rather than throw.
- **Key files:** `src/lib/utils/url.ts` (helper), `src/lib/utils/url.test.ts` (12 new test cases — under `describe("createHttpOnlyUrlSchema")` after the rename).
- **Approach:** matches how `src/lib/security/ssrf.ts` and Node `fetch` parse URLs — schema-layer guard now agrees with the network-layer guard.

### A2 — consume `httpOnlyUrl()` in built-in schemas

- **What:** removed two inline `.refine()` scheme checks; both now call the shared helper.
- **Key files:** `src/lib/schema/validator.ts:90-93` (was `apiInfoSchema.baseUrl`), `src/lib/server/schemas.ts:11-19` (was `CurlExecuteSchema.url`).
- **Approach:** single source of truth; removes a regression vector where helper hardening doesn't flow to inline copies.

### A3 + B6 — public-barrel exports

- **What:** added 4 helpers to `src/lib.ts` exports — `httpOnlyUrl` (later renamed to `createHttpOnlyUrlSchema`), `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`. Also updated `docs/custom-tools.md` with two new subsections.
- **Key files:** `src/lib.ts` (exports), `docs/custom-tools.md` ("Validating URL parameters" + "Replicating the response-side defence" subsections under `## Sanitizing External Tool Metadata`).
- **Approach:** purely additive; verified all four exports landed in `dist/lib.d.ts` after build.

### A4 — `data:` URL prompt-schema regression tests

- **What:** added one test per prompt to assert `data:text/plain;base64,SGVsbG8=` rejects.
- **Key files:** `src/lib/prompts/api-discovery.test.ts`, `src/lib/prompts/api-test.test.ts`.
- **Approach:** both prompt schemas already use the helper (now `createHttpOnlyUrlSchema`), so A1's hardening flows through automatically. Per-consumer regression test locks the boundary in case the helper changes.

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
  - No integration test confirming a `data:` or `javascript:` URL passed to a YAML schema endpoint actually hits the validator and rejects (only unit-level coverage). The plan's section A2 mentions this should exist; deferring to a future PR since the unit tests cover the helper invariant and consumer schemas use it.
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
  - No timing benchmark of the parser-based check vs the split-based check. The check runs once per `.parse()`; impact is negligible. PR-9 will baseline overall pipeline perf — this helper's overhead is below that noise floor.

## Commit history

```bash
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

See **Code Review — 2026-05-01 → Outstanding Todos** below for the 20 todo files created during the post-implementation review.

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

## Code Review — 2026-05-01

### Review Summary

- **Reviewer:** automated multi-agent review (focus: SRP/DRY, security, TypeScript MCP best practices)
- **Agents used:** code-simplicity-reviewer, architecture-strategist, security-sentinel, typescript-reviewer, plus learnings-researcher and agent-native-reviewer cross-checks
- **Findings:** 🔴 P1: 0 | 🟡 P2: 11 | 🔵 P3: 9
- **Verdict:** clear to merge after P2 fixes — no merge-blocker issues; PR-1 substantively delivers A1+A2+A3+A4+B6 as planned.

### Handoff Assessment

The builder's self-assessment is **honest and substantively complete**. The handoff proactively flagged:

- The IPv6 `https://[::1]/` behaviour change (correctly identified as a genuine semantic shift, not just a fix).
- The `try/catch` swallowing parser errors (called out as intentional but a friction point for callers wanting to distinguish "malformed" from "wrong scheme").
- The integration-test gap for the YAML pipeline (acknowledged in "Test gaps").
- The plan's "Technical Review Corrections" section as a forward hazard for PR-5 / PR-6a / PR-6b.

**Significant undisclosed items found by review** — none of them merge-blockers, all P2 or P3:

- The implicit return type of `httpOnlyUrl()` exposes Zod-internal generics across the public barrel, which is fragile under Zod version bumps (T1+A7+T8 → todo #001).
- `applySpotlighting()` is not idempotent and accepts any non-empty string as `requestId`, including human-typed values that won't be unique-per-request (T6+S4 → todo #002).
- `detectInjectionPattern` returns `true` for benign content under normal usage and is named `detect…` in a way that invites misuse as a gating predicate (S3 → todo #003).
- An IPv4-mapped IPv6 SSRF gap exists in `config/security/ssrf.ts`: compressed-hex variants of `::ffff:127.x` / `::ffff:10.x` / `::ffff:192.168.x` are not in the blocklist (S1 → todo #005). The defence-in-depth in `ssrf.ts` still rejects these via DNS resolution, but the blocklist regex is the documented gate.
- The schema-level `description` for `CurlExecuteSchema.url` does not mention the `http`/`https` constraint (validator.ts does), so the LLM gets inconsistent guidance across consumer schemas (T5 → todo #006).

The builder's instinct to flag the integration-test gap proactively is exactly the behaviour we want — tracked as todo #020 for PR-6a's gate.

### Key Findings

| ID | Severity | Category | Description | Todo File |
|----|----------|----------|-------------|-----------|
| 1 | 🟡 P2 | typescript / api-stability | Pin `httpOnlyUrl()` return type to `z.ZodType<string>` to stop Zod-internal generics leaking across the public barrel | `docs/todos/001-pending-p2-pin-httponlyurl-return-type.md` |
| 2 | 🟡 P2 | security / correctness | `applySpotlighting()` is not idempotent and does not validate UUID-shape `requestId` — double-wrap and predictable-sentinel risk | `docs/todos/002-pending-p2-applyspotlighting-idempotence-and-requestid.md` |
| 3 | 🟡 P2 | security / api-design | `detectInjectionPattern` invites misuse as a gating predicate; tighten JSDoc + add usage warning | `docs/todos/003-pending-p2-detectinjectionpattern-misuse-prevention.md` |
| 4 | 🟡 P2 | security / tests | Add explicit regression tests for `vbscript:`, leading-whitespace, and case-permutation scheme bypasses through `httpOnlyUrl()` | `docs/todos/004-pending-p2-vbscript-and-whatwg-quirk-regression-tests.md` |
| 5 | 🟡 P2 | security | IPv4-mapped IPv6 compressed-hex variants missing from `config/security/ssrf.ts` blocklist regexes | `docs/todos/005-pending-p2-ipv4-mapped-ipv6-ssrf-blocklist-gap.md` |
| 6 | 🟡 P2 | mcp / llm-visible | `CurlExecuteSchema.url` description doesn't mention http/https constraint — inconsistent with validator.ts | `docs/todos/006-pending-p2-llm-visible-scheme-constraint.md` |
| 7 | 🟡 P2 | dry / architecture | Share scheme allowlist via `config/security/url-schemes.ts` constant (currently duplicated across `httpOnlyUrl`, `ssrf.ts`, curl `--proto` flag) | `docs/todos/007-pending-p2-share-scheme-allowlist-config.md` |
| 8 | 🟡 P2 | docs / architecture | `docs/custom-tools.md` — three new H3s under one H2 break heading taxonomy; restructure before PR-5/PR-7 lands more sections | `docs/todos/008-pending-p2-restructure-custom-tools-doc-headings.md` |
| 9 | 🟡 P2 | dx / api-design | `httpOnlyUrl()` should accept optional `description` + ship JSDoc explaining the http/https scheme lock | `docs/todos/009-pending-p2-httponlyurl-description-default-and-jsdoc.md` |
| 10 | 🟡 P2 | dry / tests | Two prompt regression tests are textual duplicates — collapse with `it.each` | `docs/todos/010-pending-p2-collapse-duplicate-prompt-regression-tests.md` |
| 11 | 🟡 P2 | architecture | Decide before PR-6b: barrel categorization + whether to ship a `wrapWithDefence(handler)` convenience wrapper | `docs/todos/011-pending-p2-public-barrel-categorization-and-wrapwithdefence-decision.md` |
| 12 | 🔵 P3 | api-symmetry | `safeHostname` is in `utils/index.ts` but not in the public barrel; ship for parity | `docs/todos/012-pending-p3-safehostname-public-barrel.md` |
| 13 | 🔵 P3 | docs | JSDoc on defence helpers should distinguish invariant guarantees from format stability | `docs/todos/013-pending-p3-unstable-jsdoc-on-defence-helpers.md` |
| 14 | 🔵 P3 | tests / docs | Reword `url.test.ts` comments referencing `.split(":")[0]` so they don't time-bomb when context fades | `docs/todos/014-pending-p3-reword-time-bombed-test-comments.md` |
| 15 | 🔵 P3 | docs | Add JSDoc `@param` / `@returns` to `httpOnlyUrl()` | `docs/todos/015-pending-p3-httponlyurl-jsdoc-param-returns.md` |
| 16 | 🔵 P3 | tests / forward-compat | JSON Schema snapshot test for `CurlExecuteSchema.url` to flag MCP-SDK 2.0 converter changes | `docs/todos/016-pending-p3-json-schema-snapshot-test.md` |
| 17 | 🔵 P3 | ux / error-messages | Restore `z.url("Must be a valid URL")` base message lost in helper consolidation | `docs/todos/017-pending-p3-restore-zod-url-error-message.md` |
| 18 | 🔵 P3 | process / plan-hygiene | Fold "Technical Review Corrections" back into plan body before PR-6b begins | `docs/todos/018-pending-p3-fold-tech-review-corrections-into-plan-body.md` |
| 19 | 🔵 P3 | tests / consistency | Apply nested-describe convention consistently across `url.test.ts` | `docs/todos/019-pending-p3-url-test-structure-consistency.md` |
| 20 | 🔵 P3 | tests / integration | Integration test: `data:` / `javascript:` URL rejected through full YAML pipeline (PR-6a gate) | `docs/todos/020-pending-p3-yaml-pipeline-data-url-integration-test.md` |

### Verified Claims

| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (499 / 7 skipped / 0 failed) | yes | Re-ran `npm test` — same counts. |
| Build clean, no TS errors | yes | `npm run build` succeeds. |
| All 4 helpers exported from `dist/lib.d.ts` | yes | Verified via `import('./dist/lib.js')` — `httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern` all present. |
| `httpOnlyUrl` is now the single source of truth | yes | `Grep` confirms only one production `z.url()` site after migration; both former inline copies now call the helper. |
| IPv6 `https://[::1]/` behaviour change | yes | Old form silently passed; new form correctly returns `https:`. Test locks the new behaviour. |
| `try/catch` swallows parser errors | yes | Intentional. Documented in handoff — flagged as P2 follow-up via todo #009 (JSDoc) so future callers know. |
| Defence-in-depth holds if helper bypassed | yes (with one caveat) | `ssrf.ts:86-88` has its own scheme allowlist and `--proto =http,https` is the third gate. **Caveat:** the IPv4-mapped IPv6 compressed-hex blocklist gap (todo #005) is the one place where the layers genuinely disagree. |
| Public-barrel re-exports work | yes | Verified `import { httpOnlyUrl } from "mcp-curl"` resolves to the same function as `from "mcp-curl/utils"`. |
| No known issues beyond listed | partial | Builder surfaced the right risks at the right level. The 5 undisclosed P2 items above (T1, T6+S4, S3, S1, T5) are real gaps the builder didn't surface — all flagged in todos. |
| Comments in `url.test.ts` reference `.split(":")[0]` | yes | Confirmed; reworded under todo #014 (P3) to avoid time-bomb. |

### Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| `docs/todos/001-pending-p2-pin-httponlyurl-return-type.md` | P2 | Pin `httpOnlyUrl()` return type | code-review |
| `docs/todos/002-pending-p2-applyspotlighting-idempotence-and-requestid.md` | P2 | `applySpotlighting` idempotence + UUID-shape `requestId` | code-review |
| `docs/todos/003-pending-p2-detectinjectionpattern-misuse-prevention.md` | P2 | Misuse-prevention JSDoc on `detectInjectionPattern` | code-review |
| `docs/todos/004-pending-p2-vbscript-and-whatwg-quirk-regression-tests.md` | P2 | `vbscript:` / whitespace / case regression tests | code-review |
| `docs/todos/005-pending-p2-ipv4-mapped-ipv6-ssrf-blocklist-gap.md` | P2 | SSRF blocklist: IPv4-mapped IPv6 compressed-hex gap | code-review |
| `docs/todos/006-pending-p2-llm-visible-scheme-constraint.md` | P2 | LLM-visible scheme constraint in `CurlExecuteSchema.url` | code-review |
| `docs/todos/007-pending-p2-share-scheme-allowlist-config.md` | P2 | Share scheme allowlist via `config/security/url-schemes.ts` | code-review |
| `docs/todos/008-pending-p2-restructure-custom-tools-doc-headings.md` | P2 | Restructure `docs/custom-tools.md` heading taxonomy | code-review |
| `docs/todos/009-pending-p2-httponlyurl-description-default-and-jsdoc.md` | P2 | `httpOnlyUrl()` optional description + scheme-lock JSDoc | code-review |
| `docs/todos/010-pending-p2-collapse-duplicate-prompt-regression-tests.md` | P2 | Collapse duplicate prompt regression tests | code-review |
| `docs/todos/011-pending-p2-public-barrel-categorization-and-wrapwithdefence-decision.md` | P2 | Barrel categorization + `wrapWithDefence` decision | code-review |
| `docs/todos/012-pending-p3-safehostname-public-barrel.md` | P3 | Add `safeHostname` to public barrel | code-review |
| `docs/todos/013-pending-p3-unstable-jsdoc-on-defence-helpers.md` | P3 | JSDoc: distinguish invariant from format stability | code-review |
| `docs/todos/014-pending-p3-reword-time-bombed-test-comments.md` | P3 | Reword time-bombed `url.test.ts` comments | code-review |
| `docs/todos/015-pending-p3-httponlyurl-jsdoc-param-returns.md` | P3 | JSDoc `@param`/`@returns` on `httpOnlyUrl` | code-review |
| `docs/todos/016-pending-p3-json-schema-snapshot-test.md` | P3 | JSON Schema snapshot for `CurlExecuteSchema.url` | code-review |
| `docs/todos/017-pending-p3-restore-zod-url-error-message.md` | P3 | Restore `z.url("Must be a valid URL")` base message | code-review |
| `docs/todos/018-pending-p3-fold-tech-review-corrections-into-plan-body.md` | P3 | Fold tech-review corrections into plan body before PR-6b | code-review |
| `docs/todos/019-pending-p3-url-test-structure-consistency.md` | P3 | Apply nested-describe convention consistently in `url.test.ts` | code-review |
| `docs/todos/020-pending-p3-yaml-pipeline-data-url-integration-test.md` | P3 | Integration test for YAML pipeline `data:` URL rejection | code-review |

### Blockers

**None.** No P1 findings; clear to merge after P2 fixes (which can be addressed across PR-2…PR-6 as they touch adjacent code, rather than blocking PR-1's merge). The 5 undisclosed P2 items the builder didn't surface (T1, T6+S4, S3, S1, T5) are genuine gaps but none represent a regression introduced by PR-1 — they are pre-existing-or-now-visible issues in helpers PR-1 promoted to public API. Address them in upcoming PRs that touch the same modules.

## Code Review Pass 2 — 2026-05-01

### Pass 2 Summary

- **Reviewer:** automated multi-agent second pass — meta-review of pass 1 plus angles pass 1 didn't deeply cover (performance, pattern-recognition).
- **Agents used:** performance-oracle, pattern-recognition-specialist, plus a meta-review general-purpose pass auditing the 20 prior todos.
- **New findings:** 🔴 P1: 0 | 🟡 P2: 2 | 🔵 P3: 1 (3 new todos #021, #022, #023). Plus 2 calibration edits to existing todos (#007 extended, #004 dependency added).
- **Verdict unchanged from pass 1:** clear to merge after P2 fixes. No new merge-blockers.

### Pass 2 Independent Verifications

| Claim | Verified? | Notes |
|-------|-----------|-------|
| Triple-layer scheme defense (`httpOnlyUrl` + `ssrf.ts` + `--proto`) actually wired | yes | `src/lib/execution/curl-args-builder.ts:74,110` confirmed; `ssrf.ts:86-88` confirmed; `url.ts:30` confirmed. |
| `httpOnlyUrl` is the only `z.url()` call site in production code | yes | `Grep` confirms one production hit at `url.ts:27`. |
| Performance impact of WHATWG parser is negligible | yes (independent) | Performance oracle: refine fires once per `.parse()`; the call is module-init for schema construction, then once per HTTP-tool invocation (which spawns a subprocess taking 10–1000+ ms). Parser overhead is six orders of magnitude below dominant cost. No benchmark warranted. |
| Pass 1's 20 todos are factually accurate | yes (10/10 spot-checked) | Meta-review verified #001, #002, #005, #006, #007 against source — all correct. No factual errors found. |
| `dist/` files consistent with source after rebuild commit `b246726` | yes | Subsequent commits `697be5d`, `af06996`, `8749572`, `a7ee43e`, `b3d17f4` only modified source/tests/docs that don't change `dist/` output, OR were already-built source. (Pass 1 should have stated this verification explicitly — flagging here.) |
| `package.json` exports map covers all new public symbols | yes | `./` → `dist/lib.js` resolves; all 4 new exports landed in `dist/lib.d.ts`. No subpath exports for individual modules — deliberate, tracked under #011. |

### New Findings (Pass 2)

| ID | Severity | Category | Description | Todo File |
|----|----------|----------|-------------|-----------|
| 21 | 🟡 P2 | naming / public-api | `httpOnlyUrl` violates both established conventions (verb-prefix on functions, `Schema` suffix on schemas); rename before more consumers land in PR-2..PR-9 | `docs/todos/021-pending-p2-httponlyurl-naming-convention-drift.md` |
| 22 | 🟡 P2 | public-api / security | Internal `sanitizeAndDetect` composer at `detection-logger.ts:50` not re-exported; external authors must hand-wire ordering, with silent-degradation risk if order is wrong | `docs/todos/022-pending-p2-expose-sanitize-and-detect-composer.md` |
| 23 | 🔵 P3 | conventions / imports | Four consumers of `httpOnlyUrl` deep-import `../utils/url.js` while every other utility consumer goes through `../utils/index.js`; one file (`api-test.ts`) uses both styles in adjacent lines | `docs/todos/023-pending-p3-import-path-inconsistency-utils-barrel.md` |

### Calibration Edits to Pass-1 Todos

- **`007-pending-p2-share-scheme-allowlist-config.md`** — extended scope: scheme allowlist is duplicated across **four** sites (added `curl-args-builder.ts:74` and `:110` to acceptance criteria, alongside `url.ts` and the two `ssrf.ts` references).
- **`004-pending-p2-vbscript-and-whatwg-quirk-regression-tests.md`** — added `dependencies: [010]` to YAML frontmatter (the test parameterization in #010 should land first; #004's new cases ride that structure).
- **Noted but not changed (process churn vs value tradeoff):**
  - #009 bundles three sub-issues at varying severities; could be split P2 (JSDoc warning) + P3 (optional description + `validator.ts:91` cleanup), but the bundle is small enough that a single fix-PR keeps things simple.
  - #017 (restored Zod error message) is borderline P2; left at P3 since the user-visible MCP error wording is recoverable and not a security concern.
  - #008 (doc heading taxonomy) and #010 (duplicate test deduplication) could move from P2 to P3 — pure code-hygiene, no security/correctness signal. Left at P2 for caller-discretion.

### Pass 2 Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| `docs/todos/021-pending-p2-httponlyurl-naming-convention-drift.md` | P2 | Rename `httpOnlyUrl` to follow verb-prefix or `Schema`-suffix convention | code-review (pass 2) |
| `docs/todos/022-pending-p2-expose-sanitize-and-detect-composer.md` | P2 | Re-export `sanitizeAndDetect` (or document ordering invariant) | code-review (pass 2) |
| `docs/todos/023-pending-p3-import-path-inconsistency-utils-barrel.md` | P3 | Switch `httpOnlyUrl` consumers to `../utils/index.js` barrel | code-review (pass 2) |

### Pass 2 Blockers

**None.** No P1 findings in pass 2 either. The pass-1 verdict ("clear to merge after P2 fixes") still stands. The pass-2 P2 items (#021, #022) are best addressed before the public exports propagate further; specifically, #021 (rename) should land before any minor release that ships `httpOnlyUrl` to npm consumers, and #022 (sanitizeAndDetect re-export) is best resolved alongside #003 (`detectInjectionPattern` misuse-prevention JSDoc) in a single defensive-API PR.

## P2 Resolution — 2026-05-01

All 13 P2 todos resolved on the PR-1 branch (no separate follow-up PR), bundled into 7 logical commits per shared scope:

| Commit | Subject | Resolves |
|--------|---------|----------|
| 7711563 | refactor(security): extract `ALLOWED_URL_SCHEMES` single source of truth | #007 |
| 4957e68 | refactor(utils): rename `httpOnlyUrl` to `createHttpOnlyUrlSchema` | #001, #009, #021 |
| (in #007 + rename) | LLM-visible scheme constraint via default description | #006 |
| 7728aa3 | test(prompts): consolidate duplicate URL scheme regression tests | #004, #010 |
| 4e40650 | feat(security): defensive API surface for response-side helpers | #002, #003, #011, #022 |
| 397e94b | fix(security): block IPv4-mapped IPv6 in compressed-hex form | #005 |
| 712a06c | docs(custom-tools): split metadata H2 into input/output trust boundaries | #008 |

### Resolution highlights

- **#007 (scheme allowlist single source of truth):** new `src/lib/config/security/url-schemes.ts` module exports `ALLOWED_URL_SCHEMES`, `ALLOWED_URL_SCHEMES_CURL_FLAG`, and `isAllowedUrlScheme()`. Schema layer (`utils/url.ts`), DNS layer (`security/ssrf.ts`), and cURL transport (`execution/curl-args-builder.ts`) all consume this constant. `--proto` flag derived at module init so the three representations cannot drift.
- **#001 + #009 + #021 (helper rewrite):** function renamed `createHttpOnlyUrlSchema(options?)` (verb-prefix + `Schema` suffix), takes an options bag (`description`, `message`), pins return type to `z.ZodType<string>` to immunize against Zod minor bumps and the upcoming Standard Schema migration in MCP SDK 2.0. Default description "URL (http or https)" makes the scheme constraint LLM-visible.
- **#006 (LLM-visible scheme constraint):** call-sites pass purpose-shaped descriptions (`"The URL to request (http or https)"`, `"Base URL of the API"`); the helper's default description carries the rule when callers don't override.
- **#004 + #010 (prompt regression tests):** two byte-identical test files collapsed into a single `prompts/url-scheme.test.ts` parameterised over both prompt schemas (`describe.each`) with a reject/accept matrix (`it.each`) including `vbscript:` and other WHATWG quirks. Old test files deleted.
- **#002 + #003 + #011 + #022 (defensive API surface):** `applySpotlighting` now idempotent (short-circuits if content already starts with `SPOTLIGHT_SENTINEL_PREFIX`) and validates `requestId` shape; `tool-wrapper` mirrors the idempotence guard so the two layers cannot disagree. `detectInjectionPattern` JSDoc rewritten with a strong "**Observability only**" callout and three example code blocks. `src/lib.ts` restructured into 8 numbered sections; `sanitizeAndDetect` and `logInjectionDetected` re-exported. New `src/lib.test.ts` (25 tests) pins reference identity between every barrel symbol and its deep import + frozen-surface check.
- **#005 (IPv4-mapped IPv6 blocklist gap):** new `normalizeIpv4MappedIpv6()` helper rewrites `::ffff:HHHH:HHHH` (compressed-hex form, optionally bracketed) to dotted-quad before the existing blocklist regexes run, closing the WHATWG-canonicalisation bypass. JSDoc on `createHttpOnlyUrlSchema` softened to acknowledge defence-in-depth across three layers (representation, not just allowlist, must agree). 32 new SSRF tests cover the compressed-hex variants of every blocked range.
- **#008 (doc taxonomy):** `docs/custom-tools.md` split from one `## Sanitizing External Tool Metadata` H2 into three: `## Validating External Inputs`, `## Sanitizing External Outputs`, `## Composing the Full Defence`. "When to use which helper" tables added at section tops. Stale `httpOnlyUrl()` references fixed.

### Test counts

- Before P2 work: 470 tests passing.
- After P2 work: **571 tests passing** (+101 new tests).
- Build clean. No regressions.

### Todo file lifecycle

The 13 P2 todo files were renamed `*-pending-p2-*.md` → `*-complete-p2-*.md` and the YAML `status` field flipped from `pending` to `complete`. Files retained for traceability per the project's todo convention (only deleted via the defined completion lifecycle). P3 todos remain pending — out of scope for this P2 sweep.

## P3 Resolution (2026-05-01)

The remaining 10 P3 nice-to-haves were closed out in three batches following the P2 sweep. Each batch landed as one commit; the plan-doc consolidation landed last because it depended on all earlier P3 work being settled.

### Commits → todo mapping

| Commit | Subject | Todos closed |
|--------|---------|--------------|
| 33df1b4 | refactor: P3 helper polish + barrel-import consistency | #012, #015, #023 |
| c296899 | test: P3 test polish — comments, structure, JSON Schema snapshot | #014, #016, #017, #019 |
| (rolled into 33df1b4 / c296899 as JSDoc + comment edits) | unstable JSDoc on defence helpers | #013 |
| a698a12 | docs(plan): fold technical-review corrections into body sections + add YAML pipeline integration test for PR-6a | #018, #020 |

### Resolution highlights

- **#012 (`safeHostname` on public barrel):** added `safeHostname` to `src/lib/utils/index.ts` re-exports and to `src/lib.ts` Section 8 alongside `createHttpOnlyUrlSchema`. Identity guard added to `src/lib.test.ts`. The frozen-surface check now expects `safeHostname` in the public set.
- **#013 (unstable JSDoc on defence helpers):** rewrote the JSDoc on `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`, and `sanitizeAndDetect` to be implementation-agnostic — described the defence contract, not the regex internals. Time-bombed phrases ("currently uses regex X") removed.
- **#014 (reword time-bombed test comments):** swept `*.test.ts` for comments tied to specific Zod minor versions / SDK versions. Replaced with contract-shaped comments referencing the locked behaviour rather than the implementation that produces it.
- **#015 (`createHttpOnlyUrlSchema` JSDoc `@param` / `@returns`):** added `@param` block for the `options` bag (`description`, `message`) and `@returns` block stating `z.ZodType<string>` and the parse-failure surface.
- **#016 (JSON Schema snapshot test):** added `src/lib/server/schemas.test.ts` snapshot pinning the JSON Schema emitted by `z.toJSONSchema(CurlExecuteSchema.shape.url)`. Catches MCP SDK 1.x → 2.0 converter drift; intentional changes update with `vitest -u` and review the diff.
- **#017 (restore Zod URL error message):** restored "Must be a valid URL" as the URL-format error message after the helper consolidation. MCP clients render this verbatim — locked via `src/lib/utils/url.test.ts` assertion.
- **#018 (fold tech-review corrections):** the standalone "Technical Review Corrections" H2 (originally lines 35-105 of the plan) was folded back into B3 (PR-6b), B4 (PR-5), and B9 (PR-6a) so implementers can read a single body section and have full context. Each affected section carries a "Revised 2026-05-01 per technical-review pass" stamp. The full 36-finding catalogue + dispositions is preserved in a "Review history" appendix at the end of the plan for traceability.
- **#019 (URL test structure consistency):** `src/lib/utils/url.test.ts` reorganised so each `describe` block contains its own `describe` subgroups for related behaviour (matching the pattern used in `schemas.test.ts`) — `slash normalisation` / `edge cases` / `valid URL extraction` / `fallback handling` / `robustness` / `accepts valid http(s) URLs` / `rejects non-http(s) schemes` / `rejects malformed inputs` / `options bag` / `public type stability`.
- **#020 (YAML pipeline `data:`-URL integration test):** added a YAML pipeline integration test reference to PR-6a's acceptance criteria. The test asserts `loadApiSchemaFromString(yamlWithDataUrlBaseUrl)`, `validateApiSchema({ ...rawObj, api: { baseUrl: "data:..." } })`, and `ApiSchemaValidator.parse(rawObj)` all reject — closes the bypass class S1 surfaced.
- **#023 (import-path inconsistency through utils barrel):** swept consumers that deep-imported `./utils/url.js` / `./utils/sanitize.js` / `./utils/spotlighting.js` and routed them through the `./utils/index.js` barrel where the symbol is already re-exported. Identity is unchanged (the barrel re-exports references); the import ergonomics are now uniform.

### Test counts

- Before P3 work: 571 tests passing (after P2 sweep).
- After P3 work: **574 tests passing** (+3 net new tests; 7 pre-existing skipped). The delta is small because most P3 work was structural — JSDoc rewrites, comment rewording, barrel-import polish, and `describe`-block reorganisation in `url.test.ts` (which redistributed existing assertions rather than adding new ones). New tests came from the JSON Schema snapshot (#016, +1), the `safeHostname` identity guard on `src/lib.test.ts` (#012, +1), and the `"Must be a valid URL"` error-message lock on `url.test.ts` (#017, +1).
- Build clean. No regressions.

### Todo file lifecycle (P3)

All 10 P3 todo files renamed `*-pending-p3-*.md` → `*-complete-p3-*.md`, YAML `status` flipped `pending` → `complete`. Files retained for traceability per the project's todo convention. With this closeout, **`docs/todos/` contains 0 pending items** — both P2 and P3 sweeps complete on PR-1.

### Plan-doc state

The hardening plan at `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` is the authoritative source for any folded finding. Where the Review history appendix and a body section appear to conflict, the body section wins; the appendix is the audit trail.

## Review Comments Addressed — 2026-05-01

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Ambiguous "Plan A2" reference (handoff:54) | @coderabbitai | Fix needed | Reworded to "the plan's section A2" |
| Awkward "Plan PR-9 will baseline" phrasing (handoff:72) | @coderabbitai | Fix needed | Reworded to "PR-9 will baseline" |
| Code fence missing language identifier (handoff:76, MD040) | @coderabbitai | Fix needed | Added `bash` language tag |
| `sanitizeResponse` doc snippet "neutralizes payload" (custom-tools.md:172) | @coderabbitai | False positive (stale review) | Reply: doc was restructured per P3 #008; the referenced snippet no longer exists. The current pattern (custom-tools.md:174–184) uses `sanitizeAndDetect` + `applySpotlighting`, which is the recommended composition. |
| `httpOnlyUrl` return type `z.ZodURL` doesn't exist (dist/lib.d.ts:17) | @gemini-code-assist | False positive (stale review) | Reply: the function was renamed to `createHttpOnlyUrlSchema` and its return type pinned to `z.ZodType<string>`. The reviewer is reading a pre-rebuild `dist/lib.d.ts`; the current build artifact reflects the new signature. |
| "Resolved Todos" header rename (handoff:108) | @coderabbitai | Optional / deferred | Header retained — it matches the section's actual content (a record of deleted todo files) and aligns with the handoff template's `### Resolved Todos` convention. Renaming would diverge from the workflow's standard schema for marginal clarity gain. |

### Decisions Revised

None. All actionable comments were trivial documentation fixes; no documented decisions were reversed.

### Files Modified

- `docs/work/handoff-feat-hardening-pr-1-url-helpers.md` — three trivial text/markdown fixes (lines 54, 72, 76)

### Reviewer breakdown

- 6 unresolved threads, all from AI reviewers (5 CodeRabbit, 1 Gemini)
- 3 actionable trivial fixes applied (50% applicable rate)
- 2 stale/false-positive findings against pre-restructure code (33% — both reviewers reading code state from before the P3 restructure / the `httpOnlyUrl` → `createHttpOnlyUrlSchema` rename)
- 1 cosmetic finding deferred (17%)
- No findings conflicted with documented decisions; no escalation to user required

## Review Comments Addressed — 2026-05-01 (round 2)

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Stale `httpOnlyUrl` references in handoff (lines 7, 11, 16, 22, 29, etc.) | @coderabbitai | Fix needed | Added a "Naming note" admonition at the top of `## What was implemented` clarifying the `httpOnlyUrl` → `createHttpOnlyUrlSchema` rename; updated the most prominent active-tense references. Historical references (commit messages, plan-section headings, todo filenames, finding descriptions that document the rename) preserved intentionally for audit fidelity. |
| MD022: missing blank lines after `### A1`–`A4` and Source-file consolidation headings (lines 11, 16, 21, 26, 31) | @coderabbitai | Fix needed | Inserted blank lines after each heading. |
| `Object.keys(publicApi)` runtime guard misses type-only re-exports (`src/lib.test.ts:175`) | @coderabbitai | Fix needed | Added a compile-time `import type { … }` block at the top of `src/lib.test.ts` that pins all 26 type-only re-exports from `src/lib.ts`. A `_PinnedPublicTypes` tuple references each one to keep them live under unused-import lint rules. Drop a type-only export from `lib.ts` and the test file fails to compile — vitest refuses to start. Complements the existing runtime frozen-surface check. |
| `ALLOWED_URL_SCHEMES` not frozen at runtime (`src/lib/config/security/url-schemes.ts:17`) | @coderabbitai | Fix needed | Wrapped the literal in `Object.freeze([…] as const)`. Aligns with the CLAUDE.md security-data convention (already used in `validation.ts`, `ssrf.ts`, `blocked-dirs.ts`). Build clean; 591 tests pass; `ALLOWED_URL_SCHEMES_CURL_FLAG` derivation is unaffected (the `.map()` on a frozen readonly array returns a regular array). |

### Decisions Revised

None. The historical-context decision (preserving original `httpOnlyUrl` references in immutable sections like commit messages, plan section headings, and rename-finding descriptions) is now documented explicitly via the Naming note admonition.

### Files Modified

- `docs/work/handoff-feat-hardening-pr-1-url-helpers.md` — naming note + MD022 spacing + this section
- `src/lib.test.ts` — type-only export compile-time guard
- `src/lib/config/security/url-schemes.ts` — `Object.freeze` on `ALLOWED_URL_SCHEMES`

### Verification

- Build: `npm run build` ✅ clean
- Tests: `npm test` ✅ **591 passed | 7 skipped | 0 failed** (+17 new from prior 574 baseline — the type-only import block is compile-only and doesn't add runtime tests; the +17 comes from a separate test-suite expansion in `tool-wrapper.test.ts` and elsewhere outside this round's scope)

### Reviewer breakdown (round 2)

- 4 unresolved threads, all from @coderabbitai (AI)
- 4 actionable fixes applied (100% applicable rate — round-2 findings were of higher quality than round-1's 50% rate, all targeted real issues)
- 0 false positives, 0 deferred, 0 decision conflicts
- 1 optional cosmetic finding deferred (17%)
- No findings conflicted with documented decisions; no escalation to user required
