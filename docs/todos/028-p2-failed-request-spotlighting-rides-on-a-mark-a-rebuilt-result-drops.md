---
status: complete
severity: medium
effort: m
tags: [code-review, security, post-processor, spotlighting, custom-tools, curl-execute, docs]
dependencies: []
---

# Spotlighting a failed request rides on a mark that a rebuilt result drops

## Problem Statement

The wrap decides whether to spotlight an `isError` result from a module-private mark that `markRemoteContent` sets. A missing mark resolves to "server-authored, do not spotlight", which is the permissive direction. Any step that rebuilds the result object drops the mark, and the documented custom-tool pattern does exactly that. A hostile origin that sends a body and then stalls (cURL exit 28) or truncates (exit 18) gets its text to the model without sentinels, which is the bypass the mark exists to prevent. This branch introduced it: in 5.2.0 the same transfer carried no `isError`, so the documented handler took its success arm and the wrap spotlighted the output.

## Findings

- class: a security decision depends on a hidden runtime mark that the public result type does not carry; copying or rebuilding the result drops the mark, and its absence resolves to "no spotlighting".
- aliases: `misplaced-decision` (architecture-strategist).
- failure: an embedder sets `enableSpotlighting: true` and writes a custom tool as `docs/custom-tools.md` shows. The origin sends a JSON body carrying injected instructions, then stalls. `executeCurlRequest` returns `isError: true` with the body in `content[0]`; the handler's `if (result.isError)` arm copies that text into a new `{ content, isError: true }`; the custom-tool adapter wraps it, `hasOwnTag(result, REMOTE_CONTENT)` is false, and the origin's text reaches the model unspotlighted. Sanitise and detect still run. The embedder cannot re-mark it: `markRemoteContent` is not exported from `mcp-curl` or `mcp-curl/lib`.
- instances:
  - `src/lib/response/post-processor.ts::createWrapper` — `config.enableSpotlighting && (!result.isError || hasOwnTag(result, REMOTE_CONTENT))` — confirmed, in diff
  - `src/lib/tools/curl-execute.ts::executeCurlRequest` — the mark exists only at runtime; `CurlExecuteResult` does not declare it — confirmed, in diff
  - `docs/custom-tools.md` → *Using Instance Utilities*, the `get_user_profile` handler — rebuilds `result.content[0]?.text` into a new error object — confirmed, out of diff
  - `docs/custom-tools.md` → *Complete Example: Weather API Tool*, the `get_weather` handler — the same rebuild, prefixed `Weather API error:` — confirmed, out of diff
  - `src/lib/extensible/mcp-curl-server.ts`, the custom-tool registration adapter — `wrap(result, CUSTOM_TOOL_HOSTNAME_LABEL)` on whatever the handler built — confirmed, out of diff
  - `src/lib.ts` / `src/lib/index.ts` — `markRemoteContent` is not re-exported — confirmed, out of diff
  - `src/lib/tools/curl-execute.ts::executeCurlRequest`, the catch arm — returns `isError` unmarked beside a comment saying error messages "can echo remote content" — suspected (pre-existing; not traced past `sanitizeErrorMessage`)
- sweep:
  - typescript-reviewer: every route from `executeCurlRequest` to a `wrap()` (`executeWithHooks`, `generator.ts::createToolHandler`, the custom-tool adapter, `instance-utilities.ts::executeRequest`) — 4 candidates → 0 in-repo paths that drop the mark; the dropping path runs through embedder code.
  - pattern-recognition-specialist: `rg -n 'executeRequest' docs/custom-tools.md` — 5 hits → 2 handlers branching on `isError` → 2 confirmed.
  - architecture-strategist: `markRemoteContent|isError|REMOTE_CONTENT` over non-test `src` — 19 lines → 1 consumer of the mark; `executeCurlRequest|executeRequest\(` over README and docs — 2 documented recompositions → 2 confirmed.
  - Reproduced by the orchestrator: `rg -n -A4 'if \(result\.isError\)' docs/custom-tools.md` → the two rebuilds; `rg -n markRemoteContent src -g '!*.test.ts'` → one production caller.
