---
id: 015
title: "The defence wrap has six unwrapped exits and guards two of them"
status: complete
severity: P1
tags: [code-review, security, invariant-1]
class-id: unwrapped-multi-write
source: /sixees-workflow:review of PR #37 (Surface 2, round 3, architecture-strategist)
reviewers: [architecture-strategist, security-sentinel]
created: 2026-09-06
---

# The post-processor wrap has six exits and guards two

> **AUDITED 2026-11-02 against main at `d070990` (5.3.0): partly fixed, still open.**
> Closed since filing: `generator.ts::createToolHandler`'s **catch arms** (PR #55
> routes each through `fail = (result) => wrap(result, safeHostname(...))`), and the
> **suspected `baseUrl` instance** (`utils/url.ts::resolveRequestUrl` throws inside a
> `try`, and the refusal is wrapped in `registerCurlToolWithHooks`). **What remains
> is the throw arms and the `!enabled` returns** — see *Remaining scope* below.
> The instance list under it is the record as filed.

## Remaining scope (audit 2026-11-02)

| Exit | State |
|---|---|
| `hook-executor.ts::executeWithHooks` — `beforeRequest` loop outside the `try` | **Open.** Its own docblock says "A hook that THROWS is not covered"; also skips `onError` |
| `hook-executor.ts::executeWithHooks` — catch ends in `throw error` (an `afterResponse` hook or the executor throwing) | **Open** |
| `generator.ts::createToolHandler` — trailing `throw error` | **Open.** The catch arms are wrapped; the rethrow is not |
| `mcp-curl-server.ts` outer `wrappedHandler` | Wraps returns only; has **no catch**, so it covers none of the throws above |
| `tool-wrapper.ts::registerCurlToolWithHooks` / `::registerJqToolWithHooks` — `!enabled` early return | **Open**, constant server-authored text, zero consequence today |
| `tool-wrapper.ts::registerCurlToolWithHooks` — `baseUrl` throw (suspected) | **Closed** — see banner |
| `generator.ts::createToolHandler` — catch arms | **Closed** by PR #55 |

**Who can reach what remains.** The shipped executors never throw:
`executeCurlRequest` and `executeJqQuery` convert every error into an `isError`
result. So remote bytes reach an unwrapped exit only through **an embedder's own
hook or custom executor** throwing an error whose message carries response text.
The single consumer is an embedder, so that population is not empty — but it is
the consumer's own code, not the remote alone.

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

- [x] A throwing `afterResponse` hook produces a defended result, not a raw SDK error.
      *(`tool-wrapper.test.ts` → "a throwing afterResponse hook returns a defended error
      result and reaches onError")*
- [x] A throwing `beforeRequest` hook produces a defended result **and** runs the
      `onError` chain — the two are currently coupled and both missing.
      *(`tool-wrapper.test.ts` → "a throwing beforeRequest hook …"; and through a real
      MCP client in `tool-wrapper.e2e.test.ts`)*
- [x] `registerEndpointTools`, called directly as a library export, returns defended
      text on its catch arms and its throw arm. *(Audit 2026-11-02: the catch arms
      are done in PR #55; the throw arm is not.)* *(Throw arm: `schema.test.ts` →
      "returns an unrecognised error as a defended error result rather than rejecting")*
- [x] The assertion set matches the exit set — per `LESSONS.md` RC-21, N-1 assertions
      on N paths is a false green, and that is exactly how this class survived.
      *(One test per exit: three throw sites, both `!enabled` tools, the generator
      throw arm, the custom-tool adapter; six teeth probes each red on only its own test)*

## Work log

- 2026-09-06 — filed from `/sixees-workflow:review` of PR #37. Four instances
  confirmed by architecture-strategist in round 3, one suspected and marked as
  such.
- 2026-11-02 — audited against main at `d070990`. The generator's catch arms (PR #55)
  and the suspected `baseUrl` exit are closed; the hook-executor throws, the
  generator's rethrow and the two `!enabled` returns remain. Proposed solution 1
  (convert rather than re-throw in `executeWithHooks`) plus a catch on the outer
  `wrappedHandler` would cover every open throw. The banner and *Remaining scope*
  hold the detail.
- 2026-11-04 — **resolved** on branch `fix/015-wrap-every-handler-exit`, commit
  `3bc9e17`, by `/sixees-workflow:work`. Solution 1 plus the outer catch, as the
  2026-11-02 entry proposed: `utils/error.ts::toolErrorResult` is the one conversion;
  `hook-executor.ts::executeWithHooks` holds the hook loops and the executor in one
  `try` and its `catch` returns through `wrap` (never rejects); `generator.ts::
  createToolHandler`'s throw arm and `mcp-curl-server.ts::registerToolsOnServer`'s
  adapter convert the same way; both `!enabled` refusals go through
  `wrap(markServerAuthored(...))`. Surface 2 review certified complete with no P1;
  three `s` follow-ups filed (019, 020, 021). Handoff:
  `docs/work/handoff-fix-015-wrap-every-handler-exit.md`.

## Resources

- `ARCHITECTURE.md` → invariant 1
- `LESSONS.md` RC-20 (routing a path into a shared defence inherits its defects), RC-21 (a guard for a two-path invariant asserted it on one path)
