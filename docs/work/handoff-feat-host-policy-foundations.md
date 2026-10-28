# Work Handoff: feat-host-policy-foundations

**Date:** 2026-10-27 | **Branch:** feat/host-policy-foundations | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** in-review

Created during review, not by the work run's Step 6. `/sixees-workflow:work --pr-key=PR-1` stopped at its Step 5 because the review raised P1 findings. The operator has since decided them (see *P1 fixes — 2026-10-27*); the work-handoff schema has not yet been written.

## Code Review — 2026-10-27

**Certification:** complete
**Roster closure:** closed. Unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding". pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane".

**Scope:** 23d9f4e..HEAD, resolved with `git merge-base --fork-point origin/HEAD HEAD`: 5 commits, 19 files.

**Agents used (8 of 8 returned):**

| Agent | Role | Status | Classes |
|---|---|---|---|
| security-sentinel | floor | findings | 2 |
| code-simplicity-reviewer | floor | findings | 1 |
| data-integrity-guardian | floor | not-applicable | 0 |
| learnings-researcher | floor | done | — |
| typescript-reviewer | optional | findings | 5 |
| architecture-strategist | optional | findings | 2 |
| pattern-recognition-specialist | optional | findings | 1 |
| performance-oracle | optional | clean | 0 |

**Finding counts:** 8 classes after merging. P1: 3, P2: 3, P3: 2. All 8 are in scope and filed. None rejected, declined or marked investigate-first.

**Handoff assessment:** no builder handoff existed before this review. Two of the commit messages' claims did not hold:
- "a host off the list is never resolved, let alone sent the credentials in defaultHeaders" is false. The WHATWG parse and cURL disagree on the host (todo 024).
- The structural test's header, "no in-library caller falls back to 'any'", is contradicted by `generator.ts::createToolHandler` (todo 025).

The builder disclosed the redirect-hop gap as PR-3's job, but not that the new docs promise every hop now (todo 026).

### Key findings

| Severity | Category | Todo |
|---|---|---|
| P1 | injectable-input: the WHATWG-parsed gate vs cURL's raw-URL host | 024 |
| P1 | fail-open-default: the YAML handler overwrites the caller's policy with "any" (recurred: RC-31, RC-56) | 025 |
| P1 | broken-contract: the docs promise every hop before redirects are gated (recurred: RC-21) | 026 |
| P2 | stale-observation: YAML tools snapshot the policy before the config is final | 027 |
| P2 | broken-contract: `utilities().executeRequest` gains a rejection path (recurred: RC-21) | 028 |
| P2 | duplicated-logic: the "usable baseUrl" check restates the scheme allowlist (recurred: RC-27) | 029 |
| P3 | missing-constraint: the LocalRefusal union admits contradictory states | 030 |
| P3 | convention-drift: the public `hostPolicy` field has no public type or constructor | 031 |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| A host off the list is never resolved or contacted | Reproduced todo 024: WHATWG gives `allowed.example`, the schema accepts the URL, and cURL 8.7.1 on a loopback listener sent `Host: evil.example` | **Refuted** |
| The structural test fails when any of the three call sites drops the policy | Teeth probe at each site | Holds |
| Removing the live host check fails the host-policy tests | Teeth probe: 5 of 9 failed | Holds |
| `canonicalHost` has one implementation | `rg -n 'function canonicalHost' src` gives 1 hit | Holds |
| The full suite passes | `npx vitest run`, human-readable output: 45 files, 1585 passed, 7 skipped | Read from the summary line, not a structured verdict (see below) |

**Test verification:** none certified. Vitest is not a runner this workflow trusts for a structured verdict, so the operator's own test run before any push is the test floor.

### Outstanding todos (from this review)

| Todo | Priority | Status |
|---|---|---|
| 024 | P1 | pending |
| 025 | P1 | pending |
| 026 | P1 | pending |
| 027 | P2 | pending |
| 028 | P2 | pending |
| 029 | P2 | pending |
| 030 | P3 | pending |
| 031 | P3 | pending |

**Classes open without a todo (escalated or investigate-first):** none.

**Blockers:** P1 todos 024, 025 and 026. `/sixees-workflow:work` treats every P1 as an escalation, so all three wait for the operator's decision: fix them on this branch, or defer them.

