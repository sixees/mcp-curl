---
status: pending
severity: medium
effort: s
tags: [code-review, dead-code, schema-generator, error-boundary, extensible]
dependencies: []
pr: ""
---

# A special-case catch arm now produces exactly what the general fall-through produces

**Class:** `dead-code` · **aliases:** `duplicated-logic` (pattern-recognition-specialist)
**Severity:** P2 — raised from P3 because the alias matches `LESSONS.md` RC-46's recorded
class (*the fix kept an exception for the safe case, and the exception was the defect*):
a carve-out retained after the general path absorbed it. Both reviewers graded it P3 on
its own; the raise is the review command's known-pattern rule, not a re-grade.
**Found by:** code-simplicity-reviewer, pattern-recognition-specialist (merged on the
shared confirmed instance). Filed from `/sixees-workflow:review` of branch
`fix/015-wrap-every-handler-exit` (commit 3bc9e17), Surface 2.

## Problem Statement

When `createToolHandler`'s fall-through changed from `throw error` to
`return fail(toolErrorResult(error))`, the "Unknown filter preset" arm above it stopped
changing anything: for any `Error`, `toolErrorResult` returns byte-identical content. The
arm still carries its own copy of the result literal and a comment claiming a dependency
on `resolveJqFilter`'s wording that no longer affects behaviour. A maintainer who edits
`toolErrorResult` (prefix, path-stripping, marking) gets two formats out of one handler;
one who "fixes" the prefix match is guarding a branch with no effect (K-7).

## Findings

- `src/lib/schema/generator.ts::createToolHandler` — the
  `error instanceof Error && error.message.startsWith("Unknown filter preset")` arm returns
  `fail({ content: [{ type: "text", text: error.message }], isError: true })`; the
  fall-through directly beneath returns `fail(toolErrorResult(error))`, and
  `src/lib/utils/error.ts::toolErrorResult` is
  `{ content: [{ type: "text", text: getErrorMessage(error) }], isError: true }` where
  `getErrorMessage` is `error.message` for an `Error`. — **confirmed** (both reviewers; the
  orchestrator re-read both sites)
- `src/lib/utils/error.ts::toolErrorResult` — the helper the arm now duplicates. —
  **confirmed** (reference instance, not a defect site)
- `src/lib/extensible/tool-wrapper.ts` module imports — `ToolResult` is imported from
  `./types.js` and used nowhere in the file. Same class-id (`dead-code`), **out of scope:
  pre-existing** — the import was already unused at base `d0709908`, verified by reading
  the base file. Listed because it shares the class; a one-line removal if wanted.
  `tsconfig.json` has no `noUnusedLocals`, which is why it ships silently — a project
  decision, not this todo's.
- Sweep (simplicity): read every catch arm in the three handlers that now end in
  `toolErrorResult` — 4 candidate arms → 1 confirmed (the `AuthenticationError` and
  `LocalRefusalError` arms still differ: server-authored mark and a prefix).
- Sweep (pattern): `rg -n 'isError: true' src/lib --glob '!*.test.ts'` — 15 candidates →
  2 confirmed as copies of this shape.

## Proposed Solutions

### Option 1: Delete the arm and its comment

**Approach:** Remove the preset arm; the fall-through handles it. Add one clause to the
catch's existing comment saying the preset error takes the general path because it echoes
the model's own parameter (which that comment already explains).

**Pros:** one less branch to reason about; the comment stops claiming a dead dependency.
**Cons:** none found. **Effort:** minutes. **Risk:** Low — the existing
`schema.test.ts` "returns error result for invalid filter preset" test must still pass,
and that it does is the proof the arm was dead.

### Option 2: Keep the arm as documentation, routed through the helper

**Approach:** `return fail(toolErrorResult(error))` inside the arm, keeping the branch as a
named case.

**Pros:** the preset case stays visible by name.
**Cons:** a branch that does what the fall-through does is still dead code with a name.
**Effort:** minutes. **Risk:** Low.

## Recommended Action

_Filled when dispositioned._

## Technical Details

**Affected files:**
- `src/lib/schema/generator.ts::createToolHandler` — the catch's preset arm
- `src/lib/schema/schema.test.ts` — "returns error result for invalid filter preset" is
  the regression guard; no new test needed
- `src/lib/extensible/tool-wrapper.ts` — the unused `ToolResult` import (out of scope)

**Class-level fix:** at the layer where no caller can forget it — the fall-through is
already that layer; the fix is removing the special case, not adding another.

## Resources

- Branch `fix/015-wrap-every-handler-exit`, commit 3bc9e17; handoff
  `docs/work/handoff-fix-015-wrap-every-handler-exit.md`
- `LESSONS.md` RC-46 (the class match that set the severity)
- `.claude/rules/02-reuse-first.md`, `.claude/rules/06-code-comments.md`

## Acceptance Criteria

- [ ] `createToolHandler`'s catch has no arm whose output equals the fall-through's
- [ ] The comment above the catch names why the preset error is spotlighted, without
      claiming a wording dependency
- [ ] `schema.test.ts` "returns error result for invalid filter preset" still passes
- [ ] (optional, out of scope) `ToolResult` import removed from `tool-wrapper.ts`

## Work Log

### 2026-11-04 - Filed from review

**By:** Claude Code (/sixees-workflow:review, orchestrating for /sixees-workflow:work)

**Actions:** merged two reviewer classes on the shared confirmed instance; re-read
`generator.ts::createToolHandler` and `utils/error.ts::toolErrorResult` to confirm the
equivalence; read `tool-wrapper.ts` at base to establish the import was pre-existing.

**Learnings:** the fall-through conversion is what made the arm redundant — the review
question "what did the fix newly make true" (`pr-resolver-safety`) is what found it.
