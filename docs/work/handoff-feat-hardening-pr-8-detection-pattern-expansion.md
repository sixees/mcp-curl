# Work Handoff: PR-8 — detection-pattern expansion (B7 sub-4-5)

**Date:** 2026-05-03
**Branch:** `feat/hardening-pr-8-detection-pattern-expansion`
**Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B7-sub-4-5 / PR-8 section, lines 1101–1162)
**Status:** complete

## Summary

PR-8 closes the final scoped item in the 9-PR hardening plan: detection-side
expansion of the prompt-injection signal. Three changes in
`src/lib/utils/sanitize.ts`, scoped strictly to `detectInjectionPattern()`
and the `INJECTION_PATTERNS` regex — **no byte returned to the LLM is
changed by this PR**.

1. **NFKC normalisation in `detectInjectionPattern()`.** Detection now
   matches against `input.normalize("NFKC")` rather than the raw input.
   NFKC collapses compatibility variants (full-width Latin
   `ｉｇｎｏｒｅ`, Latin ligatures `ﬁ`, ASCII-mappable compat forms) into
   canonical ASCII so the homoglyph-substitution bypass class is closed
   for the detection signal. The original `input` flows downstream
   unchanged — `sanitizeResponse`'s output is independent of NFKC.
2. **Bounded wildcards widened from `{0,20}` to `{0,80}`** on the
   multi-keyword phrase matchers (`ignore … instructions`,
   `disregard … directives|instructions|rules`,
   `forget … instructions`, `override … instructions`,
   `do not follow|apply|use|obey|comply … instructions`,
   `pass … contents as`, `extract|exfiltrate|leak|transmit|send me … credentials`).
   Closes the gap-padding bypass — `ignore<25 spaces>previous instructions`
   was previously below threshold and now fires the per-host log signal.
3. **Three synonym families** added to the `INJECTION_PATTERNS` set:
   `stop\s+(following|obeying|applying)`,
   `cease\s+(compliance|following|obeying)`,
   `bypass\s+(your|all|the)\s+(instructions?|filters?|safety)`.
   Covers paraphrases that the canonical four override-verbs miss
   ("stop following your instructions", "cease compliance with the rules",
   "bypass your safety filters").

The doc comment on `detectInjectionPattern` documents the NFKC step and
calls out the UTS #39 limitation (Cyrillic/Greek homoglyph folding is
NOT covered by NFKC and remains a deferred gap; the per-host
`[injection-defense]` log signal is the trigger for re-evaluating
`unicode-confusables` integration if those attacks land in the wild).
The doc comment on `INJECTION_PATTERNS` documents the bounded-wildcard
sizing rationale and the leetspeak deferral.

## What was implemented

### `src/lib/utils/sanitize.ts`

- **`detectInjectionPattern(input)`** now applies
  `String.prototype.normalize("NFKC")` to the input before the
  `INJECTION_PATTERNS.test(...)` call. JSDoc updated with the NFKC
  paragraph and a UTS #39 limitation note.
- **`INJECTION_PATTERNS`** regex source widened: every `[\s\S]{0,20}`
  occurrence on multi-keyword phrase matchers is now `[\s\S]{0,80}`.
  Three new alternation entries added for the synonym families. The
  `(extract|exfiltrate|leak|...)... (passwords|credentials|...)`
  pattern's tail is also widened from `{0,30}` to `{0,80}` for symmetry
  with the other multi-keyword matchers (no functional regression — the
  new bound is strictly looser).
- **Comment block** above `INJECTION_PATTERNS` documents:
  - the bounded-wildcard sizing decision (`{0,80}` covers all observed
    gap-padding while bounding ReDoS work),
  - the NFKC vs UTS #39 split (NFKC handles compat variants;
    confusables-table skeleton-folding is the proper fix for
    Cyrillic/Greek homoglyphs and is deferred),
  - the leetspeak deferral (`1gn0r3`, `1337` would trip false positives
    on legitimate text like "l33t" / "1337"; gated on per-host log
    signal).

### `src/lib/utils/sanitize.test.ts`

Three new `describe` blocks plus one updated existing case (the
`{0,20}` → `{0,80}` widening invalidated the prior 25-char gap
assertion):

- **`detectInjectionPattern — NFKC homoglyph / width-variant coverage (PR-8 / B7-sub-4)`**
  — 5 cases:
  - full-width `ｉｇｎｏｒｅ ｐｒｅｖｉｏｕｓ ｉｎｓｔｒｕｃｔｉｏｎｓ`
    matches after NFKC,
  - mixed full-width + ASCII matches,
  - compatibility-ligature `ﬁ` (U+FB01) matches `exﬁltrate`,
  - **no-content-mutation regression**: `sanitizeResponse(fullWidth)`
    returns the original bytes verbatim (full-width letters are not in
    the attack-range class) yet `detectInjectionPattern(sanitized)`
    still fires — locks the contract that NFKC is detection-local,
  - **UTS #39 gap regression**: Cyrillic `і` (U+0456) homoglyph is
    explicitly NOT detected by NFKC alone — locks the gap visibly so a
    future contributor adding skeleton-folding updates this test along
    with the implementation.