## P1 fixes — 2026-10-27

The operator chose to fix all three P1s on this branch and to delete their todos once fixed.

| Todo | Disposition | Commit |
|---|---|---|
| 024 | Fixed: `executeCurlRequest` replaces `params.url` with `new URL(params.url).href` before the host list, so the list, the SSRF gate and cURL's argv all see one host. A URL that does not parse is left to the SSRF gate. | 7f12adc |
| 025 | Fixed: `createToolHandler` resolves `hostPolicy` as `config ?? extra ?? "any"`, the precedence `allowLocalhost` already used. The call-site test's header now states what it checks. | 7f12adc |
| 026 | Fixed: the `allowedHosts` doc and the check's comment say the list bounds the request URL's host and not yet redirect hops. PR-3 restates the claim when the hop loop lands. | a772b8c |

Todos 024, 025 and 026 are deleted. Todos 027–031 remain `pending`.

**Tests:** new tests cover the parsed href reaching argv, the reverse-order refusal and the generated handler keeping the caller's list. Reverting either code fix fails its test. Full suite: 45 files, 1588 passed, 7 skipped, read from vitest's summary line, so not a certified verdict. `tsc --noEmit` shows the same 12 pre-existing test-file errors.

**Not re-reviewed:** these fixes are newer than the Surface-2 review above (K-16).

## P2/P3 fixes — 2026-10-27

The operator asked for todos 027–031 to be fixed and their files removed.

| Todo | Disposition | Commit |
|---|---|---|
| 027 | Fixed: `createApiServer` clears the generator's own list and passes `deriveHostPolicy(server.getConfig())` into each YAML tool call, so a `configure()` before `start()` reaches them. | 047acbf |
| 028 | Kept the rejection (plan M-12) and documented it on `InstanceUtilities.executeRequest`; a test pins it to the message `start()` raises. | d77bdfc |
| 029 | Fixed: `baseUrlHost` is the one "is this baseUrl usable" check, used by `deriveHostPolicy` and `resolveRequestUrl`; a table test holds them to the same answer. | f8e72bc |
| 030 | Fixed: `LOCAL_REFUSAL_CODE_REASONS` ties each code to its reasons in the type; the nothing-sent arm forbids `requestsSent`; narrowing is on `code`. `LOCAL_REFUSED_PATH` gained the `path-names-host` reason task 16 will render. | 9190eb7 |
| 031 | Fixed: `GeneratorConfig.allowedHosts` replaces `hostPolicy`, in `McpCurlConfig`'s form; `mcp-curl/lib` exports `deriveHostPolicy` and `HostPolicy` beside `executeCurlRequest`. | 047acbf |

Todos 027–031 are deleted. The comment sync (5db3080) ran before these and pushed with the branch; these commits are not yet pushed.

**Tests:** full suite 45 files, 1604 passed, 7 skipped, read from vitest's summary line (not a certified verdict). `tsc --noEmit` shows the same 12 pre-existing test-file errors. Each fix's new test was probed by reverting the fix.

**Not re-reviewed:** these fixes, and the P1 fixes above, are newer than the Surface-2 review (K-16).

## Review Comments Addressed — 2026-10-28

PR #50. Round 1: CodeRabbit (full review) and Codex (scoped `@codex review`). Codex reported no issues on `6c5cfdd`.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| `generatorConfig.allowedHosts` is silently discarded by `createApiServer` | coderabbitai | Fix needed (P3, in scope) | `ApiServerOptionsBase.generatorConfig` is now `Omit<GeneratorConfig, "allowedHosts">`, so passing it does not compile; the runtime clear stays for untyped callers. A `@ts-expect-error` fixture in `api-server.test.ts` pins it (probed: unused directive with the `Omit` reverted). Chose a type error over the suggested `console.warn`: the field is new on this branch, so no caller passes it, and a log line nobody reads would not stop the surprise. |

### Declined Findings

None this round.

### Decisions Revised

None.

### Resolved Todos

None.

### Outstanding Todos

None.

### Files Modified

- `src/lib/api-server.ts`
- `src/lib/api-server.test.ts`
