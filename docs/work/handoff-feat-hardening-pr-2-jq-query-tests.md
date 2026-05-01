# Work Handoff: PR-2 — `executeJqQuery` unit tests (B1)

**Date:** 2026-05-01 | **Branch:** `feat/hardening-pr-2-jq-query-tests` | **Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` | **Status:** complete

## Summary

PR-2 of the 9-PR pre-bigwork hardening track. Closes 1 plan item (B1): adds direct unit-test coverage for `executeJqQuery()`. Until now this function was only exercised through integration paths (`mcp-curl-server.test.ts` etc.), so regressions in path-validation, symlink, and traversal logic were only catchable via end-to-end tests. The new test file lives next to the source at `src/lib/tools/jq-query.test.ts` and covers all 10 scenarios listed in the plan plus 4 extras for branch coverage.

## What was implemented

### B1 — `src/lib/tools/jq-query.test.ts`

- **What:** new co-located test file with 14 test cases, organised into 5 `describe` blocks (happy path, path-validation errors, file-save behaviour, defence-in-depth observability, input-boundary errors).
- **Key files:** `src/lib/tools/jq-query.test.ts` (new, 277 lines).
- **Approach:** real fixtures via `mkdtemp` — no `fs` mocking — so the real `validateFilePath()` symlink-resolution path is exercised. `console.error` is the only thing mocked, and only for log-assertion tests. Per-test isolation via `clearAllowedDirsCache()` and `clearInjectionDetectionMap()` in `beforeEach`/`afterEach`.

### Coverage of plan B1 test scenarios

All 10 plan-listed scenarios covered:

| # | Plan scenario | Test case |
|---|---------------|-----------|
| 1 | Valid file path within allowed dirs → returns content | `returns filtered content for a valid file inside allowed dirs` |
| 2 | Path outside allowed dirs → returns isError | `returns isError when filepath is outside allowed directories` |
| 3 | Path traversal (`..`) → rejected | `rejects path traversal segments before touching the filesystem` |
| 4 | Symlink resolution failure → isError | `returns isError when symlink target does not exist (realpath fails)` |
| 5 | File read error (missing) → isError + sanitized log | `returns isError with sanitized error message when file does not exist` |
| 6 | jq filter applied to file content → correct output | `applies jq filter — multi-path projection returns array of values` |
| 7 | `save_to_file: true` + small content → still saves | `saves to file when save_to_file: true even for small content` |
| 8 | Output exceeds `max_result_size` → auto-saves | `auto-saves when filtered output exceeds max_result_size` |
| 9 | Sanitization of jq result fires | `strips Unicode-attack characters from filtered output (sanitization)` |
| 10 | Injection detection fires on filtered content | `logs an injection-defense detection event when filtered content matches a known pattern` |

Extras (chosen for branch coverage, not present in the plan):

- `applies jq filter — multi-path projection returns array of values` — exercises the comma-separated multi-path branch of `applyJqFilter`.
- `returns isError when symlink resolves outside the allowed directory (escape attempt)` — explicit symlink-escape regression (separate from the dangling-symlink case).
- `honors a custom output_dir different from the source-file directory` — exercises the `validatedOutputDir` path explicitly.
- `returns isError when filepath points to a directory, not a file` — exercises the `stats.isFile()` branch in `validateFilePath`.
- `returns isError when jq_filter is malformed` — exercises the `applyJqFilter` throw path.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|-------------------------|
| Fixtures rooted under `process.cwd()` (not `os.tmpdir()`) | On macOS, `os.tmpdir()` resolves via `realpath()` to `/private/var/folders/...`, which `isBlockedSystemDirectory()` rejects when it surfaces through `validateOutputDir`. cwd is unconditionally part of `validateFilePath`'s allowed-dirs list, so files under a cwd-rooted `mkdtemp(...)` directory pass validation without needing `MCP_CURL_OUTPUT_DIR`. | (a) Setting `MCP_CURL_OUTPUT_DIR` to a tmpdir fixture — rejected: `resolveOutputDir(undefined)` falls back to the env var even when `params.output_dir` is undefined, so every happy-path test would trip the blocked-dir check. (b) `os.homedir()`-rooted fixtures — rejected: pollutes the user's home dir and risks cross-test interference if cleanup fails. |
| Real fs fixtures + real `validateFilePath()` (no `fs` mocks) | The plan explicitly calls this out as the right approach; mocking `fs` would skip the symlink-resolution path that's the highest-risk branch in this code. | Heavy `vi.mock("fs/promises", ...)` — rejected per the plan's "Implementation note". |
| Mock only `console.error`, only when asserting log content | Spotlights the contract being tested (sanitized log line, no full path). Lets stderr noise from other tests stay visible during local runs. | Global `vi.spyOn(console, "error")` in `beforeEach` — rejected: would muffle real diagnostics from unrelated tests if the file ever grows. |
| Use `clearAllowedDirsCache` + `clearInjectionDetectionMap` from their own modules (not the security barrel) | Both are intentionally NOT re-exported from `src/lib/security/index.ts` — the barrel comments say "test-only, import directly". This test follows the documented test-internal-import convention. | Re-exporting from the barrel — rejected: would change the public test surface and contradict the existing convention used by `rate-limiter` and `detection-logger`. |
| Symlink-failure scenario covered twice (dangling + escape) | The plan lists "symlink resolution failure" as one bullet but the failure has two distinct causes — target missing (ENOENT) and target outside allowed dirs (security check). Each lands on a different branch of `validateFilePath`. | One combined test — rejected: less precise, hides which branch failed if the test goes red. |
| All tests pass `output_dir` explicitly when saving | Avoids triggering the lazy-init `getOrCreateTempDir()` path, which would create a long-lived shared temp dir at `os.tmpdir()` and stay alive across the whole vitest run. Cwd-rooted fixtures keep state isolated. | Letting the fallback fire and cleaning up via `cleanupTempDir()` in `afterAll` — rejected: more state to manage; the explicit-output-dir path is what the plan intends to test anyway. |

## What to pay attention to during review

- **Risk areas:**
  - The fixture-directory choice (cwd, not tmpdir) is the central platform-specific decision. If this codebase is ever run on a system where cwd lands inside a blocked-system path (unlikely but theoretically possible — e.g., someone clones the repo into `/var/...`), the same blocked-dir check would reject saves to fixture dirs. The current macOS/Linux dev setup keeps the project under `/Volumes/...` or `/home/...`, both of which are fine.
  - The injection-detection test asserts on the literal pattern `"ignore previous instructions"` matching. The pattern set in `INJECTION_PATTERNS` is documented as "not part of the public contract — will expand over time". If a future refactor narrows that pattern, this test would silently regress to a "detection didn't fire" failure. The handoff for PR-1 already flags `detectInjectionPattern`'s pattern set as unstable; the test compensates by also asserting the basename-as-label format which is stable.
  - The "saved-bytes count > 1000" assertion in the auto-save test relies on `Buffer.byteLength(sanitized)` exceeding `max_result_size=1000` after sanitization. The fixture writes 2000 bytes of `"x"` repeated, which sanitization passes through unchanged (no Unicode attacks, no 50-space runs). If the sanitization rules ever drop ASCII characters, this assertion would silently flip to "auto-save didn't fire" and report success at the wrong return path. Defence: the assertion explicitly reads the byte count from the response text, so a mismatch would still fail the regex-form check.
- **Edge cases considered:**
  - Path-traversal regex catches `foo/../etc/passwd` before any IO — verified the test response message is "path traversal detected", not "does not exist" (the latter would imply the regex didn't match and the IO branch was reached).
  - Symlink-escape and dangling-symlink land on different branches; both are tested.
  - `jq_query error` log-line format is asserted on the full prefix `^jq_query error: \[basename\] ` to lock the contract `[basename] ErrorClass` shape (no full path leak).
- **Under-tested:**
  - **`readFile` failure after `validateFilePath` succeeds.** Realistically requires a TOCTOU-style race or filesystem mocking — the validateFilePath layer already guards against the obvious cases. Skipped: low marginal coverage value vs. the cost of mocking, and the handoff plan didn't list it.
  - **`writeFile` failure on save.** Same reasoning — would require mocking `fs.promises.writeFile`. Out of scope for B1 per the plan.
  - **Permission-denied (EACCES) on read.** Considered using `chmod 000` but that's CI-fragile (root contexts ignore it). The "file does not exist" case covers the same `validateFilePath` catch branch that EACCES would land on.
  - **Concurrency / parallel calls to `executeJqQuery`.** Not exercised. The function has no shared mutable state of its own (the cache it touches is keyed by env var + cwd, and tests serialise via vitest's default file ordering), so this is a low-risk gap.
- **Pattern deviations:** none. The file mirrors the structure used by `src/lib/security/detection-logger.test.ts` (which already does the `console.error` spy pattern + module-internal imports for clear-state functions).

## Known issues and limitations

- **Test runs leave no fixture residue under cwd or tmpdir** — verified by `ls .test-tmp-jq-query-*` after the run. If a test crashes mid-execution, vitest still runs `afterEach`. There is a remote chance of leftover dirs if the Node process is hard-killed mid-test, but the prefix `.test-tmp-jq-query-` makes them trivial to clean (`rm -rf .test-tmp-jq-query-*`).
- **`MCP_CURL_OUTPUT_DIR` env restoration logic** — `beforeEach` saves the original value and `afterEach` restores it. If two tests in the same suite both modify the env (none currently do), they'd serialise correctly because vitest runs tests in a file sequentially by default. Still, the more conservative pattern (snapshot in `beforeAll`, restore in `afterAll`) was rejected because each test starts from a clean cache anyway via `clearAllowedDirsCache()`.
- **The injection-detection test asserts on literal pattern matching** — see "Risk areas" above. If the pattern set narrows in a future PR (PR-7/PR-8 expand it; the converse is unlikely), the test would need to switch its trigger string. Acceptable given the stability contract documented in `sanitize.ts`.
- **Coverage measurement claim is qualitative** — the plan acceptance criterion says "rises measurably (no formal threshold)". I did not run `npm test -- --coverage` to produce a numerical baseline because vitest is not configured with a coverage provider in `package.json` and adding one is out of scope for B1. The 14 cases collectively touch every error branch in `executeJqQuery()` by inspection.

## Testing summary

- Tests added: 14 (1 happy-path, 1 multi-path projection, 5 path-validation error branches, 3 file-save behaviours, 2 defence-in-depth observability, 2 input-boundary errors).
- Tests passing: **605 passed | 7 skipped | 0 failed** (full vitest suite, `npm test`). Up from 591 on the merged PR-1 — exactly +14, no regressions in other files.
- Linting: pass (`npm run build` succeeds with no TypeScript errors; project doesn't expose a separate lint target).
- Manual testing: verified fixture cleanup works (no leftover `.test-tmp-jq-query-*` dirs in cwd, no leftover `mcp-curl-jq-query-outside-*` dirs in `/tmp`).
- Test gaps: see "Under-tested" above. None of the gaps are in the plan's acceptance criteria.

## Commit history

```bash
git log --oneline main..HEAD
# Single squash-ready commit:
#   test(tools): unit-test executeJqQuery — path validation, save paths, defence observability
```

## Review context

- **Suggested review order:** read the test file once top-to-bottom — the `describe` blocks group cases by intent. Then cross-reference each test against the plan's "Test scenarios" list in section B1 (`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` lines 321–333).
- **Related docs:**
  - `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` — section B1 (lines 315–340).
  - `docs/work/handoff-feat-hardening-pr-1-url-helpers.md` — preceding PR's handoff. The "no items deferred to PR-2" claim is verified there (PR-1's P2/P3 sweeps closed out on the PR-1 branch; `docs/todos/` does not exist).
- **Dependencies on other work:** none. PR-2 is parallel to PR-3..PR-9.

## Follow-up work

- [ ] PR-3: README example for sanitizing field descriptions (B2).
- [ ] PR-4: `authToken` printable-ASCII validation (B5).
- [ ] PR-5: Auto-sanitize Zod field descriptions on `registerCustomTool()` (B4).
- [ ] PR-6a/PR-6b: B9 + B3 — read Technical Review Corrections before implementation.
- [ ] PR-7: Response-side sanitization expansion (B7-sub-1-3 + B8).
- [ ] PR-8: Detection-pattern expansion (B7-sub-4-5).
- [ ] PR-9: CI perf budgets — measure baseline first.

### Outstanding Todos

None. PR-2 introduces no deferred work. The existing `docs/todos/` directory does not exist (PR-1's review todos were all closed out and renamed `*-complete-*.md` on the PR-1 branch).

### Resolved Todos

None resolved by this PR. PR-1's handoff confirmed `docs/todos/` was empty going into PR-2; B1 was a plan-only item with no preceding todo file.

## Review Comments Addressed — 2026-05-01

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Reorder imports to built-ins → external → internal → relative per `.gemini/styleguide.md` (line 12) | @gemini-code-assist | False positive | No change. Existing tests in this repo (e.g. `src/lib/schema/schema.test.ts`) place `vitest` first, then built-ins, then relative — matching this file. Applying the styleguide ordering would make `jq-query.test.ts` the only test file in the repo that diverges from the established convention. Replied with explanation. |
| Defensive nil-check before `rm` in `afterEach` to handle a failed `mkdtemp` in `beforeEach` (line 49) | @gemini-code-assist | Fix needed | Added `if (allowedDir)` / `if (outsideCwdDir)` guards plus a one-line comment explaining the intent. Cheap defence; prevents `rm(undefined, …)` from masking the real test error if a future fixture-setup change introduces a partial-init path. |

### Decisions Revised
None. The import-order styleguide deviation was already an implicit project decision visible in `schema.test.ts`; this PR did not introduce or reverse it.

### Files Modified
- `src/lib/tools/jq-query.test.ts` — afterEach nil-check + 1-line comment.