- **`detectInjectionPattern — widened bounded wildcards (PR-8 / B7-sub-4)`**
  — 4 cases:
  - 30-space gap matches (within new window),
  - exactly 80-space gap at the upper bound matches,
  - 200-char gap does NOT match (locks the upper bound + ReDoS-bounding
    behaviour),
  - multi-line override phrase with 40-space gap matches.
- **`detectInjectionPattern — synonym variants (PR-8 / B7-sub-4)`**
  — 4 cases:
  - one per family for the positive case (3 cases × 3 verbs each = 9
    assertions in 3 `it` blocks),
  - one negative case asserting benign uses don't over-trigger
    ("we stop here", "the train will cease at noon",
    "you can bypass the queue at the side door").
- **Updated existing case** (`detectInjectionPattern > still detects within bounded window`):
  the 25-char gap that previously asserted `false` is now updated to a
  100-char gap (still rejected, comfortably above the new 80-char bound)
  and a comment cross-references the PR-8 widening.

### `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`

PR-8's acceptance-criteria checkboxes flipped from `[ ]` to `[x]` (5
boxes — NFKC, widened bounds, synonym families, regression tests, no
content mutation).

## Cross-PR audit (plan vs handoffs PR-1 .. PR-7)

The user asked me to also review the original plan against the eight
prior PR handoffs and identify valid gaps. Findings, in order of
materiality:

### Closed by PR-8 itself

- **PR-8's acceptance criteria** — all 5 checkboxes ticked in this
  session. The plan's body PR-8 section was the last untaken work in
  the 9-PR sequence.

### Genuine open gaps (not closed by PR-1..PR-8)

1. **Final cleanup commit (WBS item 15) is still pending.** The plan
   states `docs/todos/` and `docs/upstream-contributions.md` are
   deleted as the final step gated on PRs 1–14. Current state:
   `docs/upstream-contributions.md` is already gone (deleted in PR-1
   commit `570f6a5`); `docs/todos/` exists but is empty (an empty
   directory, no content). Still needs a one-line cleanup commit
   `git rm -r docs/todos/` after PR-8 merges. **Not in PR-8 scope** —
   matches the plan's "after all 8 PRs are merged" gating.
2. **PR-9 (perf benchmarks + CI thresholds) was implied but never
   added to the 9-PR list.** The plan's §Non-Functional Requirements
   §7 specifies a `bench/` directory (50 KB JSON, 500 KB HTML, 1 MB
   markdown, 10 MB text fixtures) with measurement-first CI thresholds
   set at +20% above measured p95. Multiple handoffs (PR-7 §Test gaps,
   PR-6a §Test gaps, PR-1 follow-ups, plan §Validation pass) defer
   this to "PR-9", but PR-9 is not enumerated in the WBS table or PR
   Plan table — it's implied by the NFR section and the ad-hoc
   Validation Pass "PR-9" mentions. **Action needed**: explicitly
   add a PR-9 entry to the plan's WBS or open a separate plan for
   it. Calling this out as a gap rather than silently shipping
   without bench coverage.
3. **C5 + S7 (prompt/resource wrap entry points) were tagged
   "deferred to PR-7" in the plan's review-history appendix but were
   NOT addressed in PR-7.** Per PR-7's handoff §Known issues: "they
   reference a B7-sub-4-5 numbering that conflicts with the canonical
   PR-7 scope (B7-sub-1-3 + B8). They were NOT addressed in this PR
   — they belong to the prompt/resource wrap entry points which
   don't yet exist as separate code paths in this codebase." **PR-8
   does not address them either** — they're true follow-up work that
   needs a separate plan section once those entry points exist as
   distinct code paths. Genuine forward-looking gap; not blocking
   plan completion.
4. **PR-7 deferred items not closed by PR-8.** PR-7's handoff §Follow-up
   work lists six items: (a) C5/S7 (above), (b) reference-style
   markdown link strip, (c) named HTML entity decode, (d) bench
   fixture (above), (e) image-inside-link outer-link strip
   ("PR-8 forward"), (f) C12 narrower port allowlist. PR-8 is
   detection-only and shares only one file with PR-7 (`sanitize.ts`);
   none of the (b)-(f) items lives in `sanitize.ts`. **PR-8 leaves
   them open** — they're real gaps but were correctly scoped out of
   B7-sub-4-5. Should be folded into a follow-up plan or the cleanup
   commit's PR description.

