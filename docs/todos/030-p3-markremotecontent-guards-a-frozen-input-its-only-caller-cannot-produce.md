---
status: pending
severity: low
effort: s
tags: [code-review, simplification, post-processor, dead-code]
dependencies: []
---

# `markRemoteContent` guards a frozen input its only caller cannot produce

## Problem Statement

`markRemoteContent` wraps `Object.defineProperty` in a try/catch for a non-extensible result, its docblock promises it "never throws", and a test pins the frozen-input case. Its only production caller passes a freshly built object literal, so the catch cannot run. The reader still has to reason about a silent loss of spotlighting that cannot happen, and the test makes the dead path part of the contract.

## Findings

- class: a helper's error-tolerance branch, and a test pinning it, guard an input state no caller in the repository can produce.
- failure: none at runtime. The cost is to the reader: "an unmarkable result keeps the `isError`-keyed behaviour" describes a silent spotlighting loss that the only caller cannot trigger, and the test invites a later reader to keep supporting it.
- instances:
  - `src/lib/response/post-processor.ts::markRemoteContent` — the try/catch and the "never throws: an unmarkable result…" docblock — confirmed, in diff
  - `src/lib/response/post-processor.test.ts`, the case "marks without changing the serialised result, and tolerates a frozen one" — its frozen-input half — confirmed, in diff
- sweep: `markRemoteContent` across `src/` — 8 hits → 1 production call site (`curl-execute.ts::executeCurlRequest`, a fresh literal); `src/lib.ts` does not re-export it, so nothing outside the package can pass a frozen or Proxy object. No other new try/catch in the changed source.
- root: source.
- Found by: code-simplicity-reviewer, Surface 2 review of `fix/sync-quota-and-failed-exit`, 2026-10-30.

## Proposed Solutions

### Option 1: Delete the guard
Call `Object.defineProperty` directly, drop the "never throws" sentence, and drop the frozen half of the test. A throw would land in `executeCurlRequest`'s own catch and fail loudly.
- Effort: s. Risk: none today.

### Option 2: Keep it and name the reason
If todo 028 exports `markRemoteContent` (its Option 2), embedder code can hand it a frozen result, and the guard earns its place. Say so in the docblock.
- Effort: s.

## Recommended Action

## Acceptance Criteria

- [ ] Decide after todo 028: whether `markRemoteContent` becomes public decides whether this guard has a caller.
- [ ] The docblock states only what a caller can reach.

## Work Log

### 2026-10-30 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** filed code-simplicity-reviewer's `dead-code` (P3).
**Learnings:** —
