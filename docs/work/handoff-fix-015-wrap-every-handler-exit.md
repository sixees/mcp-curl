# Work Handoff: Return every handler exit through the wrap (todo 015)

**Date:** 2026-11-04 | **Branch:** `fix/015-wrap-every-handler-exit` | **Plan:** `docs/todos/015-P1-the-wrap-has-six-exits-and-guards-two.md` (todo; no plan document) | **Status:** complete — awaiting push/PR authorisation

## Summary

Invariant 1 says every byte returned to the model passes the post-processor wrap, error paths included. Four exits did not: a throw from a hook or custom executor escaped `executeWithHooks`, `createToolHandler` re-threw unrecognised errors, the custom-tool adapter had no catch, and the two `!enabled` refusals returned bare. A throw that escapes is rendered by the MCP SDK's `createToolError` straight into a text result — unwrapped. The fix takes todo 015's solution 1 (one enforced exit inside `executeWithHooks`) plus a catch on the outer custom-tool adapter, with one shared conversion helper, and wraps the constant refusals as server-authored. One commit, 13 files, nine new tests, six teeth probes.

## What was implemented

- **`src/lib/utils/error.ts::toolErrorResult(error)`** (+ barrel export in `utils/index.ts`) — the one conversion from a caught unknown to `{ content: [{ type: "text", text }], isError: true }`. Deliberately **not** `markServerAuthored`: the message's provenance is unknown (an embedder hook or custom executor can put remote text in it), so it takes the full defence and is spotlighted. Pattern followed: `getErrorMessage` in the same file; `*Result` naming matches `jq-query.ts::successResult`.
- **`src/lib/extensible/hook-executor.ts::executeWithHooks`** — the `beforeRequest` loop moved inside the one `try`; the `catch` runs the `onError` chain as before, then `return wrap(toolErrorResult(error), hostnameOf(ctx.params))` instead of `throw error`. The function never rejects. Docblocks (`WrapFn`, Error Handling) rewritten to describe the present.
- **`src/lib/schema/generator.ts::createToolHandler`** — the trailing `throw error` became `return fail(toolErrorResult(error))`; catch comment updated; the `utils` import list reformatted to multi-line.
- **`src/lib/extensible/mcp-curl-server.ts::registerToolsOnServer`** — `wrappedHandler` gained a try/catch returning `wrap(toolErrorResult(error), CUSTOM_TOOL_HOSTNAME_LABEL)`.
- **`src/lib/extensible/tool-wrapper.ts`** — both `!enabled` returns go through `wrap(markServerAuthored(...), label)`, matching the sibling `resolveRequestUrl` refusal in the same handler.
- **Docs moved with the code:** `docs/hooks.md` (onError description, flow diagram, *Error Handling in Hooks* — which was already false at HEAD about `afterResponse` throws, K-7), `docs/architecture/architecture.md` (flow diagram, *Error Handling* paragraph), `src/lib/types/public.ts::OnErrorHook` docblock.
- **Tests** — `tool-wrapper.test.ts` (+6: throwing beforeRequest / afterResponse / executor each reach `onError` and return a defended, wrapped `isError` result; non-Error throw; `!enabled` for both tools per RC-21), `tool-wrapper.e2e.test.ts` (+1: a throwing hook through a real in-memory MCP client — the outermost boundary, where the SDK's own error result would carry the beacon verbatim), `schema.test.ts` (+1: generator throw arm), `mcp-curl-server.test.ts` (+1: throwing custom tool, spotlighted).

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Solution 1 + outer catch, not solution 3 (wrap at SDK registration) | `registerEndpointTools`/`generateToolDefinitions` are published and consumers register the handler themselves — the library owns no registration boundary there, so the handler's own catch is the outermost layer it can guarantee (architecture-strategist concurs) | Solution 2 (wrap each exit mechanically) — leaves the next exit to whoever adds it; solution 3 — relies on the idempotence tag as a runtime guarantee |
| Thrown messages are **not** server-authored | Provenance unknown; a hook can embed remote text. Marking would skip spotlighting (RC-30 shape) | Mark server-authored (rejected — false claim) |
| `!enabled` refusals **are** server-authored and wrapped | Constant closed-grammar text; wrapped because invariant 1 admits no trust exemption and an edit to the string would inherit the gap silently | Leave bare (zero consequence today, but the invariant's wording does not permit it) |
| Resolve-with-`isError` instead of reject on a public export is not MAJOR | `architecture.md` → *Error Handling* already promised handler-boundary conversion; three of four arms already did it; return type unchanged (invariant 11) | MAJOR bump — overstates; a consumer relying on rejection relied on an arm the published contract said did not exist |
| Tool-level catch arms in `curl-execute.ts` / `jq-query.ts` left as they are | They author prefixed text and `sanitizeErrorMessage` keyed on `include_metadata`, which `toolErrorResult` cannot see; different responsibility (pattern + architecture reviewers concur). **Declined, not deferred.** | Fold into the helper with prefix/transform params — not warranted |
| `hostnameOf(ctx.params)` in the catch reads params as they stand | A hook that rewrote the URL before throwing is attributed to the rewritten host — same rule as the short-circuit exit | Snapshot pre-hook params — wrong attribution |
| No CHANGELOG entry | This repo writes the changelog in the release PR (no *Unreleased* section) | — |

## What to pay attention to during review

- **Security-sensitive:** every line in `hook-executor.ts`, `generator.ts`, `mcp-curl-server.ts::registerToolsOnServer`, `tool-wrapper.ts` — these are invariant 1's exits. `security-sentinel` (Surface 2) enumerated every model-facing exit at HEAD and found all wrapped.
- **Residual escape, declined on population:** a hook that throws an object whose `toString`/`message` getter throws, or that replaces `ctx.params` with a throwing Proxy, escapes from inside the catch to the SDK. The thrower is the embedder's own code; not someone this project defends against (`42-ship-what-matters.md`). Hardening shape if ever wanted: an inner try around the two `String()` reads and the label read, falling back to `"unknown"`.
- **Contract widening:** `onError` now fires for `beforeRequest` throws, where no request was sent — a hook counting "failed requests" now counts refusals that cost upstream nothing.
- **SDK elicitation:** the adapter now converts `McpError(UrlElicitationRequired)`, which the SDK deliberately re-throws for the elicitation flow. Zero uses in this repo; docs say "never rejects" without naming the exception.
- **Pre-existing, out of diff:** for custom tools with an `outputSchema`, `structuredContent` is carried by reference through the wrap undefended, and `validateToolOutput`'s zod message is rendered unwrapped after the handler returns. Invariant 1 gaps worth their own todo if output schemas are used.
- **Pre-existing, out of diff:** invariant 14's inline bound is not applied to consumer-supplied text at the error door, the custom-tool door or the short-circuit door (performance-oracle).

## Known issues and limitations

- Review findings 019, 020 and 021 were **applied on this branch after the operator chose to** (third commit; see *Review fixes applied* below). Nothing from the review is left open.
- The unused `ToolResult` import in `tool-wrapper.ts` was pre-existing at base; removed with 019 as the out-of-scope one-liner.
- `hooks: Partial<Hooks>` spread in the test helpers is sound under `strict` without `exactOptionalPropertyTypes`; an explicit `undefined` would break at runtime (none passed).

## Testing summary

- **Added:** 9 tests (see above). **Teeth:** six probes — hook-executor catch re-throw (unit: 4 red; e2e: 1 red), curl `!enabled` unwrapped (1 red), jq `!enabled` unwrapped (1 red), generator re-throw (1 red), custom-tool adapter without catch (1 red) — each failed only its named test; sources restored from `cp` backups and `cmp`-verified.
- **Verdict source:** `npm test -- --reporter=json --outputFile=<scratch>/vitest-results.json`, parsed structurally: `success: true`, 345/345 suites, **1807 tests — 1800 passed, 0 failed, 7 pending**, exit 0. The declared command ran (`tsc --noEmit` then `vitest run`); type-check clean. Caveat per `/work` Step 5: vitest's JSON reporter is not on that step's trusted-mode list, so the operator's own run is the formal floor; the artefact is offered as evidence, not certification.
- **Lint:** no lint script in `package.json`; the type-check is the gate.
- **Gaps:** no test for the throwing-`toString` residual (declined); no test that `onError` sees the mid-mutation params (documented, not asserted).

## Commit history

```
3bc9e17 fix(extensible): return every handler exit through the wrap
```
(`git log main..HEAD` — base `d0709908`; hooks bypassed with `-c core.hooksPath=/dev/null`; `core.hooksPath` unset and `.git/hooks` holds only samples, so nothing real was skipped.)

## Review context

- **Suggested order:** `utils/error.ts::toolErrorResult` → `hook-executor.ts::executeWithHooks` → `tool-wrapper.ts` (`!enabled`) → `generator.ts::createToolHandler` catch → `mcp-curl-server.ts::registerToolsOnServer` → tests in the same order → docs.
- **Invariants:** 1 (the subject), 9 (idempotence tag — relied on by the double-wrap composition), 11 (public contract — judged not broken), 10 (`utils/` gained no upward edge).
- **RCs relevant:** RC-20 (a path newly routed through the wrap inherits its defects — the error channel takes the same linear-before-256-KB pipeline as a custom-tool result), RC-21 (assertion set = exit set), RC-16, RC-30, RC-31, RC-46 (the class 019 recurs), RC-65 (refusal text says "disabled", never "not exposed").
- **Working tree:** `main` carried the operator's uncommitted 2026-11-02 backlog edits (todo deletions, 015/018 audit edits, comment-only edits in three `src` files, untracked `docs/{brainstorms,plans,work/backup,work/plan-research}`). They ride on this branch unstaged; nothing of theirs is in `3bc9e17`.

## Review fixes applied — 2026-11-04

Operator chose "fix 019–021, then ready-pr". Third commit on the branch:
- **019** — preset arm and its comment deleted from `generator.ts::createToolHandler`; the reason folded into the catch comment. Unused `ToolResult` import dropped from `tool-wrapper.ts`. The existing invalid-preset test passes unchanged against the deleted arm.
- **020** — `McpCurlServer.onError()` docblock rewritten to the `OnErrorHook` wording; `architecture.md` → *Stage notes* now says "return and any throw it makes" and points at *Error Handling*; *Error Handling* names the two `Error` subclasses instead of claiming none exist.
- **021** — typed mocks (`vi.fn<OnErrorHook>()`, `vi.fn<CurlToolExecutor>()`, `vi.fn<JqToolExecutor>()`) in the two new describe blocks; `as never` casts removed there.
- Full suite after the fixes: `success: true`, 1807 tests, 1800 passed, 0 failed, 7 pending; type-check clean. Todos 019–021 marked complete with ACs ticked.

## Follow-up work

- [x] Apply 019, 020, 021 — done on this branch
- [ ] Decide whether the pre-existing `outputSchema` gaps (`structuredContent`, `validateToolOutput`) earn a todo
- [ ] CHANGELOG line in the next release PR: handlers resolve with `isError` instead of rejecting; `onError` fires for `beforeRequest` throws
- [ ] Todo ids 020/021 were reissued over uncommitted deletions — renumber if the rebinding matters

### Outstanding Todos

| file | priority | description | source |
|---|---|---|---|
| — | — | none from this branch | — |

### Resolved Todos

| id | title | summary | by | date |
|---|---|---|---|---|
| 015 | The defence wrap has six unwrapped exits and guards two of them | Every remaining exit (hook-executor throws, generator throw arm, custom-tool adapter, both `!enabled` refusals) now leaves through the wrap; one assertion per exit; teeth probed | Claude Code (/sixees-workflow:work) | 2026-11-04 |
| 019 | A special-case catch arm now produces exactly what the general fall-through produces | Preset arm deleted; unused import dropped | Claude Code (/sixees-workflow:work) | 2026-11-04 |
| 020 | Three prose sites still state the throw contract this change inverted | `onError()` docblock and two `architecture.md` sentences corrected | Claude Code (/sixees-workflow:work) | 2026-11-04 |
| 021 | New hook tests reach typed hook contracts through untyped mocks | Typed `vi.fn<T>()` in the new blocks | Claude Code (/sixees-workflow:work) | 2026-11-04 |

## Code Review — 2026-11-04

**Certification:** complete
**Roster closure:** closed · unresolved: `performance-oracle` → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; `pattern-recognition-specialist` → "The correctness of any single instance → whichever reviewer owns that lane"; `data-integrity-guardian` → "Anything else outside your lane gets one line under `notes:` and no finding"
**Diff:** base `d0709908` (`git merge-base --fork-point origin/HEAD HEAD`) → `3bc9e17`, 13 files all `M`
**Agents:** security-sentinel (clean), code-simplicity-reviewer (2), data-integrity-guardian (clean), learnings-researcher (digest, 13 RC hits), architecture-strategist (1), pattern-recognition-specialist (1), performance-oracle (clean), typescript-reviewer (3). All returned. Four no-Bash reviewers declared whole-file judgement of the modified files.
**Findings:** 7 → 3 classes — P1 0 | P2 1 (RC-46 raise) | P3 2. Filed 3, declined 0, investigate-first 0, escalated 0, rejected 0.

**Handoff assessment:** none existed at review time; the commit message's claims were verified (exit enumeration by security-sentinel; invariant 11 by architecture-strategist; teeth by the orchestrator's own probes). Undisclosed and found by review: the redundant preset arm; the `onError()` docblock.

| Severity | Category | Class | Todo |
|---|---|---|---|
| P2 | dead-code (alias duplicated-logic) | special-case catch arm equals the fall-through | 019 |
| P3 | stale-comment | three prose sites state the inverted contract | 020 |
| P3 | convention-drift | untyped mocks in new tests | 021 |

| Handoff / commit claim | Verified | Result |
|---|---|---|
| Every model-facing exit passes the wrap | security-sentinel enumerated all exits + SDK `createToolError` | holds |
| One assertion per exit, teeth probed | orchestrator ran 6 probes earlier this session | holds (reviewers read-only) |
| Not a MAJOR bump | architecture-strategist vs documented *Error Handling* contract | holds |
| Tool-level arms are a justified decline | pattern + architecture reviewers | holds |
| Docs describe the present | architecture-strategist sweep | **partly** — two `architecture.md` sentences + `onError()` docblock stale → 020 |

**Outstanding todos:** 019, 020, 021 (table above). **Open without a todo:** none. **Blockers:** none.
