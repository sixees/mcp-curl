---
status: pending
severity: medium
effort: s
tags: [code-review, correctness, extensible, tool-registration, curl-execute-description]
dependencies: []
pr: ""
---

# A diagnostic claims the description append is never shown, but the layer that registers the tool shows it

## Problem Statement

`start()` warns that `curlExecuteDescriptionAppend` "is set but curl_execute is disabled, so it is
never shown", and `docs/configuration.md` says the same. Both are false: a disabled `curl_execute`
is still registered and listed, with the append composed onto its description. An embedder that
disables the tool is told the append costs nothing, while every `tools/list` and every turn still
carries it.

Class (`misplaced-decision`): a diagnostic and its documentation make a claim about whether text
reaches the model, decided from a flag that the registering layer does not consult for that purpose.

## Findings

Filed by `/sixees-workflow:review` (Surface 2) on branch `feat/curl-execute-description-append`
(plan `docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md`, PR-3). Reviewer:
architecture-strategist. Confirmed by the orchestrator against the code.

- **Failure:** `configure({ curlExecuteDescriptionAppend: "..." }).disableCurlExecute()` → `start()`
  logs "never shown"; `registerToolsOnServer` still calls `registerCurlToolWithHooks` with
  `enabled: false`, which registers `curl_execute` unconditionally with the composed meta. The
  append reaches the model on every turn.
- **Instances (all in this diff, all confirmed):**
  - `src/lib/extensible/mcp-curl-server.ts::McpCurlServer.start` — the warning's claim
  - `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` — composes `description` from
    `append` without consulting `enabled`; `enabled` gates only the handler
  - `docs/configuration.md` → *curlExecuteDescriptionAppend* — "Only where it can be seen"
- **Out-of-scope sibling (same premise, not in this diff):**
  `src/lib/api-server.ts::createApiServer` docblock — `disableCurlExecute: true, // Only expose
  generated tools`; a disabled tool is still listed.
- **Sweep:** `rg 'disableCurlExecute|is disabled' docs README.md src` → 3 candidates in diff-touched
  files → 3 confirmed; plus 1 out-of-scope sibling.
- **Root:** source. The registrar is the only layer holding both `enabled` and `append` when the
  description is built.

## Proposed Solutions

### Option 1: Compose the append only when the tool is enabled

**Approach:** in `registerCurlToolWithHooks`, `...(enabled && append && { description: ... })`. The
warning and the doc sentence then become true as written.

**Pros:** one line; matches the plan's intent ("a knob that does nothing must say so").
**Cons:** the disabled tool is still listed (pre-existing behaviour), just without the append.
**Effort:** s · **Risk:** low

### Option 2: Keep the composition, correct the claim

**Approach:** reword the warning and the doc to "the tool is disabled but still listed, with your
append".
**Pros:** no behaviour change.
**Cons:** the embedder keeps paying for text attached to a tool the model cannot use.
**Effort:** s · **Risk:** low

### Option 3: Do not register a disabled curl_execute at all

**Approach:** skip `registerTool` when `enabled` is false.
**Pros:** fixes the out-of-scope sibling too.
**Cons:** changes `tools/list` for every embedder that disables the tool (invariant 11, wider than
this slice).
**Effort:** m · **Risk:** medium

## Recommended Action

(Operator's call. Reviewer suggested Option 1.)

## Acceptance Criteria

- [ ] Through `connectInMemory`, a server with `curlExecuteDescriptionAppend` set and
      `enabled: false` lists a `curl_execute` description that does not contain the append (or the
      warning and doc are corrected, per the option chosen)
- [ ] The `start()` warning text and `docs/configuration.md` agree with the registered listing
- [ ] Teeth probe: reverting the fix fails the named test

## Work Log

### 2026-10-23 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** `/sixees-workflow:review` on `feat/curl-execute-description-append`; finding from
architecture-strategist, confirmed by reading `registerToolsOnServer` and `registerCurlToolWithHooks`.
**Learnings:** `enabled` gates the handler, not the listing; any claim about visibility has to be
made where the listing is built.
