# Work Handoff: release 5.1.0 (config-error docs and version bump)
**Date:** 2026-10-26 | **Branch:** `docs/release-5.1.0` | **Plan:** `docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md` | **Status:** partial: tasks 15–16 are implemented, but Surface 2 filed three in-scope P2 todos (021–023), and they wait on the operator before push
**Plan slice:** PR-4

## Summary

This is the last slice of the embedder-persona plan. It adds the documented pattern for reporting a configuration error inside an MCP session, instead of exiting before a client connects (plan item 2, task 15). It also releases 5.1.0 (task 16): the version is bumped in `package.json` and `package-lock.json`, and the `[Unreleased]` block that PR-1 started becomes `[5.1.0] - 2026-10-26`, with the entries PR-2 and PR-3 did not write. No production code changed.

## What was implemented

- **`docs/getting-started.md` → *Reporting a configuration error*** (after *Adding Configuration*). Config loading and `configure()` go inside one `try`. On failure, a first `beforeRequest` hook returns `{ shortCircuit: true, response, isError: true }` only for `curl_execute`, and then `start()` runs anyway. The section carries the plan's three caveats (never echo a value; custom tools bypass hooks; a schema error precedes hooks) and links to `docs/hooks.md#short-circuit-pattern` rather than restating the wrap. The snippet type-checks against `src/lib.ts` under `tsc --strict`.
- **`CHANGELOG.md` `[5.1.0]`.**
  - *Notes:* the declines that affect embedders: no origin pinning, no hooks on `utilities()`, no configurable `serverInfo`.
  - *Added:* `rateLimit`, `curlExecuteDescriptionAppend`, and the getting-started section.
  - *Changed:* PR-1's two BREAKING bullets, then the version line, including that the description now changes every release.
  - *Fixed:* PR-1's `baseUrl` entry, unchanged.
  - No empty `[Unreleased]` heading is kept, which matches every earlier release.
- **Version:** `npm version 5.1.0 --no-git-tag-version`, which updates both manifest files and creates no tag.
- The plan's last acceptance criterion is ticked. Its first clause (the `executeRequest({ url })` examples and test) was already met by PR-1.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Build on the existing `[Unreleased]` block rather than write a fresh 5.1.0 entry | PR-1 already wrote its entries there; rewriting them would lose reviewed text | A new entry from scratch (rejected) |
| 5.1.0 (MINOR) stands | `[Unreleased]` already records "shipped in a MINOR release by decision" (operator, 2026-10-21) | 6.0.0, per #46's `!` subject; not reopened (see todo 023 for where the decision should be recorded) |
| Drop the empty `[Unreleased]` heading | `release-guards` reads only the top `## [` section, so an empty one there makes it check nothing; earlier releases ship without one | Keep it (Keep a Changelog style) |
| Bump via `npm version` | It updates `package-lock.json` too, which the plan did not name | Hand-editing `package.json` only |
| Link to `docs/hooks.md` for the short-circuit mechanics | One owner per fact | Restate the wrap paragraph |

## What to pay attention to during review

- **Todo 021:** a failed `configure()` leaves `baseUrl` unset, so the documented pattern's commonest call (a relative `url`) is answered with a schema error, not the reason. The snippet was type-checked but never run end to end.
- **Todo 023:** `dist/` is tracked and was not rebuilt in the release commit; the working tree holds an uncommitted 5.1.0 build.
- **Todo 022:** the CHANGELOG Notes credential sentence lost its "so it stays out of the transcript" reason.
- The `**BREAKING:**` bullets are bold bullets, not a `### BREAKING` heading, so `findUnbackedBreakingChange` does not see them. Teeth probe run this session: a planted `### BREAKING` heading in `[5.1.0]` fails the guard, and the file was restored and verified with `cmp`.

## Known issues and limitations

