# Work Handoff: curl_execute version line and embedder description append
**Date:** 2026-10-23 | **Branch:** feat/curl-execute-description-append | **Plan:** docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md | **Status:** complete — tasks 11–14 done; review todos 021 and 022 resolved on this branch (operator-directed)
**Plan slice:** PR-3

## Code Review — 2026-10-23

**Certification:** complete
**Roster closure:** closed unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"
**Diff:** `a618e830b490fbf0ccea9f51a1362abfe5250537..HEAD` (resolved by `git merge-base --fork-point origin/HEAD HEAD`), 2 commits; `dist/` regenerated and not reviewed.
**Roster:** config `review_agents` (6) ∪ floor (4) = 8 dispatched, 8 returned.

| Reviewer | Floor | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| learnings-researcher | floor | none | done | — | 5 related RCs (RC-36, RC-21, RC-54, RC-25, RC-35); none matches a merged class |
| code-simplicity-reviewer | floor | v1 | clean | 0 | no Bash — judged the modified files whole (declared) |
| security-sentinel | floor | v1 | clean | 0 | traced every route from `configure()` to the registered description; none bypasses sanitising; no value in error/warn text |
| data-integrity-guardian | floor | v1 | not-applicable | 0 | no data layer in diff; no Bash — judged modified files whole (declared) |
| typescript-reviewer | optional | v1 | clean | 0 | no Bash — judged modified files whole (declared) |
| performance-oracle | optional | v1 | clean | 0 | append is capped and composed once per session |
| architecture-strategist | optional | v1 | findings | 1 | no Bash — judged modified files whole (declared) |
| pattern-recognition-specialist | optional | v1 | findings | 1 | jscpd used |

**Findings:** 2 — P1 0 | P2 1 | P3 1. Dispositioned: 2 filed | 0 declined | 0 investigate-first. Escalated: 0. Rejected: 0.

| Class | Severity | Instances | Reviewers | Disposition | Todo |
|---|---|---|---|---|---|
| misplaced-decision — the "append is never shown" warning and doc are false; a disabled curl_execute is still listed with the append | P2 | 3 confirmed (+1 out-of-scope sibling, `api-server.ts::createApiServer` docblock) | architecture | in scope — filed `pending` | 021 |
| duplicated-logic — startable McpServer stub rebuilt per describe block (third copy added) | P3 | 3 confirmed | pattern | in scope — filed `pending` | 022 |

**Handoff assessment:** no handoff existed at review time, so none was verified. The builder's
own mutation probes covered the warn path, but only for "the warning fires". None of them checked
whether the warning's claim is true. That gap is the P2.

**Verified claims:** "tests pass": the full suite was re-run through the vitest JSON reporter:
1525 total, 1518 passed, 0 failed, 7 skipped.

**Open without a todo:** none. **Blockers:** none (no P1, no escalation).

## Summary

This slice ships plan items 3 and 7 (PR-3, tasks 11–14). The built-in `curl_execute` description
now ends with `mcp-curl v<version>`, so a session can read the version without prose matching.
A new optional `McpCurlConfig.curlExecuteDescriptionAppend` lets an embedder add tool-shaped API
knowledge after that line. It is sanitised and capped at `configure()`, composed at registration,
and documented in `docs/configuration.md`. The change is additive and optional, so it is MINOR. The
version bump itself is PR-4's.

## What was implemented

- **Version line:** `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META` adds a final
  `mcp-curl v${SERVER.VERSION}` line. Line 1, the summary, is unchanged. `SERVER` is imported from
  `config/`, which is down the layering arrow.
- **Cap:** `src/lib/utils/sanitize.ts::MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH = 8000` sits
  beside `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH`. Its docblock says it is a budget choice, not a client
  limit (K-22). It is exported through `src/lib/utils/index.ts` and `src/lib.ts`, and
  `src/lib.test.ts`'s export list is updated.