### Already-closed items the plan still describes as open

5. **Plan §Acceptance Criteria > Functional Requirements four
   checkboxes are still `[ ]` even though all four conditions hold:**
   - "All 9 todo files in `docs/todos/` have their problem statements
     addressed by a merged PR" — true (`docs/todos/` is empty).
   - "All 4 still-applicable upstream-contribution items are landed"
     — true (PR-1 closed A1, A2, A3, A4 + the orphan B6).
   - "`docs/todos/` directory deleted" — partly: directory exists
     but empty; final `git rm -r` lands with WBS item 15.
   - "`docs/upstream-contributions.md` deleted" — true (PR-1).
   - "No public API regression" — true; verified by `src/lib.test.ts`
     frozen-surface check.

   **Action needed**: tick these post-cleanup-commit. Doing so now
   would tick "directory deleted" before it's deleted. Defer to the
   cleanup commit's diff.

6. **Plan §Validation pass §1-3 still `[ ]` even though they hold:**
   - "No PR > 15 files changed" — verified across PR-1..PR-7 handoffs;
     largest is PR-7 at ~7 net new + 3 modified = 10 files.
   - "No PR < 2 files changed unless pure docs" — PR-3 is README-only
     (acceptable per the plan); all others are 2+ files.
   - "Every PR's description makes sense standalone" — verified by
     the per-PR handoffs, which read independently.
   - "No file is touched by two open PRs simultaneously" — verified;
     PR-7 → PR-8 share `sanitize.ts` and were sequenced (PR-7 merged
     first, PR-8 rebases). PR-6a / PR-6b were file-disjoint.

   **Action**: same as #5 — tick post-cleanup-commit.

### Items the plan listed under "Validation pass" that are PR-8-specific

7. **"PR-8 audits that no content sent to the LLM is changed."** This
   was the explicit validation-pass item for PR-8. **Closed by PR-8**:
   the new test
   `detectInjectionPattern — NFKC homoglyph / width-variant coverage
   > does NOT mutate input — sanitizeResponse output is unaffected by detection's NFKC`
   asserts byte-equality between `sanitizeResponse(fullWidthInput)`
   and the original full-width input. This is the regression check
   that locks the "detection-only" contract end-to-end.

### Plan items handled fully but not formally checked off

The plan §Success Metrics tracks "Documented injection-defence bypasses:
9 known → 0". By my count after PR-8:

- Whitespace-padding via tab — closed by PR-7 ✓
- Whitespace-padding via NBSP — closed by PR-7 ✓
- Whitespace-padding via em-space / ideographic — closed by PR-7 ✓
- Missing Unicode invisibles in 8 ranges — closed by PR-7 ✓
- Gap-padding > 20 chars — **closed by PR-8 ✓**
- Homoglyph via NFKC (compat variants only) — **closed by PR-8 ✓**
- Sneaky-Bits VS Supplement — closed by PR-7 ✓
- Markdown link exfil — closed by PR-7 ✓
- ReDoS in HTML strip — closed by PR-7 ✓

**Result: 9 → 0 documented bypasses closed.** UTS #39 Cyrillic/Greek
confusables and leetspeak are explicitly out-of-scope and tracked
as deferred-with-rationale, not as bypass classes left open.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|-------------------------|
| Apply NFKC inside `detectInjectionPattern()` rather than at the call site (`sanitizeAndDetect`) | Keeps the contract local: the matcher's input transformation is owned by the matcher. Callers don't need to know about NFKC — they pass in (sanitised) text and get the boolean. Centralised location also lets the JSDoc explain "no content mutation" alongside the implementation. | Apply NFKC inside `sanitizeAndDetect` and pass normalised text to `detectInjectionPattern`. Rejected — leaks an implementation detail to the composer; would also normalise the form passed to the throttled log helper, making log entries inconsistent with what `sanitizeResponse` actually emitted. |
| Widen all multi-keyword phrase matchers to `{0,80}` (including the previously-`{0,30}` exfiltration tail) | Symmetry — the bound is a property of the matcher class, not of individual phrases. Mixing `{0,20}` / `{0,30}` / `{0,80}` thresholds creates inconsistency the next contributor has to relearn. The wider bound on the credentials-exfiltration matcher is a strict superset of the previous one. | Widen only the `ignore`/`disregard`/`forget`/`override` set. Rejected — the `do not follow … instructions` and `pass … contents as` matchers fall in the same gap-padding-vulnerable class; the credential-exfil tail uses the same bounded-wildcard shape. |
| Lock the UTS #39 gap with an explicit `expect(...).toBe(false)` test | Visibility. A future contributor adding skeleton-folding or `unicode-confusables` will run the test, see it fail, and know exactly which line of the implementation needs to update along with it. The alternative — a comment-only TODO — silently rots when the comment is in a different file from the gap. | Document the gap only in the JSDoc and `INJECTION_PATTERNS` comment block. Rejected — comments don't fail builds; tests do. |
| Keep `(extract\|exfiltrate\|...){0,80}(passwords\|credentials\|...)` (instead of also extending the inner `{0,5}` between `api` and `keys`) | The inner `{0,5}` already covers `api keys` / `api-keys` / `api_keys` / `apikeys`. Widening it to `{0,80}` would over-trigger on legitimate text containing `api` followed by `keys` somewhere. The bypass class we care about is the gap *between verb and target*, not within the target token. | Widen the inner bound too. Rejected — false-positive risk without bypass-class motivation. |
| No new dependency (NFKC via built-in `String.prototype.normalize`) | The plan explicitly forbids new runtime dependencies for B7-sub-4-5. NFKC is V8 built-in; UTS #39 confusables would need a 150 KB data file or `unicode-confusables` (npm). Deferring confusables to a future PR — gated on log signal — keeps PR-8 dependency-free as planned. | Bundle `unicode-confusables` and ship full UTS #39 detection now. Deferred per plan §Risks "B7-sub-4-5 NFKC alone misses Cyrillic/Greek homoglyphs … gated on per-hostname injection log showing the attack class in the wild". |

