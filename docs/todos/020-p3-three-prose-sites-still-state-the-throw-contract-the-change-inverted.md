---
status: complete
severity: low
effort: s
tags: [code-review, stale-comment, docs, extensible, hooks, architecture-doc]
dependencies: []
pr: ""
---

# Three prose sites still state the throw contract this change inverted

**Class:** `stale-comment` · **Severity:** P3
**Found by:** code-simplicity-reviewer, typescript-reviewer (same instance),
architecture-strategist (same class-id, different instances) — merged on `class-id`.
Filed from `/sixees-workflow:review` of branch `fix/015-wrap-every-handler-exit`
(commit 3bc9e17), Surface 2.

## Problem Statement

The change made every tool-handler throw return as a wrapped `isError` result, and updated
`types/public.ts::OnErrorHook`, `docs/hooks.md` and `docs/architecture/architecture.md` →
*Error Handling* to say so. Three prose sites it did not reach still describe the old
contract, so the shipped package now says two things about whether a tool call can reject
(K-8, K-11 — the mirror of the sites that were updated).

## Findings

- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.onError` — docblock: *"Hooks run
  sequentially when tool execution or an afterResponse hook throws; the original error is
  still rethrown."* Ships in the `.d.ts` (`declaration: true`), so it is the hover text an
  embedder reads. False on two counts: nothing is rethrown, and a `beforeRequest` throw now
  reaches `onError` too. — **confirmed** (two reviewers)
- `docs/architecture/architecture.md` → *Stage notes*, the "afterResponse + spotlighting"
  bullet — *"Schema-generated and custom tools skip the hooks but not the wrap —
  `schema/generator.ts` and `registerCustomTool` apply the same one to the handler's
  return."* True before the change; now silent on the throw arm both sites wrap, while the
  *Error Handling* paragraph three sections later says every boundary converts throws. One
  document, two answers — and todo 015's audit shows this document is read that way. —
  **confirmed**
- `docs/architecture/architecture.md` → *Error Handling* — opens *"Plain `Error` thrown
  everywhere — no custom subclasses"* in the paragraph the change edited, while
  `utils/error.ts::LocalRefusalError` and `schema/generator.ts::AuthenticationError` both
  extend `Error` and the paragraph's own new sentence relies on `createToolHandler`
  matching them by `instanceof`. Pre-existing sentence; listed because the diff edited the
  paragraph around it and the new text contradicts it. — **confirmed**
- Sweep (typescript): `rg "rethrown|re-thrown|rethrow|re-throw|original error|escapes the
  handler|propagates to" src/ docs/ examples/ README.md CHANGELOG.md .sixees/` — 9
  candidates → 1 confirmed. Sweep (architecture): `rg "(throw|wrap|isError|onError|handler's
  return)"` over the two docs — 2 candidates → 2 confirmed; 0 in `docs/hooks.md`.

## Proposed Solutions

### Option 1: Edit all three to match the updated sites

**Approach:** `onError()` docblock → the `OnErrorHook` wording already in
`types/public.ts` (a beforeRequest hook, the tool, or an afterResponse hook throws; the
message returns as a wrapped `isError` result; the call never rejects). *Stage notes* →
"to the handler's return and to any throw it makes, via `toolErrorResult`", or cut the
clause and point at *Error Handling*, which now owns the fact. *Error Handling* → drop
"no custom subclasses" or name the two that exist and why the generator matches on them.

**Pros:** the fact lives in one place per document (CONVENTIONS → *Documentation*).
**Cons:** none. **Effort:** minutes. **Risk:** Low — prose only.

### Option 2: Point rather than restate

**Approach:** Replace the `onError()` docblock sentence with a `@see OnErrorHook`
reference, and the *Stage notes* clause with a pointer to *Error Handling*.

**Pros:** one fewer copy to drift. **Cons:** a hover that says "see elsewhere".
**Effort:** minutes. **Risk:** Low.

## Recommended Action

_Filled when dispositioned._

## Technical Details

**Affected files:**
- `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.onError` — docblock
- `docs/architecture/architecture.md` → *Stage notes* bullet and *Error Handling* opener

**Test:** none — prose. The reader-side check is todo 015's audit method: count the exits
from this document and get the same answer from both sections.

## Resources

- Branch `fix/015-wrap-every-handler-exit`, commit 3bc9e17; handoff
  `docs/work/handoff-fix-015-wrap-every-handler-exit.md`
- `.claude/rules/06-code-comments.md`; `CONVENTIONS.md` → *Documentation*
- `plugin:commands/sync-comments.md` is the audit pass that would catch a recurrence

## Acceptance Criteria

- [x] `McpCurlServer.onError()`'s docblock says the call never rejects and names
      `beforeRequest` as a trigger
- [x] `architecture.md` → *Stage notes* and *Error Handling* give the same answer about
      throw coverage
- [x] `architecture.md` → *Error Handling* no longer claims "no custom subclasses"

## Work Log

### 2026-11-04 - Filed from review

**By:** Claude Code (/sixees-workflow:review, orchestrating for /sixees-workflow:work)

**Actions:** merged three reviewers' `stale-comment` classes on `class-id`; the orchestrator
read all three instances.

**Learnings:** the change updated the type-level docblock and the docs it knew about; the
registration-method docblock is the same fact stated a third time, and a sweep for the old
wording ("rethrown") is what found it — K-11, the other side of the boundary.

### 2026-11-04 - Resolved on the same branch

**By:** Claude Code (/sixees-workflow:work, on operator instruction after review)

**Actions:** Option 1 — `McpCurlServer.onError()` docblock now carries the `OnErrorHook`
wording (beforeRequest named; never rejects); `architecture.md` → *Stage notes* says the wrap
applies "to the handler's return and to any throw it makes" and points at *Error Handling*;
*Error Handling* names the two `Error` subclasses and why they exist instead of claiming
there are none.

**Learnings:** a sweep for the *old* wording ("rethrown") is the check that finds the
third copy.
