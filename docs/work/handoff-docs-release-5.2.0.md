# Work Handoff: 5.2.0 release — description trim, docs, CHANGELOG, version
**Date:** 2026-10-29 | **Branch:** docs/release-5.2.0 | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** complete — all five tasks landed. The Surface 2 review filed four todos (two P2, two P3) for the operator; none is fixed on this branch.
**Plan slice:** PR-5 (tasks 17, 18, 19, 20, 21)

## Summary

This is the release slice of the 5.2.0 plan. The code behaviour shipped in PRs #50–#53: the host list, per-hop redirects, header sync and one refusal shape. This branch:
- tells the model and the embedder about that behaviour;
- writes the CHANGELOG with its `**BREAKING:**` bullets;
- stages the two RCs the plan called for;
- bumps the version to 5.2.0 and rebuilds `dist/`.

The `curl_execute` description lost the text the input schema already carries. The facts that lived only in the dropped text moved into the schema.

## What was implemented

- **Task 17: the description trim** (`src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`).
  - Removed: the 2-line filler paragraph, *Args*, *jq_filter Syntax* and *jq_filter Validation*, and 6 of the 8 examples.
  - Kept:
    - line 1;
    - the response-contract paragraphs;
    - *Returns*;
    - *Error Handling*, which carries a pinned phrase;
    - *Temp File Lifecycle*;
    - the version line.
  - Size went from 6696 to 2633 bytes and from 111 to 52 lines. I measured this from the imported object with a temporary vitest file, deleted afterwards.
  - `src/lib/server/schemas.ts::CurlExecuteSchema`:
    - `include_headers` now says capture needs macOS, gives the cap as `min(64KB, max_result_size)` (it said "64KB" before), says redirects leave only the final hop's headers, and says header text carries credentials verbatim.
    - `follow_redirects` and `max_redirects` state the per-hop gate, the method rewrite, the cross-origin header rule and the cap as a refusal.
  - `src/lib/resources/documentation.ts`: the parameter table gained a `max_redirects` row and new redirect and header text. It also stopped saying headers are "prefixed to the returned text".
- **Task 18: docs.**
  - `docs/configuration.md` gained:
    - an *allowedHosts* section, including the YAML `generatorConfig.baseUrl` sentence the operator approved and the fact that the shipped binary has no such setting;
    - `syncFromHeaders`, with the cURL 7.84 floor and no version check;
    - a *Local refusals* section;
    - corrected *baseUrl* and *defaultHeaders* text, the rateLimit refusal text, the unknown-key throw, and the version-line "search for it" rule.
  - `docs/hooks.md` gained *What `curl_execute` hooks see*.
  - `README.md`: Security bullets.
  - `src/lib/types/public.ts`: the `allowedHosts` doc-block no longer says redirect hops are unbounded.
- **Task 19:** `CHANGELOG.md` `[5.2.0]`:
  - *Notes*: the MINOR decision, the reversal of the 5.1.0 decline, and the declined list.
  - *Added*: three entries.
  - *Changed*: seven `**BREAKING:**` bullets, each with "To adjust:", plus the description trim.
  - *Fixed*: todo 007.
  - There is no `### BREAKING` heading.
- **Task 20:** two RCs are staged, unnumbered, in `docs/work/RC/`. The operator approved both on 2026-10-29. They are not committed (see *Known issues*).
- **Task 21:** `package.json` and `package-lock.json` are at 5.2.0, and `dist/` is rebuilt; `SERVER.VERSION` is `"5.2.0"` in `dist/chunk-CVSUWVOF.js`. The operator approved the rebuild. Their earlier uncommitted `dist/` is backed up in the session scratchpad. There is no tag; the tag follows the merge.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Rebuild `dist/` over the operator's uncommitted build | The operator chose it at the Step 3 audit ("rebuild dist, all good"). A release commit must carry its own version (todo 023) | Skip the rebuild; abort |
| Add the YAML `generatorConfig.baseUrl` sentence | The plan's default answer to its open question asks for it; the operator approved | Leave it out, as task 18 listed |
| Moved facts go into the schema `.describe()`, not the description | The schema is sent with the tool list anyway; one model-facing owner per parameter | Keep them in the description |
| Fix the stale "prefixed" row and the 64KB cap while moving text | K-7: both sat in text this branch rewrote | Leave them for a later pass |
| Keep the RC-63 sentence order in the description | The plan says a test pins it. None does, but the order is still the right one | — |
| RCs staged, not committed | `docs/work/RC/` is not gitignored here, and an unnumbered entry is not ledger content | Commit them for reviewers to read |

## What to pay attention to during review

- **The CHANGELOG's `**BREAKING:**` bullets are claims about 5.1.0 behaviour.** These came from the plan's research and were not re-measured on this branch:
  - cURL's `-X POST` resent a body-less POST;
  - `-L` reported every hop's headers;
  - `//` was a `-32602`.
- **Docs are the change here, and the review found the docs drift.** Todo 025 lists the copies that already disagree with the code, including the README's `Accept*` and the *Local refusals* table. They are unfixed on this branch.
- `dist/` is a full rebuild. Six files are renamed chunks, and the diff is large but generated.

## Known issues and limitations

- Todos 024–027 are open from the Surface 2 review (below). Todo 025 means the release docs, as committed, contain statements that are slightly wrong. Fixing 025 and 026 before merge is cheap.
- **The two staged RCs are untracked**, in `docs/work/RC/`. They reach the ledger only when `/sixees-workflow:file-lessons --flush` runs, ideally before the merge. Todo 024's first option is exactly that flush.
- The plan's statement that a test pins RC-63's sentence order in the description was false. Only `processor.ts` carries the order. This is a plan error and gets no RC.
- `CHANGELOG.md`'s date is 2026-10-29, the day of writing. If the merge lands later, adjust it.

