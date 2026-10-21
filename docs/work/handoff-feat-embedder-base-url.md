# Work Handoff: feat/embedder-base-url
**Date:** 2026-10-21 | **Branch:** `feat/embedder-base-url` | **Plan:** `docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md` | **Status:** complete — PR-1 slice done; review todos 021–023 fixed on the operator's instruction. The fix commits came after the Surface 2 review below and have not been reviewed by it (K-16).
**Plan slice:** PR-1 (tasks 1–6)

This file was first created by `/sixees-workflow:review`, and its review record is kept below. The work-run sections follow here.

## Summary

`baseUrl` was dead on the `curl_execute` tool path, because the strict `url` schema rejected every relative url before the handler ran.
- A server with `baseUrl` now registers `CurlExecuteBaseUrlSchema`, which advertises `url` as `anyOf [format uri | pattern]`.
- The handler resolves a single-`/` path against the base with `utils/url.ts::resolveRequestUrl`. That one join also serves `utilities().executeRequest` for both `url` and `path`.
- Review found that routing `path` through the resolver narrowed a published input.
- The operator chose to keep the narrowing as a **breaking change**, documented, and to make it robust: any relative input a parser would read as a host, or that holds a control character, is now refused with an error that states the rule.

## What was implemented

- **Resolver**: `src/lib/utils/url.ts::resolveRequestUrl` and `::RELATIVE_PATH_PATTERN`.
  - Without `baseUrl`, the input passes through unchanged.
  - With `baseUrl`:
    - input beginning `/` or `\` is joined if it matches the pattern (single leading `/`, no C0 control or DEL) and has no `.` or `..` segment (`::hasDotSegment`, literal or `%2e`-encoded), and refused otherwise;
    - an absolute URL passes through unchanged.
  - The join is `resolveBaseUrl`'s concatenation, guarded by the base parsing as an absolute http(s) URL.
  - Nothing in it throws: the join sits inside the `try`.
- **Tool path**:
  - `src/lib/server/schemas.ts::CurlExecuteBaseUrlSchema` is a union of `createHttpOnlyUrlSchema` and the same pattern.
  - `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` selects the schema on `config.baseUrl`, resolves before `applyConfigTransformsCurl`, and returns a refusal through `wrap` (invariant 1).
  - The prepend in `applyConfigTransformsCurl` is gone.
- **Library path**: `src/lib/extensible/instance-utilities.ts::createInstanceUtilities` → `executeRequest`.
  - `url` wins over `path`.
  - `path` gets a missing leading `/` added, then both go through the resolver.
- **Test fixtures**:
  - `in-memory-client.test-fixture.ts::connectInMemory` is a real MCP client over `InMemoryTransport`, so the SDK's input parse is in the loop.
  - `tool-capture.test-fixture.ts::captureTools` records `registerTool` meta and handler. It replaces 11 hand-rolled copies.
- **Docs**:
  - `docs/configuration.md` → *baseUrl*
  - `docs/custom-tools.md` (the `executeRequest` rule)
  - the `McpCurlConfig.baseUrl`, `executeRequest` and `ExecuteRequestParams.path` docblocks
  - the `url` field description
  - `CHANGELOG.md` `[Unreleased]`, with a BREAKING entry and a Fixed entry

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| `path` keeps tolerating a missing leading `/` | Operator, at the audit: `"users"` worked in 5.0.x | Reject anything not `^/` (stricter break) |
| `path`/`url` values starting `//`, `\` or `/\`, or holding control characters, are refused (BREAKING) | Operator, after review P1 021: "consumers will have to comply and adjust"; make it as robust as possible | Split the join from the gate so `path` skips it (restores 5.0.x, MINOR) |
| Release stays **5.1.0** (MINOR) despite the BREAKING change | Operator, 2026-10-21: one internal consumer, told directly. Recorded in the CHANGELOG entry. `0823c54`'s `!` marker is pushed and stays; it disagrees with the version on purpose | 6.0.0 under invariant 11 |
| Control characters refused in any relative input | The SSRF gate's WHATWG parse strips tab/CR/LF while cURL gets them raw | Refuse only `//` and `\` |
| Origin comparison removed (022) | Cannot fail once the base parses as http(s); a single-`/` suffix cannot move the authority | Keep it as a documented backstop |
| `schema/generator.ts::buildUrl` stays off the resolver, but refuses a `.` or `..` path segment via `hasDotSegment` | Plan: its paths are operator YAML, not model input. The operator then extended the dot-segment rule to YAML path parameters (todo `021-p3-dot-segment…`, 2026-10-21: "fail loudly") | Route it through the resolver |
| No lesson filed for the `path` divergence | Gate 2: RC-45 (state each caller's question before consolidating) and RC-37 (sweep a deleted mechanism for what it incidentally satisfied) already state the rule. **Recurrence of both.** | A new entry |

## What to pay attention to during review

- **Version**: the change is BREAKING, but the release stays **5.1.0** by operator decision (see *Key decisions*).
  - Do not re-raise the MAJOR pricing in review. Cite this decision instead.
  - `package.json` is still 5.0.1. The bump is PR-4's, so this branch does not change it.
- **The fix commits `0823c54` and `c8a725b`, and the later `317080f`, `418cf0d` and `35d3dcb`, have not been through a Surface 2 review.** Point the next review at them (K-16). `35d3dcb` is a second BREAKING change (dot-segment refusal), and it reaches `buildUrl` as well.
- **`RELATIVE_PATH_PATTERN` is shared by the schema and the resolver.** Widening it changes the advertised tool schema too.
- The refusal text names the rule, not the value. Keep it that way, because the input is attacker-chosen on the tool path.

## Known issues and limitations

- Every YAML `api-server` sets `baseUrl`, so every YAML-driven server now advertises the union schema (architecture-strategist). That is intended, but it changes the `tools/list` bytes for those servers.
- An absolute URL to any host still passes on a `baseUrl` server. This was declined in the plan, operator Q1.
- Pre-existing, not filed here:
  - `buildCurlArgs` never checks an absolute URL for CR/LF (security-sentinel note).
  - The `!enabled` early returns are unwrapped (todo 015).

## Testing summary

- **Added**:
  - resolver units: the pattern, the joins, the refusals, a malformed base, a non-string base;
  - e2e through `connectInMemory`: relative join, `anyOf` advertisement, absolute pass-through, six schema rejections, malformed base, the real SSRF gate, the no-`baseUrl` static listing;
  - `utilities()` cases: `url`, `path`, slash-less `path`, five refusals, no base, malformed base;
  - schema selection via `captureTools`;
  - the wrap on the resolver refusal.
- **Teeth**: each guard was mutated and its named test seen to fail:
  - the tool-path join, the schema switch and the wrap on the refusal;
  - the utilities join and the `path` slash normalisation;
  - the scheme check, the throw guard and the explicit refusal;
  - the control-character class, the backslash-led gate and schema selection.
- **Last run**: `npx vitest run` gives 1432 passed, 7 skipped, 42 files.
  - Run with `MCP_CURL_ALLOW_LOCALHOST=true` to confirm the loopback tests stay offline.
  - `npx tsc --noEmit` shows only the 12 errors that already exist on `main`, in untouched test files.
  - There is no lint script.
- **Verdict source**: vitest, whose structured output the work command does not trust. **This run therefore applied no formal test verification**; the counts above are the console summary.

## Commit history

```
c8a725b test(extensible): one fixture for capturing registerTool calls
0823c54 feat(extensible)!: refuse a relative url or path a parser would read as a host
4230d4d docs(review): record the Surface 2 review of feat/embedder-base-url
aee3ed5 docs(config): describe baseUrl resolution and its limits
6c28c36 fix(utils): keep resolveRequestUrl from throwing on untyped config
ffae802 feat(extensible): resolve a relative url against baseUrl on the tool path
37d5860 feat(utils): add resolveRequestUrl and RELATIVE_PATH_PATTERN
```
Plus `ce1d6f6`, which carries this handoff and the todo removals; `21af2e3`, which records the 5.1.0 decision in the CHANGELOG; `317080f`, the comment sync; `418cf0d`, which keeps the `get_user_profile` id out of dot-segments; and `35d3dcb`, which refuses a `.` or `..` path segment instead of resolving it.

## Review context

- **Suggested order**:
  1. `utils/url.ts` (the whole rule)
  2. `server/schemas.ts`
  3. `extensible/tool-wrapper.ts`
  4. `extensible/instance-utilities.ts`
  5. the e2e test
  6. the CHANGELOG
- **Invariants touched**: 1 (resolver refusal wrapped), 2/3/12 (the SSRF gate stays downstream of the join), 10 (`utils/` → `config/security/` is an existing edge), 11 (breaking).
- **Related lessons**: RC-36, RC-21, RC-20, RC-55, RC-45, RC-37.

## Follow-up work

- [ ] PR-4: bump to 5.1.0 as planned, and rename `[Unreleased]`.
- [ ] Tell the internal consumer about the `executeRequest` change.
- [ ] Optional: the stale "prepended to relative URLs/paths" comments in `docs/getting-started.md` and `examples/basic/src/index.ts`. These were declined in review as out of scope.
- [ ] Run Surface 3 (`/sixees-workflow:review-pr-comments`) once a PR is open.

### Outstanding Todos

None from this run.

### Resolved Todos

| id | title | summary | by | date |
|---|---|---|---|---|
| 021 | `executeRequest` `path` gated as if it were a model url | Kept as a documented BREAKING narrowing, made explicit and extended to control characters | `0823c54` | 2026-10-21 |
| 022 | Resolver origin compare cannot fail | Comparison removed; the base parse is the documented guard | `0823c54` | 2026-10-21 |
| 023 | Fake-`registerTool` capture copied per test | `captureTools` fixture, 11 copies routed through it, schema-selection test added | `c8a725b` | 2026-10-21 |

All three todo files were removed at the operator's instruction.

## Code Review — 2026-10-20

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; pattern-recognition-specialist → "whichever reviewer owns that lane"
**Target:** branch `feat/embedder-base-url` — no PR
**Scope:** base `8edf9e7` (`git merge-base origin/HEAD HEAD`; the `--fork-point` arm did not answer), range `8edf9e7..HEAD`, 4 commits, 12 files.

**Agents used (8):**
- Floor: learnings-researcher, code-simplicity-reviewer, security-sentinel and data-integrity-guardian.
- Optional: typescript-reviewer, architecture-strategist, pattern-recognition-specialist and performance-oracle.
- Every agent returned and none failed.

**Findings:** 4 classes in total: 1 at P1, none at P2 and 3 at P3.
- Filed as todos: 3.
- Declined as out of scope: 1.
- Investigate-first: none.
- Rejected: none.

### Handoff assessment

No work handoff existed when this review ran, so the review went code-first. The work run's commit bodies do flag both the P1 and the `dead-code` P3 themselves:
- `ffae802` says "A path beginning // is no longer joined".
- The teeth-probe note in the work run says the origin comparison is unproven.

So both were acknowledged by the builder, not undisclosed.

### Key findings

| Severity | Class | Todo | Reviewers |
|---|---|---|---|
| P1 | `broken-contract`: `executeRequest({ path })` values starting `//` or `/\` are now refused. At base they joined onto the base host. This narrows a published method (invariant 11). It recurs: RC-36, RC-55. | 021 | architecture-strategist (security-sentinel and typescript-reviewer noted it out of lane) |
| P3 | `dead-code`: the origin comparison in `resolveRequestUrl` cannot fail, because the base parse and scheme check run before it. | 022 | code-simplicity-reviewer |
| P3 | `duplicated-logic`: the fake `registerTool` capture is copied in each test; this diff adds one more copy. | 023 | pattern-recognition-specialist |
| P3 | `stale-comment`: `docs/getting-started.md` and `examples/basic/src/index.ts` still say "prepended to relative URLs/paths". | — **declined, out of scope**: both confirmed instances are outside the diff. It is a one-line edit if the operator wants it. | pattern-recognition-specialist |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | `npx vitest run` after the last commit | 1413 passed, 7 skipped, 42 files |
| One join | security-sentinel's sweep and architecture-strategist's sweep | Yes, on the model-input path. `schema/generator.ts::buildUrl` is excluded by the plan |
| Invariant 1 on the resolver error | security-sentinel's trace, plus the unit test `isWrappedResult` | Holds |
| SSRF ordering | security-sentinel's trace | The join runs before `validateUrlAndResolveDns` on both paths |

### Outstanding todos

| Todo | Priority | Description | Source |
|---|---|---|---|
| 021 | P1 | `executeRequest` `path` is gated as if it were a model url | architecture-strategist |
| 022 | P3 | The resolver's origin comparison cannot fail | code-simplicity-reviewer |
| 023 | P3 | Fake-`registerTool` capture copied per test | pattern-recognition-specialist |

### Open without a todo

None.

**Blockers:** P1 todo 021.

**Reviewer notes carried forward:**
- data-integrity-guardian returned `not-applicable`: there is no data layer.
- Reviewers without `Bash` judged their modified files whole and declared it themselves: typescript-reviewer, code-simplicity-reviewer, architecture-strategist and data-integrity-guardian.
- security-sentinel noted a pre-existing gap: `buildCurlArgs` never checks the URL for CR/LF. It is outside this diff and was not filed.
- pattern-recognition-specialist noted two things:
  - a stray `.` line inside the code fence in `docs/configuration.md` → *baseUrl*. The line predates this branch; the diff edited the same section.
  - the `!enabled` early returns are unwrapped. That is pre-existing and already todo 015.
