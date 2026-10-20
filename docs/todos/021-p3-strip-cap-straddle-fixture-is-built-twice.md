---
status: pending
severity: low
effort: s
tags: [code-review, duplicated-logic, test-fixtures, response, tools]
dependencies: []
pr: ""
---

# The "body sanitising shrinks under the strip cap" regression input is built twice, with two different preconditions

## Problem Statement

One regression input is built separately in two suites. Its whole value is that it
crosses `STRIP_PATH_MAX_BYTES` only **before** sanitising. Each copy guards that
precondition differently, so a change to the cap or to the sanitiser's collapse rule
fails one copy and quietly empties the other.

`.claude/rules/02-reuse-first.md`: a second near-copy of a test arrangement is
extracted, not kept.

## Findings

Class: `duplicated-logic`, found by `pattern-recognition-specialist` in the
`/sixees-workflow:review` of `fix/014-json-region-defence-end-to-end-guard`.

**Instances:**

- `src/lib/response/defend-text.test.ts::"keeps every key when sanitising collapses the body under the strip cap"`
  — **confirmed**. Its only precondition is `toBeGreaterThan(262_144)`, a hard-coded
  literal, and it never measures the post-sanitise size.
- `src/lib/tools/register-all-tools.test.ts::"a body the sanitiser shrinks under the strip cap"`
  — **confirmed**, and **added by this branch**. Same body token for token. Its
  precondition uses `STRIP_PATH_MAX_BYTES` and `sanitizeResponse` on both sides.

**Sweep:**
`rg -n 'repeat\(200\)|SENTINEL|262_144|STRIP_PATH_MAX_BYTES' src --glob '*.test.ts'`
→ 2 candidates → 2 confirmed, +0 unconfirmed.
`curl-execute.json-passthrough.test.ts` uses different bodies (short, or 600 KB), so it
is not an instance.

**Failure scenario:**

1. `STRIP_PATH_MAX_BYTES` is raised (to 512 KiB, say), or the collapse threshold moves.
2. The `register-all-tools.test.ts` copy's precondition case fails, and someone resizes that copy.
3. The `defend-text.test.ts` copy stays green, but its ~330 KB body no longer crosses the cap.
4. JSON detection now succeeds on the raw bytes, so the case passes with or without the
   "both gates read the same bytes" fix (RC-32). The unit-level guard for this route has
   stopped guarding anything (K-1).

**Severity:** P3, not P2. The end-to-end copy, which is the one carrying the weight,
guards itself. The drift risk falls on the cheaper unit copy.

## Proposed Solutions

### Option 1: one shared fixture module (the reviewer's fix)

**Approach:** Put the body, its expected key list, and one precondition helper in a
`*.test-fixture.ts` module. The helper checks the pre-sanitise byte count is
`> STRIP_PATH_MAX_BYTES` and the post-sanitise count is `< STRIP_PATH_MAX_BYTES`.
`src/lib/response/cpu-time.test-fixture.ts` is the precedent on the `response/` side.
Both suites import the module, and both run the precondition.

**Pros:**
- One spelling of the input.
- The precondition binds both copies.
- The `262_144` literal goes.

**Cons:** One more test-fixture module.

**Effort:** s

**Risk:** Low

### Option 2: fix the unit copy's precondition only

**Approach:** Replace `262_144` with `STRIP_PATH_MAX_BYTES` in `defend-text.test.ts`,
and add the post-sanitise measurement there. Keep the two bodies separate.

**Pros:** Smallest diff.

**Cons:** Still two spellings of the fixture, which is what rule 02 forbids, and they
can still drift apart.

**Effort:** s

**Risk:** Low

## Recommended Action

_Not yet dispositioned._

## Technical Details

- `src/lib/response/defend-text.test.ts` — the `describe` titled "the JSON exemption is decided on the bytes the strip sees (RC-32)"
- `src/lib/tools/register-all-tools.test.ts` — `describe("a body the sanitiser shrinks under the strip cap", …)`
- `src/lib/response/strip-blocks.ts::STRIP_PATH_MAX_BYTES`
- `src/lib/utils/sanitize.ts::sanitizeResponse`

## Acceptance Criteria

- [ ] The straddle body is built in exactly one place. The sweep above returns a single definition site.
- [ ] Both suites assert the pre- and post-sanitise preconditions against `STRIP_PATH_MAX_BYTES`. There is no numeric literal.
- [ ] Teeth: temporarily changing the fixture so it no longer crosses the cap fails the precondition in **both** suites.

## Work Log

### 2026-10-20 - Filed from review

**By:** Claude Code (`/sixees-workflow:review` inside `/sixees-workflow:work` for todo 014)

**Actions:** Filed from `pattern-recognition-specialist`'s P3 finding. It is in scope:
this branch added the second copy. Filed `pending`, as `/review` files every finding.

**Learnings:** The new copy's comment points at the unit copy instead of sharing it.
Pointing at a sibling is not reusing it.

## Resources

- `.sixees/LESSONS.md` RC-25 (assert the precondition in the test itself), RC-32 (the defect this input reproduces)
- `.claude/rules/02-reuse-first.md`