- root: source. The mark defaults to the permissive direction; each rebuild only exposes that default.
- Found by: typescript-reviewer, pattern-recognition-specialist and architecture-strategist, Surface 2 review of `fix/sync-quota-and-failed-exit`, 2026-10-30. Three independent lanes converged on it.

## Proposed Solutions

### Option 1: Invert the mark so losing it fails safe
With spotlighting on, the wrap spotlights every result unless it carries a module-private `SERVER_AUTHORED` mark, set only where this repository wrote the text: local refusals, `resolveRequestUrl` errors, disabled-tool results, and the generator's auth and preset errors. A rebuilt result that loses the mark is spotlighted.
- Pros: closes the class, including copies nobody remembers to update. K-2 resolves the safe way.
- Cons: an embedder's own custom-tool error text becomes spotlighted, a behaviour change to weigh. More sites to mark.
- Effort: m. Risk: medium; test pins on unspotlighted error text will move.

### Option 2: Export `markRemoteContent` and fix the two doc handlers
Change both handlers to `if (result.isError) return result;`, export `markRemoteContent` for a handler that has to reshape the text, and say in *Composing the Full Defence* that a rebuilt result must be re-marked.
- Pros: small; no change for server-authored errors.
- Cons: fixes only the copies someone updates; adds public API.
- Effort: s. Risk: low.

### Option 3: Change only the two doc handlers
`return result` in both examples, plus a sentence on why.
- Pros: smallest; no new API.
- Cons: an embedder who has to reshape a failed result still has no way to keep spotlighting.
- Effort: s.

## Recommended Action

Option 1, chosen by the operator on 2026-10-30 ("Fix now, invert the mark"): with spotlighting on, spotlight every result unless a module-private server-authored mark says this repository wrote the text, so a lost mark fails safe. Accepted cost: an embedder's own custom-tool and hook short-circuit error text becomes spotlighted.

## Acceptance Criteria

- [x] A custom tool written as `docs/custom-tools.md` shows, with `enableSpotlighting: true` and an executor stubbed to exit 28 after a JSON body, returns text that starts with `---EXTERNAL-CONTENT-BEGIN-`.
- [x] The test fails with the fix removed.
- [x] `docs/custom-tools.md` says how a handler keeps a failed request spotlighted.

## Work Log

### 2026-10-30 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** merged typescript-reviewer's and pattern-recognition-specialist's `fail-open-default` (P2) and architecture-strategist's `fail-open-default` (P2, alias `misplaced-decision`) on the shared confirmed instances `post-processor.ts::createWrapper` and the two `docs/custom-tools.md` handlers.
**Learnings:** a defence keyed on a mark that rides on object identity fails open at the first copy; the code's own docs taught the copy.

### 2026-10-30 - Resolved on fix/sync-quota-and-failed-exit
**By:** Claude Code
**Actions:** commit `761093c`. `src/lib/response/post-processor.ts::createWrapper` now spotlights every result unless `markServerAuthored` set a module-private `SERVER_AUTHORED` symbol; `REMOTE_CONTENT` and `markRemoteContent` are deleted. Marked: the `LocalRefusalError` arm of `tools/curl-execute.ts::executeCurlRequest`, the `resolveRequestUrl` error in `extensible/tool-wrapper.ts::registerCurlToolWithHooks`, and the `AuthenticationError` and `LocalRefusalError` arms of `schema/generator.ts::createToolHandler`. Left unmarked on purpose: the generic cURL error, `jq_query` errors, the preset error, hook short-circuits, custom-tool results. `docs/custom-tools.md` → *Composing the Full Defence* step 2 says a tool's error results are spotlighted, so the documented handlers need no change. Acceptance test: `mcp-curl-server.test.ts` "spotlights a custom tool's error result, such as a rebuilt failed request"; it and five more fail with the wrap reverted to the `isError` rule (measured, restored from a `cp` backup). Each mark has a test at the wrap it reaches, and each fails with its mark removed.
**Learnings:** the first pair of generator tests called the handler directly, skipping the custom-tool wrap where the mark is read; removing both marks failed nothing (K-1). They now run through `registerCustomTool`.
