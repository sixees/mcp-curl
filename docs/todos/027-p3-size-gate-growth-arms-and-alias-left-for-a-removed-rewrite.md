---
status: pending
severity: low
effort: s
tags: [code-review, dead-code, response, jq-query, size-gate]
dependencies: []
pr: ""
---

# Machinery for a rewrite that no longer happens: the size gate's growth arms, and a pass-through alias where the rewrite used to be

## Problem Statement

Both callers of `exceedsInlineCap` hand it JSON only, and the inline defence now returns JSON unchanged, so its growth arms can only re-answer `bytes > maxBytes` — at the cost of a second parse and detect for in-band bodies. This branch also added a jq_query comment defending the arm for "a caller whose text is not JSON", which does not exist, and left `const persisted = filtered;` as an alias for a value that no longer changes.

## Findings

**Instances:**
- `src/lib/response/processor.ts::exceedsInlineCap` — arms 2 and 3 — confirmed
- `src/lib/response/processor.ts::MAX_INLINE_GROWTH_RATIO` / `SHORTEST_REPLACED_BEACON` — confirmed (pre-existing per RC-47)
- `src/lib/tools/jq-query.ts::executeJqQuery` — new justification comment and `persisted` alias — confirmed
- `src/lib/response/processor.test.ts` — the two ratio-premise tests — confirmed

**Sweep:** grep `exceedsInlineCap|MAX_INLINE_GROWTH_RATIO|SHORTEST_REPLACED_BEACON` → 2 production callers, both JSON-only; 1 internal barrel re-export (not published); 4 test sites.

**Fix (class level):** reduce the gate to `Buffer.byteLength(text, "utf8") > maxBytes` at both sites, delete the ratio machinery and its premise tests, pin `defendForInline(json) === json` once, and use `filtered` directly.

## Proposed Solutions

### Option 1: Delete the machinery
**Pros:** removes a false premise and a wasted parse. **Cons:** touches invariant-14 tests. **Risk:** Low.

### Option 2: Leave it until docs/todos/018 slice 2
**Pros:** slice 2 reshapes `defendText` anyway. **Cons:** keeps the new false comment. **Risk:** Low.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] No growth arm reachable only by inputs no caller sends
- [ ] invariant 14 still pinned by a test at the boundary
- [ ] `persisted` alias gone

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers code-simplicity-reviewer, typescript-reviewer reported the class; the orchestrator re-ran the sweep.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
