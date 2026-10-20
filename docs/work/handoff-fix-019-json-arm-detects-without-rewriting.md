# Work Handoff: fix-019-json-arm-detects-without-rewriting
**Date:** 2026-10-20 | **Branch:** fix/019-json-arm-detects-without-rewriting | **Plan:** none (todo 019) | **Status:** complete — 019 and all seven review classes (021–027) fixed, re-reviewed, pushed; version set to 5.0.0 and RCs flushed as RC-63/RC-64; in review on PR #43

> Created by `/sixees-workflow:review` during `/sixees-workflow:work`'s Step 5, before the work
> run's own handoff sections were written. The work run is the author of the rest of this
> schema; this file currently holds the review record only.

## Code Review — 2026-10-20

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding."; pattern-recognition-specialist → "hand it to the reviewer who owns that lane"; pattern-recognition-specialist → "whichever reviewer owns that lane"

**Scope:** `cd006ba..HEAD` (base by `git merge-base --fork-point origin/HEAD HEAD`), commits `1cedbc0`, `01574b4`; 18 modified files.

**Agents used (8, all returned):** learnings-researcher (floor), code-simplicity-reviewer (floor), security-sentinel (floor), data-integrity-guardian (floor), typescript-reviewer, performance-oracle, architecture-strategist, pattern-recognition-specialist.

**Findings:** 7 classes — P1: 2 | P2: 4 | P3: 1. Filed: 7. Declined out of scope: 0. Investigate-first: 0. Rejected: 0. Three severities were raised one level because their `class-id` recurs in the ledger (021, 022, 025/026).

### Handoff assessment

No handoff existed at review time. The builder's in-session account (todo 019 audit, checkpoint) surfaced the BOM edge and the witness change as risks; it did **not** surface that removing the sanitise also blinded detection to invisible-character-split phrases (023), and its own BOM fix chose an instrument (`sanitised === response` short-circuit over `classifyBody`'s trim) that admits 16 Unicode spaces unparsed (021). Its prose sweep used too narrow a query (024).

### Key findings

| Severity | Category | Todo |
|---|---|---|
| P1 | data-integrity — usability shortcut passes Unicode space unparsed | 021 |
| P1 | data-integrity — BOM fallback sanitises the whole payload | 022 |
| P2 | security — detection reads only raw text on JSON arms | 023 |
| P2 | documentation — prose still says JSON is sanitised | 024 |
| P2 | testing — "wrap ran" witness set on fail-open | 025 |
| P2 | data-integrity — not-byte-identical notice incomplete | 026 |
| P3 | dead code — size-gate growth arms and alias | 027 |

### Verified claims

| Claim | Check | Result |
|---|---|---|
| Tests pass | `npm test -- --reporter=json` | 1357 passed, 0 failed, 7 skipped |
| P1 sweeps (021, 022) and 023 | out-of-tree vitest probe against `src/` | all three reproduced |
| `detectAndLog` not on a published entry | `package.json` exports → `src/lib.ts` | confirmed internal |

### Outstanding todos

| Todo | Priority | Status |
|---|---|---|
| 021 | P1 | pending |
| 022 | P1 | pending |
| 023 | P2 | pending |
| 024 | P2 | pending |
| 025 | P2 | pending |
| 026 | P2 | pending |
| 027 | P3 | pending |

**Open without a todo:** none.

**Blockers:** P1 021, P1 022.

## Summary

Todo 019 made this server the middleware RC-49 says it is: a JSON payload is detected on and never rewritten, on every path (body, `jq_filter`, `jq_query`, and the wrap for every tool). The over-cap notice now leads with the saved file being valid to analyse, because the operator's APIs are rate-limited. Surface 2 then found that the first draft fixed the BOM case by rewriting the whole payload, and that its "usable" check passed 16 Unicode spaces unparsed. The fix made the reader as tolerant as the classifier instead of making the bytes fit the reader.

## What was implemented