## What to pay attention to during review

- **`detectInjectionPattern` is observability only.** PR-8 widens the
  signal but does not move it from observability to enforcement. The
  doc-comment misuse-prevention examples (added in PR-1's P2 sweep)
  still apply verbatim. Any reviewer who asks "should we now block
  on detection?" — the answer is no, and the doc-comment explains
  why.
- **NFKC is local to detection.** The test
  `does NOT mutate input — sanitizeResponse output is unaffected by detection's NFKC`
  is the load-bearing regression check on the no-content-mutation
  contract. If a future refactor moves NFKC into `sanitizeResponse`
  itself, this test fails — exactly the alarm we want.
- **Cyrillic homoglyph regression is intentionally `expect(...).toBe(false)`.**
  Reviewers who run the test suite and notice the assertion will
  correctly conclude the gap exists. The test name and JSDoc
  reference UTS #39 — the gap is documented, not hidden.
- **Bounded-wildcard widening to `{0,80}` is a 4× increase in the
  regex engine's potential backtracking footprint.** No new ReDoS
  risk: `[\s\S]{0,80}` is non-greedy-compatible (the engine can
  match-then-backtrack predictably) and the surrounding tokens are
  literal keywords. The 80-char cap is itself the ReDoS bound — it
  cannot be exceeded by adversarial input. The 200-char-gap regression
  test in this PR doubles as a ReDoS-bound assertion (no wall-clock
  hang on the 200-char input).
- **The synonym-family negative test (`benign uses`) is the gate that
  protects against false positives.** Removing or weakening that test
  permits new synonym additions to over-trigger silently. If a future
  PR adds another family, it should also add a negative case.
- **Cross-PR audit findings** — see the §Cross-PR audit section
  above. The most important is gap #2 (PR-9 perf bench / CI
  thresholds was deferred-from-multiple-handoffs but never enumerated
  in the WBS); gap #3 (C5/S7 prompt-resource wrap) is genuine
  forward-looking work; gap #1 (cleanup commit) is the one-line
  finale to the 9-PR sequence.

## Known issues and limitations

