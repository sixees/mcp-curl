# Work Handoff: docs+scripts: architecture overview, audits, integration test, deferred todos

**Date:** 2026-04-30 | **Branch:** docs/architecture-and-followups | **PR:** #22 | **Status:** in-review

> This handoff was created during PR comment review — the original work did not include one.

## Summary

Rescues branch-unique work that lived as untracked files / committed todos on the now-deleted `feat/prompt-injection-defense` branch (which was already squash-merged as PR #20 and superseded by PR #21). PR #22 contains no source changes — only documentation, deferred todos, and an integration test script. Branch was reset to `origin/main`, then unique items were re-added as a single commit so future history is clean.

## What was implemented

### Documentation
- **`docs/architecture/architecture.md`** — full architecture overview produced by `/sixees-workflow:architect` (entities, request lifecycle, security model, ADRs). Referenced from `CLAUDE.md`.
- **`docs/axon-brainstorm.md`** — Axon (AI Access Layer) product brainstorm. Captures the "deterministic OpenAPI → typed MCP tool" framing that came out of the agent-native synthesis work.
- **`docs/upstream-contributions.md`** — fork → upstream contribution audit identifying 7 fork-ahead changes worth upstreaming back from the `mcp-pagespeed` fork (URL-parser hardening, helper re-exports, regression coverage).

### Scripts
- **`scripts/integration-test.mjs`** — stdio MCP integration test that lists tools and exercises `curl_execute` end-to-end against the Google PageSpeed API.

### Deferred todos
- `docs/todos/cache-utilities.md` — obsoleted at PR review (see Resolved Todos below).
- `docs/todos/configure-unknown-fields.md` — obsoleted at PR review (see Resolved Todos below).
- `docs/todos/readme-register-custom-tool-sanitize-example.md` — refined at PR review (see Changes Made below).

The fourth originally-rescued todo (`is-binary-content-type-location.md`) was dropped at branch-reset time — its proposed refactor was already complete on `main`.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Reset stale branch to `origin/main` and re-commit only unique work | The old branch's `src/` was strictly older than main (PR #20 squash-merge + PR #21 refinements superseded it). Rebasing would surface false conflicts and risk reverting fixes. | Cherry-pick: same end state but more work. Force-push rebased branch: same destructive footprint but kept a misleading branch name. |
| Rename branch to `docs/architecture-and-followups` | New contents are general docs, not prompt-injection-defense work. Branch name should match contents. | Keep `feat/prompt-injection-defense` — rejected because the branch no longer holds prompt-injection work. |
| Drop `docs/todos/is-binary-content-type-location.md` at reset | The proposed refactor (move `isBinaryContentType` to `utils/`) is already done on main in `src/lib/utils/content-type.ts`. | Keep file — would have triggered immediate PR feedback for being obsolete. |

## What to pay attention to during review

- **Repository fit for `axon-brainstorm.md` and `upstream-contributions.md`** — both reference adjacent but distinct concerns (Axon is a different product surface; upstream-contributions describes a private fork). Reviewer (gemini-code-assist) flagged both as candidates for relocation. Surfaced to user as a decision conflict.
- **Stale TODOs at rescue** — `cache-utilities.md` and `configure-unknown-fields.md` were rescued from a branch where the underlying work hadn't been done yet. Both are now obsolete on main; verified and resolved during this review pass.
- **Integration test reliability** — `scripts/integration-test.mjs` initially used a greedy regex for JSON extraction and silently passed on non-Lighthouse responses. Reviewers caught both. Tightened during this pass.

## Review Comments Addressed — 2026-04-30

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Unused `printJson` helper | @github-code-quality | Fix needed | Removed the dead function from `scripts/integration-test.mjs` |
| Greedy JSON regex `\{[\s\S]+\}` may overshoot when output contains stray braces | @gemini-code-assist | Fix needed | Replaced with `extractJsonBlock(text)` using `indexOf("{")` + `lastIndexOf("}")`; surrounding metadata no longer contaminates the parse |
| Non-Lighthouse responses silently pass with exit 0 | @chatgpt-codex-connector | Fix needed | The `!lhr` branch now logs the upstream payload and throws — `process.exitCode` is set to 1 via the `main().catch()` handler |
| MD038: spaces inside inline code span at architecture.md:170 | @coderabbitai | Fix needed | Switched the offending span to double-backticks: ``` ``args.push("-H", `${key}: ${value}`)`` ``` — eliminates the nested-backtick parsing ambiguity |
| Cache-utilities TODO is outdated — `utilities()` already caches post-`start()` | @gemini-code-assist + @coderabbitai | Fix needed (completion) | Verified `mcp-curl-server.ts:313–321` caches `_utilities` after first call. Recorded in Resolved Todos and deleted the TODO file |
| Configure-unknown-fields TODO is stale — `configure()` already validates against `KNOWN_CONFIG_KEYS` and warns | @gemini-code-assist + @coderabbitai | Fix needed (completion) | Verified `mcp-curl-server.ts:119–131` performs key-by-key validation with a warning. Recorded in Resolved Todos and deleted the TODO file |
| README sanitize example misleads about top-level title/description sanitization | @coderabbitai | Fix needed | Rewrote `readme-register-custom-tool-sanitize-example.md` to focus on `inputSchema` field descriptions (the actual gap), explicitly noting that `title`/`description` are sanitized internally |
| MD040: fenced code block missing language at upstream-contributions.md:277 | @coderabbitai | Fix needed | Added `text` language tag |
| Add dist-entry preflight in integration-test.mjs | @coderabbitai | Fix needed | Added `fs.existsSync(serverEntry)` check that fails fast with a "run the build first" message |
| Close MCP client in all paths; avoid early `process.exit()` before teardown | @coderabbitai | Fix needed | Wrapped `main()` body in `try/finally`, replaced `process.exit(1)` with thrown errors inside the flow, and switched the top-level `.catch` to `process.exitCode = 1` so `client.close()` always runs |
| `axon-brainstorm.md` belongs in a separate repo | @gemini-code-assist | Decision conflict | Surfaced to user — same concern was already flagged in the PR description |
| `upstream-contributions.md` is private-fork audit material | @gemini-code-assist | Decision conflict | Surfaced to user — same concern was already flagged in the PR description |

### Decisions Revised

| Original Decision | New Approach | Reason | Reviewer |
|-------------------|-------------|--------|----------|
| TODO file claimed callers must sanitize `meta.title`/`meta.description` | TODO now scopes to `inputSchema` field `.describe()` strings only | The library already sanitizes top-level metadata internally (`mcp-curl-server.ts:274–275`); the unsanitized surface is `inputSchema` field descriptions | @coderabbitai |
| Integration test treated `!lhr` as informational | `!lhr` now fails with non-zero exit | A semantically-failed PageSpeed response (quota / auth / non-Lighthouse JSON) should fail the integration check, not pass it | @chatgpt-codex-connector |

### Resolved Todos

<!-- Recorded before deletion. Files no longer exist in docs/todos/. -->

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| `docs/todos/cache-utilities.md` | Cache `server.utilities()` result | Already implemented on `main` — `McpCurlServer.utilities()` at `src/lib/extensible/mcp-curl-server.ts:313–321` lazily creates `_utilities` once and returns the cached value on subsequent calls; `_utilities` is invalidated on `shutdown()` (lines 405, 489) | Verified at PR #22 review (gemini-code-assist + coderabbitai) | 2026-04-30 |
| `docs/todos/configure-unknown-fields.md` | Validate `.configure()` unknown fields | Already implemented on `main` — `McpCurlServer.configure()` at `src/lib/extensible/mcp-curl-server.ts:119–131` iterates input keys, accepts only those in `KNOWN_CONFIG_KEYS`, and emits a `console.warn` for unknown keys listing the accepted set | Verified at PR #22 review (gemini-code-assist + coderabbitai) | 2026-04-30 |

### Outstanding Todos

<!-- Todos created this pass — see docs/todos/ for full content -->

(none — no new todos created during this review pass)

### Files Modified

- `scripts/integration-test.mjs` — removed `printJson`, added `fs` import + dist preflight, replaced greedy regex with `extractJsonBlock()`, wrapped `main()` in `try/finally`, removed early `process.exit()` calls, made non-Lighthouse responses a hard failure
- `docs/architecture/architecture.md` — fixed MD038 at line 170 (double-backtick code span)
- `docs/upstream-contributions.md` — added `text` language to fenced block at line 277
- `docs/todos/readme-register-custom-tool-sanitize-example.md` — rewrote to focus on `inputSchema` field-description sanitization
- `docs/todos/cache-utilities.md` — **deleted** (work already done on main)
- `docs/todos/configure-unknown-fields.md` — **deleted** (work already done on main)

## Known issues and limitations

- `axon-brainstorm.md` and `upstream-contributions.md` repository fit is unresolved — pending user decision.

## Testing summary

- Tests added: 0 (PR contains no source changes).
- Passing: `npm test` — 485 passed, 7 skipped (run before commit).
- Linting: not run in this pass; markdown lint findings raised by coderabbitai (MD038, MD040) addressed individually.
- Manual testing: `scripts/integration-test.mjs` not re-executed after the rewrite — reviewer can verify locally with `npm run build && node scripts/integration-test.mjs`.

## Follow-up work

- [ ] User decides on the location of `axon-brainstorm.md` and `upstream-contributions.md` (keep / move / drop).
- [ ] Reply to and resolve the 14 review threads (see `sixees-workflow:resolve-pr-comments #22`).