## Testing summary

- No tests were added. Every change is prose, a version number or a rebuild. The existing pins on the description held: `register-all-tools.test.ts` (three phrases) and `tool-wrapper.e2e.test.ts` (line 1, last line, append).
- **Verdict:** `npm test -- --reporter=json --outputFile=<scratchpad>/vitest.json` (the declared `npm test`: `tsc --noEmit`, then `vitest run`). The artefact shows `success: true`, 1773 total, 1766 passed, 0 failed, 7 pending, and 0 failed suites.
- `npm run build` succeeds.
- `src/lib/release-guards.test.ts` passes (14 tests), including the BREAKING guard and the tarball doc list.
- **Gaps:** nothing ties the schema describes or the documentation resource to `CROSS_ORIGIN_FORWARDED_HEADERS`, `FOLLOWED_REDIRECT_STATUSES` or `LIMITS` (todo 025).

## Commit history

```
8522ae0 Release 5.2.0: version bump and rebuilt dist
1ccae6b Write the 5.2.0 CHANGELOG entry
67ccc62 Document the host list, per-hop redirects, header sync and refusals
744c829 Trim the curl_execute description to what the schema cannot say
```

Every commit was made with `git -c core.hooksPath=/dev/null`; no hooks are configured in this repository.

## Review context

- **Suggested order:**
  1. `CHANGELOG.md` `[5.2.0]`;
  2. `src/lib/server/schemas.ts` and the description in `src/lib/tools/curl-execute.ts`;
  3. `docs/configuration.md` → *allowedHosts* and *Local refusals*;
  4. `docs/hooks.md`;
  5. README.

  Skip `dist/`.
- Invariants: 11 (MINOR-vs-break; todo 024), 2 (per-hop gate order, as documented).
- RCs: RC-36, RC-63, RC-66.
- Depends on #50–#53, all merged.

## Follow-up work

- [ ] Flush the staged RCs (`/sixees-workflow:file-lessons --flush`) before the merge.
- [ ] Decide todos 024–027; 025 and 026 are small enough to fix on this branch.
- [ ] After the merge: a signed, annotated tag `5.2.0` (bare number), on the operator's say.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| docs/todos/024-p2-minor-override-of-invariant-11-recorded-only-in-changelog.md | P2 | Invariant 11 still reads as absolute | architecture-strategist |
| docs/todos/025-p2-redirect-and-refusal-facts-restated-by-hand-have-drifted.md | P2 (P3→P2 via the RC-36 alias) | Copies of redirect and refusal facts already disagree with the code | pattern, simplicity, architecture, security |
| docs/todos/026-p3-host-policy-docblocks-say-redirect-hops-are-not-checked.md | P3 | `HostPolicy` JSDoc contradicts per-hop gating, shipped in `dist/` | security-sentinel |
| docs/todos/027-p3-description-temp-file-lifecycle-promises-deletion-it-does-not-do.md | P3 | Description promises deletion `output_dir` does not get | data-integrity, simplicity |

### Resolved Todos

None. The input was a plan slice. Todo 007, which this release's CHANGELOG lists as fixed, was closed by PR-3.

## Code Review — 2026-10-29

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; pattern-recognition-specialist → "whichever reviewer owns that lane"

**Scope:** base `0933d3e` (`git merge-base --fork-point origin/HEAD HEAD`; origin/HEAD = main) .. HEAD: 4 commits and 29 file entries, 18 of them `dist/`.

**Agents used (8):**
- Floor: learnings-researcher, code-simplicity-reviewer, security-sentinel and data-integrity-guardian.
- Optional: typescript-reviewer, performance-oracle, architecture-strategist and pattern-recognition-specialist.

All returned, and none failed. Each `v1` reviewer named both lens subjects. code-simplicity, data-integrity, typescript and architecture have no Bash, and each declared that it judged its files whole.

**Findings:** 4 classes after merging: P1 0 · P2 2 · P3 2.
- Filed: 4. Declined: 0. Investigate-first: 0. Rejected: 0. Escalated: 0.

**Merge note:** three classes share the anchors `CURL_EXECUTE_TOOL_META` and `CurlExecuteSchema`. Each anchor is a single large string or object, so overlap there is not evidence of one defect. I merged by defect instead, and each todo records its aliases.

**Handoff assessment:** no handoff existed when the review ran. This file was written by the work run in the same session, after the review.

### Key findings

| Severity | Class | Category | Todo |
|---|---|---|---|
| P2 | convention-drift: MINOR override of invariant 11 recorded only in the CHANGELOG | architecture / versioning | 024 |
| P2 (P3→P2 via RC-36 alias `broken-contract`) | duplicated-logic: redirect and refusal facts restated by hand, already drifted | docs / tool description | 025 |
| P3 | stale-comment: `host-policy.ts` docblocks say hops are unchecked, shipped in `dist/` | docs / security | 026 |
| P3 | unretained-pii (alias dead-code): the lifecycle block promises deletion `output_dir` does not get | tool description | 027 |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Tests pass | declared `npm test` with the JSON reporter | 1766 passed, 0 failed, 7 skipped |
| Build passes | `npm run build` | succeeds; `dist` VERSION is 5.2.0 |
| Description keeps line 1, version line, pinned phrases | typescript-reviewer, the test pins | holds |
| Schema describes match code | typescript-reviewer, pattern-recognition-specialist, security-sentinel | hold; drift is in docs and README (todo 025) |
| Release consistency | architecture-strategist | `package.json`, lock and `dist` all at 5.2.0 |

### Outstanding todos

See the *Outstanding Todos* table above.

**Open classes without a todo:** none.

**Blockers:** none (no P1, and nothing awaiting the operator from the review).
