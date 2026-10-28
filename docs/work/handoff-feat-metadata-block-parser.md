# Work Handoff: feat-metadata-block-parser

**Date:** 2026-10-28 | **Branch:** feat/metadata-block-parser | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** in-review
**Plan slice:** PR-2

Created during review, not by the work run's Step 6. `/sixees-workflow:work --pr-key=PR-2` ran this review at its Step 5. The operator has decided the escalation below (Option 1, see *Review fixes*); the work-handoff schema has not been written yet.

## Code Review — 2026-10-28

**Certification:** complete
**Roster closure:** closed. Unresolved: data-integrity-guardian → "Anything else outside your lane gets one line under `notes:` and no finding". performance-oracle → "Anything genuinely outside your lane gets one line under `notes:` and no finding". security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding". pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane".

**Scope:** f37e51b..HEAD, resolved with `git merge-base --fork-point origin/HEAD HEAD`: 2 commits, 12 files, all modified.

**Agents used (8 of 8 returned):**

| Agent | Role | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| security-sentinel | floor | v1 | clean | 0 | traced remote fields to the separator-count parse and `syncHeaderName` to the `-w` format; both lenses named |
| code-simplicity-reviewer | floor | v1 | findings | 1 | no Bash; judged all 12 files whole (declared) |
| data-integrity-guardian | floor | v1 | findings | 1 | no Bash; judged files whole (declared); no datastore, judged the saved response file |
| learnings-researcher | floor | none | done | — | 10 known patterns (RC-1, 2, 15, 17, 19, 30, 31, 32, 35, 64) |
| typescript-reviewer | optional | v1 | findings | 2 | no Bash; judged 11 TS files whole (declared) |
| performance-oracle | optional | v1 | clean | 0 | window scan linear and fixed-size; all four regexes non-backtracking |
| architecture-strategist | optional | v1 | findings | 1 | no Bash; judged files whole (declared) |
| pattern-recognition-specialist | optional | v1 | findings | 3 | jscpd + rg |

**Finding counts:** 5 classes after merging (8 reviewer classes). P1: 1, P2: 1, P3: 3. All 5 in scope and filed. Rejected: 0. Declined: 0. Investigate-first: 0.

**Merges:** the field-layout class merges four reviewers' classes on shared confirmed instances (`CurlArgsParams`, `ParseMetadataOptions`): architecture `misplaced-decision` P2, typescript `broken-contract` P3, pattern `duplicated-logic` P3, simplicity `unused-extensibility` P3. The sync-value and saved-artefact classes also cite `parseResponseWithMetadata` / `LIMITS`, but those symbols carry several distinct defects, so they were kept separate rather than collapsed into one class; 026 depends on 024.

**Escalations from the ledger (§4.1):**
- 024 `misplaced-decision`: P2 → **P1**, matching RC-19's `Class` (alias `broken-contract` matches RC-17/RC-35). The match is on the defect noun; RC-19's subject is bound sizing, so the operator may weigh it.
- 025 `fail-open-default`: P3 → P2, matching RC-31 (also RC-1, RC-64). **Recurred.**

**Handoff assessment:** no builder handoff existed. The commit bodies are accurate. One builder miss: plan task 13 refuses `%` in the sync header name, and the `HTTP_FIELD_NAME` grammar this branch added accepts it (in 024). The builder disclosed the gitignored ARCHITECTURE.md edit in the docs commit body.

### Key findings

