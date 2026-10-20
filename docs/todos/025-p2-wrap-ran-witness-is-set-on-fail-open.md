---
status: pending
severity: medium
effort: s
tags: [code-review, testing, post-processor, register-all-tools, unchecked-assertion]
dependencies: []
pr: ""
---

# The "wrap ran" test witness is the wrap's tag, which the wrap also sets when it fails open

## Problem Statement

This branch replaced "the zero-width space was removed" with `isWrappedResult(result)` plus byte-identity as proof the wrap ran on a JSON part. `createWrapper`'s catch path does `logWrapError(...); return tag(result)`, so a wrap that threw returns the untouched body, tagged — byte-identical to correct detect-only output. Every rewritten assertion passes on exactly the failure the depth ladder was written to catch (its own comment describes it), and detection/spotlighting would be silently skipped.

**Failure:** make `defendForInline` throw on the JSON arm → the shipped-path cases still pass.

**Severity raised P3 → P2:** class-id `unchecked-assertion` (alias `missing-validation`) matches the ledger (`LESSONS.md` RC-32, RC-54, RC-30, RC-33) — a recurrence.

## Findings

**Instances:**
- `src/lib/tools/register-all-tools.test.ts` — "runs the wrap over an application/json body without rewriting its values" — confirmed
- `src/lib/tools/register-all-tools.test.ts` — "depth cannot switch the defence off" (8 depths) — confirmed
- `src/lib/tools/register-all-tools.test.ts` — "still runs the wrap over the body when headers are reported alongside" — confirmed
- `src/lib/tools/register-all-tools.test.ts` — "keeps a raw number's spelling and still runs the wrap" — suspected

**Sweep:** `rg -n isWrappedResult src` → 26 sites in 5 files → the 4 in register-all-tools.test.ts pair it only with verbatim text; 3 confirmed on the JSON arm.

**Fix (class level):** put an injection phrase in each fixture and assert the `[injection-defense]` line (the one effect a skipped pass removes), and assert no `[wrap-error]` line.

## Proposed Solutions

### Option 1: Assert the detection log and the absence of `[wrap-error]`
**Pros:** the witness is an effect only a completed pass produces. **Cons:** couples to the log format. **Risk:** Low.

### Option 2: Spy on `detectAndLog`
**Pros:** direct. **Cons:** spies on an internal. **Risk:** Low.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] With `defendForInline` forced to throw, each listed case fails
- [ ] Each case still asserts byte-identity

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers security-sentinel, typescript-reviewer (aliases: `missing-validation`) reported the class; the orchestrator re-ran the sweep.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