- Todos 021, 022 and 023 are open (see Code Review below).
- Under `noImplicitReturns` the snippet's hook arrow gives TS7030 ("Not all code paths return a value"). This repo does not enable the flag, and the `docs/hooks.md` examples have the same shape. Not filed.
- The security reviewer notes that YAML endpoint tools also bypass hooks; the caveat list names only custom tools. Not filed (a note, not a finding).
- The new H2 is sentence case; the sibling docs use Title Case. Cosmetic, not filed.
- The todo ids 021 and 022 were used before, by PR-3's todos, which were deleted on that branch. The PR-3 handoff and #48 still mention those numbers. This is an accepted cost under `skill: file-todos` → *Moving and deleting todos is the operator's*.

## Testing summary

- Tests added: none (docs and release only).
- `npx vitest run --reporter=json` at `a2d4b9b`: 1527 total, 1520 passed, 0 failed, 7 skipped. **Not a certified verdict:** the work command does not trust vitest's machine-readable mode, so this run applied no formal test verification. Run `npm test` before authorising the push.
- `npm run build` passes. There is no lint script.
- Manual checks:
  - The snippet passes `tsc --strict` against `src/lib.ts`, and fails only with `--noImplicitReturns`.
  - The release-guard teeth probe (above).
  - `npm pack --dry-run` ships only the seven consumer docs.

## Commit history

```
a2d4b9b chore(release): 5.1.0
8f74274 docs(getting-started): report a configuration error inside the session
```

## Review context

Suggested order: the `CHANGELOG.md` `[5.1.0]` block, then `docs/getting-started.md`, then the manifests. The earlier slices are PR-1 #46, PR-2 #47 and PR-3 #48.

## Follow-up work

- [ ] Operator dispositions todos 021–023 before push.
- [ ] Tag `5.1.0` after merge, if wanted (signed, annotated, bare number, per the release convention).
- [ ] `/sixees-workflow:file-lessons --flush` for the staged RC in `docs/work/RC/` (from PR-3).

### Outstanding Todos

| file | priority | description | source |
|---|---|---|---|
| 021-p2-config-error-pattern-loses-baseurl-when-configure-throws | P2 | A failed `configure()` leaves `baseUrl` unset, so relative calls get a schema error, not the reason | Surface 2 (architecture-strategist) |
| 022-p2-credential-guidance-omits-that-defaultheaders-go-to-every-host | P2 | The credential advice reads as host scoping; it dropped the transcript reason | Surface 2 (security-sentinel) |
| 023-p2-release-version-disagrees-with-the-artefacts-that-restate-it | P2 | `dist/` not rebuilt in the release commit; the invariant 11 exception is not recorded | Surface 2 (pattern-recognition-specialist, architecture-strategist) |

### Resolved Todos

| id | title | summary | by | date |
|---|---|---|---|---|

## Code Review — 2026-10-26

**Certification:** complete
**Roster closure:** closed. unresolved: pattern-recognition-specialist → "whichever reviewer owns that lane"

Agents (8): learnings-researcher, code-simplicity-reviewer, security-sentinel and data-integrity-guardian (floor); typescript-reviewer, performance-oracle, architecture-strategist and pattern-recognition-specialist (configured). All returned. There were 4 classes from 3 reviewers, merged to 3 (two `convention-drift` classes shared `package.json::version`): P1 0, P2 3, P3 0. All 3 are in scope and filed `pending`. Rejected: 0. Escalated: 0.

**Handoff assessment:** this handoff was written after the review, so there was no builder claim to test in advance. The builder's (this run's) self-check missed 021 (the snippet was type-checked but not run) and the tracked `dist/` (023).

| Severity | Category | Todo |
|---|---|---|
| P2 | misplaced-decision (docs) | 021 |
| P2 | leaked-secret (docs guidance) | 022 |
| P2 | convention-drift (release artefacts) | 023 |

| Claim checked | Result |
|---|---|
| Suite green | 1527/1520/0/7 (JSON reporter, uncertified) |
| Release guard reads only the top section, with teeth | Confirmed by probe |
| Tarball ships only the consumer docs | Confirmed (`npm pack --dry-run`) |
| Snippet type-checks | Under `--strict` yes; under `--noImplicitReturns` no |

Learnings: RC-5, RC-36, RC-4 and RC-54 were surfaced as Known Patterns. No `Class` matched a merged class, so nothing was escalated.

**Blockers:** none at P1. Three in-scope P2 todos await the operator.
