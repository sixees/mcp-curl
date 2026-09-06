---
id: 015
priority: P1
status: pending
tags: [code-review, security, invariant-1]
created: 2026-09-06
source: /sixees-workflow:review of PR #37 (Surface 2, round 3, architecture-strategist)
---

# The post-processor wrap has six exits and guards two

## Problem

Invariant 1 says every byte returned to the LLM passes the post-processor wrap,
*"regardless of how trusted its source looks"*, and names error paths explicitly.
Six sites produce a model-facing `CallToolResult` — or throw one into existence —
without it.

The count is the finding. Two instances is a pair of edits; six is a seam that
needs one enforced exit, and the shape of the fix differs.

## Instances

- `src/lib/extensible/hook-executor.ts::executeWithHooks` — the `catch` re-throws
  to preserve the stack trace; a throw leaves the handler and the MCP SDK renders
  it as an error result, never touching `wrap`. Reached when an `afterResponse`
  hook throws. **The `beforeRequest` loop sits outside the `try` entirely**, so a
  throw there skips both `wrap` *and* the `onError` chain. The wrap fires at two
  of this function's four exits.
- `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` — the `!enabled`
  early return emits a `CallToolResult` before `wrap`.
- `src/lib/extensible/tool-wrapper.ts::registerJqToolWithHooks` — same shape,
  same early return.
- `src/lib/schema/generator.ts::createToolHandler` — the unwrapped catch arms and
  the trailing `throw error`. Covered in the `McpCurlServer` path by
  `mcp-curl-server.ts`'s outer `wrappedHandler` for the *return* arms only, not
  the throw arm. **`registerEndpointTools` is published from `src/lib.ts`**, so a
  consumer calling it directly gets the unwrapped arms with no outer adapter —
  invariant 11 surface.
- `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` —
  **suspected, not confirmed**: `applyConfigTransformsCurl` runs outside any
  `try`, so a throw from `resolveBaseUrl` on a malformed `config.baseUrl` escapes
  unwrapped. `resolveBaseUrl`'s throw conditions were not traced.

Today the `!enabled` returns carry constant server-authored text, so their
consequence is zero — they are listed because invariant 1's wording does not
admit a trust exemption, and because a future edit to those strings would inherit
the gap silently.

## Why this is not PR #37's

None of these files is in that diff. Escalated to the operator during review of
#37 and filed rather than folded into that branch. What made it worth raising
there is that #37's own already-filed findings proposed *"put the wrap where no
caller can forget it"* as a fix — advice whose shape depends on this count.

## Proposed solutions

1. **One enforced exit.** Have `executeWithHooks` convert rather than re-throw,
   so every path leaves through a single wrapped return. Largest change, and the
   only one that makes the invariant structural rather than remembered.
2. **Wrap each exit.** Five edits, mechanical, and it leaves the sixth exit to
   whoever adds it next — the failure mode this class already demonstrates.
3. **Move the wrap outward**, to the SDK registration boundary, so handlers cannot
   return unwrapped at all. Needs checking against `mcp-curl-server.ts`'s existing
   outer `wrappedHandler` to avoid double-wrapping — the idempotence tag exists,
   but relying on it turns a structural guarantee back into a runtime one.

## Acceptance criteria

- [ ] A throwing `afterResponse` hook produces a defended result, not a raw SDK error.
- [ ] A throwing `beforeRequest` hook produces a defended result **and** runs the
      `onError` chain — the two are currently coupled and both missing.
- [ ] `registerEndpointTools`, called directly as a library export, returns defended
      text on its catch arms and its throw arm.
- [ ] The assertion set matches the exit set — per `LESSONS.md` RC-21, N-1 assertions
      on N paths is a false green, and that is exactly how this class survived.

## Work log

- 2026-09-06 — filed from `/sixees-workflow:review` of PR #37. Four instances
  confirmed by architecture-strategist in round 3, one suspected and marked as
  such.

## Resources

- `ARCHITECTURE.md` → invariant 1
- `LESSONS.md` RC-20 (routing a path into a shared defence inherits its defects), RC-21 (a guard for a two-path invariant asserted it on one path)