- **Detection, never rewrite** — `security/detection-logger.ts::detectAndLog` (original or sanitised form) and `::detectJsonAndLog` (adds the decoded rendering of a JSON document's escapes); `sanitizeAndDetect` shares the sanitised string. Called from `processor.ts::processResponse`, `::defendForInline`'s JSON arm, and `tools/jq-query.ts::executeJqQuery`.
- **One JSON verdict per body** — `processResponse` classifies the origin's decode with `classifyBody` (the wrap's question); `jq/filter.ts::applyJqFilter` trims as `classifyBody` does; a JSON body is the origin's octets inline and on disk (`originOnDisk`); the sanitised form is written only for a non-JSON body Step 2 changed.
- **Size gates** — `exceedsInlineCap` and its growth ratio deleted; both gates are a byte comparison on JSON, sound because the wrap returns JSON unchanged (pinned by a premise test).
- **Messages** — `savedMessage`: operator's over-cap wording; decoded size beside on-disk size on a lossy decode; every sanitiser transform named; no claim about `jq_query` on the non-JSON arm. `curl-execute.ts::CURL_EXECUTE_TOOL_META` states the contract, pinned by a test.
- **Witness** — `register-all-tools.test.ts::expectWrapCompleted`: tag plus no `[wrap-error]`.
- **Prose** — published docs (`docs/custom-tools.md`, `docs/hooks.md`, `docs/architecture/architecture.md`, README, `docs/configuration.md`, `docs/getting-started.md`, `src/lib.ts`, `types/public.ts`) and in-code comments. `.sixees/ARCHITECTURE.md` invariants 1a, 7 and 14 edited **locally only** (gitignored, per the operator).

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Detect-only applies wrap-wide | 019 as written fixed `processResponse` only; the wrap re-sanitised every JSON part, so the model never saw origin bytes | AC1 as written (operator declined) |
| Over-cap notice leads with the saved file | 240 req/h quota: the bytes on disk cost nothing, a re-request costs quota | RC-49's "ask the API for less" |
| Reader made as tolerant as the classifier | Normalising bytes to fit the strictest reader rewrote payload values (022) | Minimal BOM-only fallback (smaller, but still edits disk bytes) |
| A body parsing only after Step 2 removes a char between tokens is non-JSON | It is not valid JSON; no real origin emits it; honest report beats silent repair | Keep sanitise-then-classify (RC-44's remedy) |
| Detection on raw, sanitised and (JSON) decoded forms | Each hides a class from the others; none rewrites | Detect on original only (the PR-6b trade-off, now closed) |
| ARCHITECTURE.md edited locally | The file is per-clone since #42 | Re-track it |

## What to pay attention to during review

- **Two settled decisions are reversed** — RC-49's "ask for less" and RC-44's sanitised BOM artefact. Their RC entries are drafted and await the operator (see Follow-up); until flushed, nothing on the branch cites a number for them. *(Superseded: flushed as RC-63 and RC-64.)*
- **BREAKING for library consumers**: a JSON text part a custom or YAML tool returns through `McpCurlServer` is no longer stripped of Unicode attack codepoints; `sanitizeAndDetect`/`defendText` now log one more class. CHANGELOG `[Unreleased]` says so. *(Now `[5.0.0]`.)*
- **`detectJsonAndLog`'s decode** is one linear scan for string tokens plus a `JSON.parse` per token that carries an escape, on any body containing a backslash — up to 10 MB, under the population the director settled (internal staff).
- **Inline JSON may now carry a leading BOM or NBSP** to the model; those are the origin's bytes.

## Known issues and limitations

- The model still reads a beacon or `javascript:` link inside a JSON string value (RC-49 closed this with no trigger; spotlighting is the containment, off by default).
- Confusable folding (UTS #39) remains unimplemented, as before.
- `defendText` (published) still runs Step 2 on a JSON document, unlike the server's JSON arm; its future is `docs/todos/018` slice 2.
- `package.json` is still 4.0.2; this branch is MAJOR-bound and the number is set before merge. *(Superseded: set to 5.0.0 during PR #43 review; see Follow-up work.)*

## Testing summary

- Runner: `npm test` (vitest) with `--reporter=json --outputFile=…`, verdict parsed from the artefact: **1373 collected, 1366 passed, 0 failed, 7 skipped.** vitest is not a runner `/work` treats as certifying, so this is the floor, not a certification.
- `tsc --noEmit`: 12 errors, all pre-existing in three test files; unchanged by the branch.
- Mutation probes: 17 guards across three rounds, each failing 1–14 cases when broken, each restored byte-identical (`cmp`).
- Added: BOM/NBSP/U+3000-led saves read back through `applyJqFilter`; emoji/ZWJ/padding fidelity; split and escaped phrase detection on both arms and end to end; lossy over-cap message; non-JSON rejection wording; tool-description pin; fail-open witness.
- Gaps: no test drives a real `curl` binary; the fail-open witness cannot see `processTextPart`'s per-item catch (a throwing getter), which logs nothing and no fixture reaches.

## Commit history

```
1d26924 fix(response): detect escaped phrases in JSON; make every saved-file claim true
4dd22b4 docs: say what the JSON arm does now, everywhere it is described
082b7a4 test(wrap): a JSON part's "the wrap ran" witness can no longer pass on a fail-open
49b65e1 fix(response): one JSON verdict per body, read the way it was given; detect split phrases
4938a63 docs(review): record the Surface 2 review of 019 and file its seven classes (021-027)
01574b4 fix(jq_query)!: detect on filter output without rewriting it; say so everywhere the wrap is described
1cedbc0 fix(response)!: detect without rewriting a JSON payload; point an over-cap body at the saved file
```

## Review context

Read `processor.ts::processResponse` (gate, save arm, `savedMessage`) first, then `security/detection-logger.ts`, then `jq/filter.ts::applyJqFilter`, then the wrap's `defendForInline` JSON arm. Related: RC-44, RC-47, RC-49 in `.sixees/LESSONS.md`; `docs/todos/018` (slice 2 owns `defendText`'s future).

**Recurrence recorded, no new RC:** removing the JSON rewrite also removed the wrap's detection on sanitised text, which is what had caught invisible-character-split phrases (023). That rule is already in the ledger as RC-37's "sweep for the properties a deleted mechanism was incidentally upholding", which is shape K-20.

## Code Review — 2026-10-20 (second pass, fixes only)

**Certification:** not a full roster — a focused re-review of the fix commits (`4938a63..4dd22b4`) by security-sentinel and data-integrity-guardian only, per K-16. Both returned `findings`; nothing at P1.

| Severity | Finding | Disposition |
|---|---|---|
| P2 | Escaped phrases in JSON undetected on unfiltered arms | fixed in 1d26924 |
| P2 | `curl_execute` description still claimed codepoint removal | fixed in 1d26924 |
| P3 | `savedMessage` claims untrue on lossy / rejection arms | fixed in 1d26924 |
| P3 | Stale comments (both reviewers) | fixed in 1d26924 |
| P3 | Stale size-gate docstrings | fixed in 1d26924 |

The fixes in 1d26924 were not themselves re-reviewed. Surface 3 has not run. *(Superseded: Surface 3 ran on PR #43; see Review Comments Addressed.)*

## Follow-up work

- [x] Approve, amend or refuse the two drafted RC entries — approved as drafted and flushed as **RC-63** (over-cap reversal of RC-49) and **RC-64** (reader/classifier reversal of RC-44's remedy), 2026-10-20
- [x] Set the MAJOR version and rename `[Unreleased]` before merge — 5.0.0, set during PR #43 review, 2026-10-20 (not waiting for 018 slice 2)
- [ ] Open the PR and run `/sixees-workflow:review-pr-comments` for Surface 3

### Outstanding Todos

| file | priority | description | source |
|---|---|---|---|
| — | — | none opened by this branch remains open | — |

### Resolved Todos

| id | title | summary | by | date |
|---|---|---|---|---|
| 019 | The JSON arm still sanitises, and the over-cap notice misdirects | detect-only wrap-wide; over-cap notice leads with the saved file | Claude Code | 2026-10-20 |
| 021 | A JSON body's raw bytes are declared usable by a check that cannot answer the question | reader trims as the classifier does; JSON always origin octets | Claude Code | 2026-10-20 |
| 022 | When raw JSON fails to parse, the whole payload is sanitised | inline and disk keep the origin's bytes; sanitised form only for changed non-JSON | Claude Code | 2026-10-20 |
| 023 | Detection reads only raw text on JSON arms | raw, sanitised and decoded forms; end-to-end test | Claude Code | 2026-10-20 |
| 024 | Prose still says JSON is sanitised | published docs and source comments corrected; contract stated once | Claude Code | 2026-10-20 |
| 025 | The "wrap ran" witness is set on fail-open | `expectWrapCompleted`: tag plus no `[wrap-error]` | Claude Code | 2026-10-20 |
| 026 | The not-byte-identical notice omits whitespace collapse | every transform named, U+FFFD included | Claude Code | 2026-10-20 |
| 027 | Size-gate growth arms and alias left for a removed rewrite | `exceedsInlineCap` and ratio machinery deleted | Claude Code | 2026-10-20 |

## Review Comments Addressed — 2026-10-20

**PR:** #43 · Surface 3, round 1 (requested: CodeRabbit, Codex, Copilot; 15 min wait). Copilot reviewed `bb5030d` (grade "Changes recommended", 2 issues).

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Release the BREAKING change as a major version, not 4.1.0 | coderabbitai, chatgpt-codex-connector (P1), copilot-pull-request-reviewer | Decision conflict, settled by the operator | Version 5.0.0 in `package.json`, the lockfile, the CHANGELOG heading and `dist/` |
| Decoded detection re-serialises the document: duplicate members dropped, `\u000a` re-escaped, `\n` skipped by the `\u` gate | coderabbitai, chatgpt-codex-connector, copilot-pull-request-reviewer | Fix needed (P2, in scope) | `detection-logger.ts::matchesDecodedForm` decodes each escaped string token on its own, found by a linear lexer (`escapedStringTokens`), gated on any backslash. Four new body-path and wrap-path cases plus a linearity case; probes: the old decoder fails 4, a regex lexer does not finish in 100 s |
| Architecture doc says the LLM receives attack text in full | coderabbitai | Documentation (P3, in scope) | `docs/architecture/architecture.md` › Prompt Injection Defense: sanitisation is not a boundary, and a non-JSON body is saved, not returned; the stale `sanitize.ts:26-58` anchor is now `INJECTION_PATTERNS` |
| The same JSON is parsed more than once on the escaped and filtered path | coderabbitai | Fix needed (P3), resolved by the fix above | Detection no longer parses the whole document, so the filtered path parses it twice (classify, filter) instead of three times |

### Declined Findings

None this round: every finding was fixed.

### Decisions Revised

| Original decision | New approach | Reason | Reviewer |
|---|---|---|---|
| Release as 4.1.0 (operator instruction) | Release as 5.0.0 | The CHANGELOG marks the JSON-sanitisation removal BREAKING for library consumers, and a minor version reaches every `^4` range unasked; the operator chose 5.0.0 | coderabbitai, chatgpt-codex-connector, copilot-pull-request-reviewer |
| Decoded detection re-serialises the parsed document | Per-token decode | Re-serialising loses duplicate members and re-escapes control characters (`LESSONS.md` RC-24, recurring) | all three |

### Resolved Todos

None: no todo is linked to #43.

### Outstanding Todos

None.

### Files Modified

`src/lib/security/detection-logger.ts`, `src/lib/response/processor.ts` (comments), `src/lib/response/processor.test.ts`, `docs/architecture/architecture.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `dist/`.

## Review Comments Addressed — 2026-10-20 (round 2)

**PR:** #43 · Surface 3, round 2 (requested: CodeRabbit, Codex, Copilot; 15 min wait). Codex reviewed `7fb45f4` and found no major issues. Copilot graded it "Needs a closer look" with no open issues and one previously missed issue in its body. The round met the operator's stop condition (five or fewer comments, no P1).

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| `jq_query`'s saved arm misses escaped phrases: `filtered` is `JSON.stringify` output and the wrap never sees it | coderabbitai (inline), copilot-pull-request-reviewer (review body) | Fix needed (P2, in scope) | `jq-query.ts::executeJqQuery` uses `detectJsonAndLog`. Its sibling, `processor.ts::processResponse`'s post-filter detection, also does now. Two saved-arm cases added; probe: `detectAndLog` fails 2 |
| The handoff's release status contradicts itself | coderabbitai | Documentation (P3, in scope) | Stale statements labelled as superseded, and the `Status:` field updated |

### Declined Findings

None this round: every finding was fixed.

### Decisions Revised

None this round.

### Resolved Todos

None.

### Outstanding Todos

None.

### Files Modified

`src/lib/tools/jq-query.ts`, `src/lib/tools/jq-query.test.ts`, `src/lib/response/processor.ts`, `docs/work/handoff-fix-019-json-arm-detects-without-rewriting.md`, `dist/`.