- **Config key:** `src/lib/types/public.ts::McpCurlConfig.curlExecuteDescriptionAppend` is added to
  `KNOWN_CONFIG_KEYS_ARRAY`. The compile-time exhaustiveness assert enforces this. `freezeConfig`
  is unchanged because the value is a string.
- **Validation:** `McpCurlServer.configure()` runs `sanitizeDescription`, which reuses the
  custom-tool sanitiser, then throws on more than 8000 characters, naming the length and the cap. It
  never truncates (operator Q3). The check runs before the merge, as the `rateLimit` parse does, so
  a throw changes nothing.
- **Composition:** `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` builds the meta
  with conditional spreads, so the `baseUrl` schema and the append compose. With neither set, the
  canonical meta object is registered unchanged.
- **Warning:** `McpCurlServer.start()` warns when the append is set and `curl_execute` is disabled.
  **The review showed this warning's claim is false.** See todo 021. *(Resolved: the append is now
  composed only for an enabled tool, so the warning is true — see Resolved Todos.)*
- **Docs:** `docs/configuration.md` covers the interface, the table row, a `### curlExecuteDescriptionAppend`
  section (keep it short, the cap and the rejection, trusted config, appended rather than replacing),
  and the version line versus `serverInfo.name` (K-8, stated once).

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Store the **sanitised** append in config, not the raw one | One sanitise, and `getConfig()` returns what the model sees | Sanitise at registration: that runs once per HTTP session, and the length check would happen after `start()` |
| Skip composing when the append sanitises to empty | Avoids a trailing blank line on the description | Always compose |
| Use a generic example in the published docs (`api.example.com`) | `docs/` ships to npm; the reference embedder is instance data (rule 04) | The reference embedder's real paths |
| Commit the rebuilt `dist/` | Prior PRs (#43, #47, …) commit `dist/` | Leave `dist/` for the release PR |

## What to pay attention to during review

- **Todo 021 (P2):** a disabled `curl_execute` is still registered and listed, and `enabled` gates
  only the handler. The append therefore still reaches the model, and the `start()` warning and doc
  sentence ("never shown") are false. The plan's premise for the warning was wrong at HEAD. I did
  not check it during the audit. *(Resolved in `93a2d69`: a disabled tool is still listed, but
  without the append; nothing further to fix — see Resolved Todos.)*
- The append is **trusted config** and does not go through `defendText` (invariant 1a covers remote
  text). The docs say not to build it from API responses. Code cannot enforce that.
- `SERVER.VERSION` is `0.0.0` under vitest (no tsup `define`), so the test checks the token's shape
  and its position, not a real version.

## Known issues and limitations

- Todo 021 is described above. The out-of-scope sibling with the same false premise is the
  `src/lib/api-server.ts::createApiServer` docblock ("Only expose generated tools").
  *(Resolved, sibling included — see Resolved Todos.)*
- Todo 022 (P3): the test now holds a third copy of the startable-server stub. *(Resolved —
  `stubServerFactory`; see Resolved Todos.)*
- `sanitizeDescription` does not collapse whitespace padding. This is accepted because the input
  is trusted and capped.

## Testing summary

- **Added:** three e2e cases in `src/lib/extensible/tool-wrapper.e2e.test.ts`, run through
  `connectInMemory` and `listTools`: line 1 and the version line, the append after the version
  line, and the append composed with the `baseUrl` schema. Six cases in
  `src/lib/extensible/mcp-curl-server.test.ts`: attack codepoints stripped with ordinary text kept,
  the sanitised append registered at `start()`, exactly-cap accepted, cap+1 throws and changes
  nothing, warns when disabled, no warning when enabled. `src/lib.test.ts` gains the export name.
- **Mutation probes, each restored from a `cp` backup and verified byte-identical with `cmp`:**
  removing the sanitise, the reject, the warning, the composition or the version line each fails
  named tests.
- **Full suite:** `npx vitest run --reporter=json` → 1525 total, 1518 passed, 0 failed, 7 skipped.
  **Runner caveat:** `/sixees-workflow:work` does not treat vitest's machine-readable mode as a
  trusted verdict, so this run formally applied **no test verification**. The operator's own run is
  the test floor before the push.
- **Build:** `npm run build` passes. There is no lint script. `tsc --noEmit` over the whole tree
  reports type errors in test files this branch does not touch (`post-processor.test.ts`,
  `schema.test.ts`, `lib.test.ts` line 82, a `BeforeRequestResult` generic). I did not establish
  whether they predate the branch.

## Commit history

```
530c0a8 docs(review): Surface 2 record and todos 021, 022 for PR-3
b6a3e92 docs(configuration): curlExecuteDescriptionAppend and the version line
a65e33f feat(curl_execute): version line and embedder description append
```

## Review context

Suggested order: `curl-execute.ts` (version line), `sanitize.ts` (cap), `mcp-curl-server.ts`
(`configure`, `start`), `tool-wrapper.ts` (composition), tests, docs. Invariants touched: 11
(additive, MINOR), 10 (layering), 1a (not engaged, since the append is trusted config). Depends on
PR-1 (`connectInMemory`), which has landed. PR-4 documents these `configure()` throws and bumps to
5.1.0.

## Follow-up work

- [x] Operator: decide todo 021 (before merge, or as a follow-up) — fixed on this branch
- [x] Operator: decide todo 022 — fixed on this branch
- [ ] PR-4: CHANGELOG `5.1.0` entry must mention that the description bytes now change every release

### Outstanding Todos

| file | priority | description | source |
|---|---|---|---|
| 021 | P2 | the description append is shown on a disabled curl_execute; the warning and the doc claim otherwise | Surface 2 review (architecture-strategist) — *resolved, see below* |
| 022 | P3 | the startable McpServer stub is rebuilt in each describe block | Surface 2 review (pattern-recognition-specialist) — *resolved, see below* |

### Resolved Todos

| id | title | summary | by | date |
|---|---|---|---|---|
| 021 | the description append is shown on a disabled curl_execute | `registerCurlToolWithHooks` composes the append only when `enabled` (Option 1); e2e test `leaves the append off a disabled tool, which is still listed` added and its teeth probed; `docs/configuration.md`, the `registerToolsOnServer` docblock and the `api-server.ts::createApiServer` example corrected | Claude Code | 2026-10-26 |
| 022 | the startable McpServer stub is rebuilt per describe block | `tool-capture.test-fixture.ts::stubServerFactory` extracted; the three `beforeEach` blocks call it | Claude Code | 2026-10-26 |

Both todo files were deleted at the operator's direction once resolved.

## Comment sync — 2026-10-26

`/sixees-workflow:sync-comments --branch` audited 14 files. It corrected 5 class B comments,
stripped history from 4 (class D), and downgraded 1 class C doc claim (the disabled-tool bullet,
which the 021 fix has since made true again in its new wording). It changed no code.

## Review Comments Addressed — 2026-10-26

Surface 3, round 1. Requested: CodeRabbit (full review), Codex (scoped `@codex review`), Copilot
(GraphQL `requestReviews`, `union: true`; pre-read empty). Baseline before the requests: 0 open bot
comments. Codex was still `running` at the read after the 15-minute wait, so its output belongs to
the next round.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| The handoff still says the append reaches a disabled tool and asks for a fix to closed todo 021 | coderabbitai (Minor → P3, in scope) | Fix needed (documentation) | Annotated the four stale passages as resolved and ticked the two follow-up checkboxes; nothing deleted |

### Declined Findings

None this round. Copilot's review body graded the PR "🔵 Needs a closer look" only because the test
run is uncertified, and filed no issues. That is the operator's `npm test` gate, already stated in
the PR body, not a finding. CodeRabbit's `✅ Action performed` is an acknowledgement.

### Decisions Revised

None.

### Files Modified

- `docs/work/handoff-feat-curl-execute-description-append.md`