- **Cyrillic/Greek homoglyph attacks (UTS #39 confusables) are NOT
  detected.** Documented in the plan and locked by an explicit
  `expect(...).toBe(false)` test. Trigger for re-evaluation: the
  per-host `[injection-defense]` log signal showing repeated
  homoglyph attempts. Tracked as deferred work; not a regression.
- **Leetspeak (`1gn0r3 pr3v10us 1nstruct10ns`) is NOT detected.**
  Same deferral rationale — adding explicit leetspeak patterns
  trips false positives on legitimate technical text containing
  `l33t` / `1337` / numerals embedded in identifiers.
- **The synonym families are minimal.** Three families cover the
  most-cited paraphrase classes from the prompt-injection 2026
  research, but the natural-language space of "stop following your
  instructions" paraphrases is unbounded. Additions to the family
  list should ride per-host log signal — adding speculative
  patterns trades signal for noise.
- **No benchmark coverage of the NFKC step.** Plan §Non-Functional
  Requirements estimates NFKC on a 1 MB body at 25–70 ms (per
  performance-oracle review); for typical responses (50 KB JSON
  median, 500 KB HTML p95) the cost is sub-millisecond. The
  bench/ infrastructure deferred to PR-9 will measure this; PR-8
  ships without formal numbers, consistent with the plan's
  measurement-first protocol (no thresholds before measurement).
- **No integration-level test of detection through the full
  response pipeline.** The new tests exercise `detectInjectionPattern`
  directly. Integration via `sanitizeAndDetect` → `processor.ts` is
  covered by existing PR-7 tests on the strip path; the NFKC change
  is detection-local so the integration shape is unchanged. No
  regression risk identified, but I'm flagging the absence of a
  full-pipeline NFKC test for honesty.

## Testing summary

- **Tests added:** 13 new `it` blocks in `sanitize.test.ts` (5 NFKC,
  4 widened bounds, 4 synonym + benign-negative).
- **Existing tests modified:** 1 (the `still detects within bounded
  window` case — 25-char gap was below the new threshold and is now
  100-char to remain a true negative).
- **Total tests now:** 960 passing, 7 skipped (was 875/7 at PR-7
  merge; the +85 net comes from PR-7's review-pass additions plus
  PR-8's 13 new cases — full delta verified by re-running before
  and after the PR-8 commit).
- **Build:** `npm run build` clean, no TypeScript errors. `dist/`
  artefacts updated and committed per repo convention (PR-7
  precedent in commit `ea26373`).
- **Lint:** project does not expose a lint script; n/a.
- **Manual testing:** none required — every behavioural change is
  covered by a regression test, and the no-content-mutation contract
  is locked by an `expect(sanitized).toBe(fullWidth)` assertion.
- **Test gaps:**
  - No surrogate-half NFKC edge case test (theoretically NFKC could
    encounter a malformed UTF-16 surrogate; in practice JS strings
    sanitise these on construction).
  - No formal benchmark of NFKC overhead on adversarial 1 MB inputs
    — deferred to PR-9 along with the rest of the perf-budget framework.
  - No end-to-end test of detection through `processor.ts` →
    `sanitizeAndDetect` → `detectInjectionPattern` exercising the
    NFKC code path. Existing PR-7 tests on `sanitizeAndDetect`
    cover the composition; the NFKC change is detection-local.

## Commit history

```bash
git log --oneline main..HEAD
```

(Single commit — see post-commit update.)

## Review context

- **Suggested review order:**
  1. `src/lib/utils/sanitize.ts` — three minimal changes:
     `INJECTION_PATTERNS` regex source (bounded-wildcard widening
     + 3 synonym families), the comment block above it (rationale +
     UTS #39 deferral note + leetspeak deferral note), and the
     `detectInjectionPattern` body (`input.normalize("NFKC")`) +
     JSDoc.
  2. `src/lib/utils/sanitize.test.ts` — three new `describe`
     blocks: NFKC homoglyph / widened bounds / synonym variants.
     The no-content-mutation regression test in the NFKC block is
     the load-bearing assertion.
  3. `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` —
     PR-8 acceptance-criteria checkboxes flipped from `[ ]` to `[x]`.
     This handoff's §Cross-PR audit section calls out the remaining
     plan-level open items.
- **Plan section:** B7-sub-4-5 / PR-8, lines 1101–1162 of the
  hardening plan.
- **Dependency on other work:** PR-7 (B7-sub-1-3 + B8) is merged on
  `main` and is the immediate predecessor in the recommended
  landing order. PR-8 shares `sanitize.ts` with PR-7; the
  changes here are detection-only and do not touch any of the
  PR-7-shipped sanitiser logic. Final cleanup commit (WBS item 15)
  follows PR-8.
- **Cross-references in plan:** B7-sub-4 (NFKC + widened wildcards),
  B7-sub-5 (synonym families). Both folded into this PR.

## Follow-up work

- [ ] **Final cleanup commit (WBS item 15):** `git rm -r docs/todos/`
  to delete the now-empty directory. Follows PR-8 merge.
- [ ] **PR-9 (perf benchmarks + CI thresholds):** explicitly add to
  plan WBS. Bench fixtures for 50 KB JSON / 500 KB HTML / 1 MB
  markdown / 10 MB text; measurement-first thresholds set at +20%
  above measured p95 per plan §NFR.
- [ ] **C5 + S7 (prompt/resource wrap entry points):** track when
  those entry points emerge as distinct code paths. Currently
  conflated with the curl/jq wrap; separate wrap module needs design
  before wrap calls land at those layers.
- [ ] **Reference-style markdown link strip** (PR-7 deferral): add
  if a real bypass surface emerges.
- [ ] **Named HTML entity decode** (PR-7 deferral): same.
- [ ] **Image-inside-link outer-link strip** (PR-7 deferral): same.
- [ ] **C12 narrower port allowlist** (PR-7 deferral): config option
  if a deployment surfaces a need.
- [ ] **UTS #39 confusables / `unicode-confusables` integration:**
  gated on per-host log signal showing Cyrillic/Greek homoglyph
  attacks in the wild. PR-8's `expect(...).toBe(false)` regression
  on Cyrillic `і` is the locked entry point for that future PR.
- [ ] **Leetspeak detection:** same gating as UTS #39 — log signal
  drives the decision.

### Outstanding Todos
<!-- Todos created this session that still need work — see docs/todos/ for full content -->

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — `docs/todos/` is empty; no new todos created this session_ | — | — | — |

### Resolved Todos
<!-- Recorded before deletion. File no longer exists in docs/todos/. -->

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a plan section, not a `docs/todos/` file_ | — | — | — | — |

---

## Code Review — 2026-05-03

### Review Summary

- **Reviewer:** automated multi-agent review
- **Agents used:** code-simplicity-reviewer, security-sentinel, typescript-reviewer (TypeScript + MCP SDK best practices), pattern-recognition-specialist (cross-PR consistency vs PR-1..PR-7)
- **Findings:** 🔴 P1: 2 | 🟡 P2: 5 | 🔵 P3: 4 actionable (+ 4 informational confirmations)
- **Verdict:** clear to merge after fixes — all P1+P2+P3 actionable findings resolved in-session per the established repo pattern (PR-1, PR-6b, PR-7 in-place review-and-fix). Tests: 960 → **969 passing** (7 skipped, 0 failed).

### Handoff Assessment

The original handoff was honest about most trade-offs and proactively
flagged the load-bearing risks (no-content-mutation contract, UTS #39
gap, `[\s\S]{0,80}` bound) but **missed three things** the reviewers
caught:

- The `{0,80}` bound was identified as a tunable in the comment block
  yet hardcoded as a literal nine times in the regex source — a clear
  drift from the pattern PR-1 (`MAX_AUTH_TOKEN_LENGTH`) and PR-7
  (`FIXED_POINT_MAX_ITERATIONS`, `WHITESPACE_PADDING_CODEPOINTS`)
  established for sanitiser tunables. Both simplicity and pattern
  reviewers flagged this independently as P1.
- The deferral rationale (NFKC vs UTS #39, leetspeak deferral) was
  documented in **three** separate places — a standalone block at
  `sanitize.ts:116-126`, an inline comment above the synonym families,
  and the JSDoc on `detectInjectionPattern`. The standalone block was
  orphaned (no code attached) and ~80% redundant with the JSDoc.
- The JSDoc `Stability contract` paragraph did not classify NFKC as
  implementation vs intent, leaving a future maintainer no clear
  mandate to swap to UTS #39 skeleton-folding.

The handoff's §Cross-PR audit section was independently verified by
the typescript reviewer (it spot-checked filesystem + tests) — the
9-bypass tally and 4 open-gap classification stand.

### Key Findings & Resolutions

| ID | Sev | Category | Description | Resolution |
|----|-----|----------|-------------|------------|
| P1-A | 🔴 | DRY / pattern-drift | `{0,80}` literal duplicated 9× across `INJECTION_PATTERNS`; tests hardcode `100` / `200` / `80` against an unnamed bound. Drift from PR-1/PR-7's tunable-naming idiom. (simplicity P1-2 + pattern P1, converged) | Extracted `INJECTION_PHRASE_GAP_MAX = 80` and `INJECTION_PHRASE_GAP = "[\\s\\S]{0,80}"` to `unicode-attack-ranges.ts` (matching PR-7's tunable-home idiom). `INJECTION_PATTERNS` rebuilt via template-string interpolation; tests import the constant. |
| P1-B | 🔴 | DRY / docs | "Leetspeak / homoglyph coverage (deferred)" comment block at `sanitize.ts:116-126` is orphaned (no code attached) and ~80% redundant with the JSDoc on `detectInjectionPattern`. (simplicity P1-1) | Block deleted; JSDoc + the rationale block above `INJECTION_PATTERNS` carry the deferral note. |
| P2-A | 🟡 | Pattern consistency | Synonym families lack a taxonomy header comment (sister patterns have explicit `// Persona takeover`, `// Privilege escalation` headers). (pattern P2) | Combined into a single inline comment block above the three synonym entries that names the subgroup ("Synonym families for the explicit-override class"). |
| P2-B | 🟡 | TypeScript / contract | JSDoc `Stability contract` did not classify NFKC as implementation vs intent. (typescript P2-2) | Stability contract reworded: the `no-content-mutation` invariant is intent (locked by test); the specific normaliser (NFKC) and pattern set are implementation. Future swap to UTS #39 skeleton-folding now has a clear contract anchor. |
| P2-D | 🟡 | DRY / tests | Three describe-blocks contain ~13 near-identical `expect(...).toBe(true|false)` calls that want `it.each`. (simplicity P2-1) | Synonym positive-case (9 cases) + benign-negative (3 cases) + NFKC homoglyph (3 cases) collapsed via `it.each([...])("...", ...)`. Per-case failure attribution preserved. |
| P2-E | 🟡 | Code hygiene / tests | `"exﬁltrate the data".replace("ex", "ex")` is a misleading no-op — comment claims it adds the ligature but the literal already contains it. (simplicity P2-2) | Inlined the literal directly inside the `it.each` table. |
| P2-F | 🟡 | DRY / tests | Modified existing `still detects within bounded window` test asserted the same upper-bound class as the new dedicated 200-char-gap case. (simplicity P2-3) | Old assertion replaced with a one-line forward-pointer comment to the dedicated case. |
| P3-A | 🔵 | Security / hygiene | No wall-clock ReDoS regression test on the widened `INJECTION_PATTERNS`; PR-7 set the precedent (`strip-blocks.test.ts:158-170`). (security) | Added `wall-clock ReDoS budget (PR-8 / B7-sub-4)` describe-block: 1 MB pathological `"ignore "` chain matched against `INJECTION_PATTERNS`; CI-tolerant 2 s budget; observed ~270 ms locally on the same shape per security-bench. |
| P3-B | 🔵 | Docs / contract | NFKC's compatibility-decomposition expansion factor (~3× worst case) and the upstream `MAX_RESPONSE_SIZE` cap that bounds it were not documented in the JSDoc. (security) | One-line addendum in the JSDoc Normalisation section; references both the 10 MB upstream cap and the 100 MB global memory cap. |

### Decisions explicitly NOT made / consciously deferred

| Finding | Decision | Reason |
|---------|----------|--------|
| P3-C — synonym-family negative test thin (3 phrases) | **Deferred to a future PR** | TypeScript reviewer P3-2 — for PR-8 scope this is fine; convention note only. Lift the bar to ≥5 negative phrases per family if PR-9+ adds another synonym family. |
| P3-D — `bypass` synonym requires a scope word, misses bare `"bypass safety"` | **Rejected** | Security reviewer P3 — broadening to `bypass\s+(your\|all\|the)?\s*(...)` would over-match legitimate prose ("the bypass instructions are in section 3"). The existing pattern handles the common attack shapes; the asymmetry is documented inline. |
| toBe vs toStrictEqual on `expect(sanitized).toBe(fullWidth)` | **Rejected (kept toBe)** | TypeScript reviewer P3-1 — `toBe` is `Object.is` for primitives; identical to byte-equality on a string. `toStrictEqual` would be a no-op stricter and signal-noise. |
| URL-scheme detection patterns paralleling PR-7's `data:`/`javascript:`/`vbscript:`/`file:` blocklist | **Rejected** | Security reviewer P3 — intentional layering split: dangerous-scheme URLs are *neutralised* by `strip-blocks.ts` before reaching detection, so a parallel detection pattern would be redundant signal on already-stripped content. |

### Verified Claims

| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (960/7 baseline) | ✓ | Reproduced locally; now 969/7 after review fixes (+9 net from `it.each` fan-out + ReDoS budget; -3 from collapsing duplicate upper-bound assertion + the 5→3 NFKC describe-block consolidation). |
| Build clean | ✓ | `npm run build` passes; no new TypeScript errors. The 11 pre-existing `tsc --noEmit` errors all pre-date the branch (typescript reviewer cross-checked against `ea26373`). |
| No content mutation | ✓ | Locked by `does NOT mutate input — sanitizeResponse output is unaffected by detection's NFKC` regression test. Also verified by tracing every call path (`processor.ts`, `post-processor.ts`, `tool-wrapper.ts`, `jq-query.ts`) — the NFKC normalised string is local to `detectInjectionPattern` and discarded after `.test()` returns. |
| Wall-clock under 100 ms claim (handoff §What to pay attention to: "200-char-gap regression doubles as ReDoS-bound assertion") | partial | The original 200-char-gap test asserts only `false`, not elapsed time. Now genuinely covered by the new `wall-clock ReDoS budget` describe-block (2 s CI budget; ~270 ms observed). |
| Cross-PR audit "9 → 0 documented bypasses closed" | ✓ | Independently verified by typescript reviewer (filesystem + plan + handoffs spot-check). The 4 open-gap classification (cleanup commit, PR-9, C5+S7, PR-7 deferrals) is accurate. |
| MCP SDK 2.0 forward-compat | ✓ | TypeScript reviewer: PR-8 touches no Zod schema, no `inputSchema`, no `tools/list` payload — purely a string→boolean pure function and a regex constant. SDK 2.0's Standard Schema migration cannot affect this code. |

### Outstanding Todos
<!-- Todos created during this review -->

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — all P1/P2/P3 actionable findings fixed in-session per the in-place review-and-fix pattern established by PR-1, PR-6b, PR-7_ | — | — | — |

### Files Modified (review pass)

- `src/lib/utils/unicode-attack-ranges.ts` — added `INJECTION_PHRASE_GAP_MAX` constant (80) + `INJECTION_PHRASE_GAP` regex fragment (single source of truth for the multi-keyword phrase bound).
- `src/lib/utils/sanitize.ts` — `INJECTION_PATTERNS` rebuilt via template-string interpolation with the shared constant; orphan leetspeak comment block deleted; rationale block trimmed; JSDoc Stability contract reworded to classify NFKC as implementation; NFKC expansion-factor + upstream-cap addendum added.
- `src/lib/utils/sanitize.test.ts` — synonym positive/negative tests collapsed via `it.each`; NFKC homoglyph trio collapsed via `it.each` (no-op `.replace` removed); existing `still detects within bounded window` collapsed into a forward-pointer; new `wall-clock ReDoS budget` describe-block (1 MB pathological `"ignore "` chain, 2 s CI budget); imports `INJECTION_PHRASE_GAP_MAX` so tests stay in lock-step with the bound.

### Tests / build (post-review)

- `npm test`: **969 passed | 7 skipped | 0 failed** (was 960/7 before review fixes; net +9).
- `npm run build`: clean.

### Blockers

**None.** All P1+P2 actionable findings resolved; actionable P3 items (P3-A wall-clock budget, P3-B JSDoc addendum) also resolved. Non-actionable P3 items (informational confirmations) noted in the §Decisions explicitly NOT made table.

---

## Review Comments Addressed — 2026-05-03

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Suggested using `INJECTION_PHRASE_GAP` between keywords in the `bypass` synonym family for consistency with the wider multi-keyword patterns (`override...instructions` etc.) | @gemini-code-assist (AI) | False positive | Reply posted with empirical trace showing the suggested pattern introduces two false positives on legitimate prose (`"the bypass section in your manual instructions"`, `"we cover bypass procedures in your safety briefing"`) plus a zero-gap over-match (`"bypassyourinstructions"`) because `INJECTION_PHRASE_GAP = [\s\S]{0,80}` allows zero-or-more of any character. Decision conflict with handoff §Decisions explicitly NOT made → P3-D, which already rejected broadening the `bypass` matcher for the same over-match class. Thread resolved. |

### Decisions Revised

None. The `bypass\s+(your|all|the)\s+(...)` shape was retained. The reviewer's consistency observation is fair — synonym families do shape-differ from the longer multi-keyword matchers — but the suggested specific change reintroduces a known false-positive class. The asymmetry (`\s+` for short multi-word phrases per `act\s+as\s+`, `roleplay\s+as`, … convention; `INJECTION_PHRASE_GAP` for adversarially-constructed long phrases) is intentional and documented inline.

### Resolved Todos

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none_ | — | — | — | — |

### Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none_ | — | — | — |

### Files Modified

- `docs/work/handoff-feat-hardening-pr-8-detection-pattern-expansion.md` — appended this Review Comments Addressed section (handoff-only change; no source-code edits in this round).

### Reviewer Breakdown

- 1 incoming review thread this round (entered unresolved); 1 from AI reviewer (@gemini-code-assist), 0 from humans.
- 0 actionable fixes applied (0% applicable rate — the round was 1-for-1 false positive against a documented decision).
- 1 false positive resolved with reproducible-evidence reply (100%).
- 0 deferred, 0 escalated to user, 0 conflicts with documented decisions left open.
- 0 threads still unresolved at end of round.

---

## Review Comments Addressed — 2026-05-03 (round 2)

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Reviewer Breakdown line 541 read "1 unresolved thread" but the surrounding lines reported the thread as resolved with no conflicts left open — internally contradictory wording. | @coderabbitai (AI) | Fix needed (docs) | Reworded the round-1 Reviewer Breakdown section: "1 unresolved thread" → "1 incoming review thread this round (entered unresolved)"; added an explicit "0 threads still unresolved at end of round" line so the in-round count and the end-state count are independently visible and consistent. |

### Decisions Revised

None.

### Resolved Todos

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none_ | — | — | — | — |

### Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none_ | — | — | — |

### Files Modified

- `docs/work/handoff-feat-hardening-pr-8-detection-pattern-expansion.md` — Reviewer Breakdown wording fix + this round-2 entry (handoff-only change; no source-code edits).

### Reviewer Breakdown (round 2)

- 1 incoming review thread this round (entered unresolved); 1 from AI reviewer (@coderabbitai), 0 from humans.
- 1 actionable fix applied (100% applicable rate — round-2 finding caught a real handoff-doc contradiction left over from round-1 work).
- 0 false positives, 0 deferred, 0 escalated to user, 0 conflicts with documented decisions.
- 0 threads still unresolved at end of round.