| Severity | Category | Todo |
|---|---|---|
| P1 | misplaced-decision: the `-w` field layout is decided by two unrelated inputs; name grammar weaker than plan task 13 | 024 |
| P2 | fail-open-default: a saved file claims exact origin bytes when the boundary was not found (recurred: RC-31) | 025 |
| P3 | untyped-boundary: `syncHeaderValue` leaves the parser as raw text | 026 |
| P3 | duplicated-logic: the URL control-byte set exists twice | 027 |
| P3 | convention-drift: test suites restate the separator literal | 028 |

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Full suite passes | `npx vitest run`, human-readable output: 45 files, 1619 passed, 7 skipped; `tsc --noEmit` clean | Read from the summary line, not a structured verdict |
| Each field bound has teeth | Teeth probe per bound, check and the window (9 mutations), restored from `cp` backups and `cmp`-verified | Holds |
| The fixture matches what cURL writes | Builder test expands the real `-w` format; real cURL 8.7.1 on a loopback server wrote the same field order, with empty `redirect_url` and absent header as empty fields | Holds |
| P1 sweep | Re-ran `rg -n 'syncHeaderName\|syncHeader\b\|parseResponseWithMetadata\(\|buildCurlArgs\(' src -g '!*.test.ts'` | Reproduced: 2 decision sites, 1 composition site |
| Plan task 13 refuses `%` | Read the plan | Holds; `HTTP_FIELD_NAME` accepts `%` |

**Test verification:** none certified. Vitest is not a runner this workflow trusts for a structured verdict, so the operator's own test run before any push is the test floor.

### Outstanding todos (from this review)

| Todo | Priority | Status |
|---|---|---|
| 024 | P1 | pending |
| 025 | P2 | pending |
| 026 | P3 | pending |
| 027 | P3 | pending |
| 028 | P3 | pending |

**Classes open without a todo (escalated or investigate-first):** none.

**Blockers:** P1 todo 024. `/sixees-workflow:work` escalates every P1, so it waits for the operator: fix on this branch (Option 1, one layout source and `%` refused; or Option 2, defer the sync slot to PR-4), or decide otherwise.

**Out-of-lane notes carried from reviewers (not findings):**
- `docs/architecture/architecture.md` → *Security* → "Metadata separator" still says the separator splits the body from `%{content_type}` (pattern).
- `parseResponseWithMetadata`'s doc lists three invariant-13 rules; the local ARCHITECTURE.md lists four (architecture).
- `HTTP_FIELD_NAME` is re-exported from `config/security/index.ts` but imported by path (typescript, simplicity).
- `redirectUrl` admits C1 and bidi characters; PR-3 must run the full URL gate on it (security).

## Review fixes — 2026-10-28

The operator asked for todos 024–028 to be handled and their files removed.

| Todo | Disposition | Commit |
|---|---|---|
| 024 | Fixed (Option 1): `buildCurlArgs` and `parseResponseWithMetadata` take one `MetadataBlock`; `types/common.ts::metadataDirectives` is the only statement of the layout. The name grammar is `WRITE_OUT_HEADER_NAME`, tchar without `%`. The sweep now returns one decision site. | 7e911b4 |
| 025 | Fixed (Option 1): `processResponse` reads `contentTypeUndetermined` at the claim, and the saved message says the file may hold metadata written after the body. | 4d193b2 |
| 026 | Fixed (Option 1): the parser returns `syncHeaderCount`, digits with optional SP/HTAB up to 2^31, else absent. Diverges from plan task 6's `syncHeaderValue` name; PR-4's task 14 parse is already done here. | 7e911b4 |
| 027 | Fixed (Option 1): `utils/url.ts::URL_CONTROL_CHARACTER` builds both checks; a table test holds them to one answer. | 7e911b4 |
| 028 | Fixed (Option 1, wider): both suites import `METADATA_SEPARATOR`. The RC-35 caveat did not bind `register-all-tools`: its factory reads the binding lazily, as `size-and-save`'s already did. | 7e911b4 |

Todos 024–028 are deleted.

**Tests:** full suite 45 files, 1620 passed, 7 skipped, read from vitest's summary line (not a certified verdict). `tsc --noEmit` clean. The four consumer suites each pass run alone (35, 55, 14, 54). Teeth probes: `%` accepted, a fixed field count, an unbounded count, a newline-trimming count, a narrowed control class and the claim ignoring the flag each failed a named test; files restored and `cmp`-verified.

**Not re-reviewed:** these fixes are newer than the Surface-2 review above (K-16).
