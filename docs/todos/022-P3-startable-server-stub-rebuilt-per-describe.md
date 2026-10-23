---
status: pending
severity: low
effort: s
tags: [code-review, duplication, tests, extensible, test-fixtures]
dependencies: []
pr: ""
---

# The no-op McpServer stub for start("stdio") is rebuilt inline in each describe block

## Problem Statement

The test arrangement that stands in for the MCP server lifecycle — `captureTools` with no-op
`connect` / `close` / `registerResource` / `registerPrompt`, plus a `createServer` spy — is copied
into each describe block that calls `start("stdio")`, instead of living in the fixture module that
already exists for it. This branch added the third copy. `.claude/rules/02-reuse-first.md` names "a
test arrangement" as a near-copy to extract.

Class: `duplicated-logic`. Reviewer confidence: low (a maintenance smell with a stated cost, not a
correctness trace).

## Findings

Filed by `/sixees-workflow:review` (Surface 2) on branch `feat/curl-execute-description-append`
(plan `docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md`, PR-3). Reviewer:
pattern-recognition-specialist (jscpd, 90-token clone).

- **Failure:** if `McpCurlServer.start()` starts calling another McpServer member, each copy needs
  its own edit; patching one leaves the others red. Loud (`is not a function`), not silent.
- **Instances (all confirmed):**
  - `src/lib/extensible/mcp-curl-server.test.ts::describe("McpCurlServer curlExecuteDescriptionAppend").beforeEach` — added by this diff
  - `src/lib/extensible/mcp-curl-server.test.ts::describe("PR-6b custom-tool wrap (registerToolsOnServer)").beforeEach`
  - `src/lib/extensible/mcp-curl-server.test.ts::describe("McpCurlServer rateLimit lifecycle").beforeEach`
- **Sweep:** `rg -n -A8 'captureTools\(' src --glob '*.test.ts'` → 14 call sites → 3 confirmed with
  the full lifecycle set + `createServer` spy (+11 unconfirmed-as-this-shape; e.g.
  `register-all-tools.test.ts` never starts a server). Orchestrator re-count:
  `rg -c 'registerPrompt: vi.fn\(\)' src/lib/extensible/mcp-curl-server.test.ts` → 3.

## Proposed Solutions

### Option 1: Extract `captureStartableServer()` into the fixture

**Approach:** add to `src/lib/extensible/tool-capture.test-fixture.ts` a helper returning
`{ server, tools, connect, close }` with the lifecycle no-ops, and use it in all three `beforeEach`
blocks (the spy on `createServer` stays at the call site or moves in too).
**Pros:** one arrangement; satisfies rule 02. **Cons:** touches two pre-existing describe blocks.
**Effort:** s · **Risk:** low

### Option 2: Leave as is

**Pros:** no churn. **Cons:** rule 02 says extract at the second copy; this is the third.
**Effort:** — · **Risk:** low

## Recommended Action

(Operator's call. Reviewer suggested Option 1.)

## Acceptance Criteria

- [ ] One helper builds the startable stub; the three describe blocks call it
- [ ] `rg -c 'registerPrompt: vi.fn\(\)' src/lib/extensible/mcp-curl-server.test.ts` → 0
- [ ] All three describe blocks stay green

## Work Log

### 2026-10-23 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** `/sixees-workflow:review` on `feat/curl-execute-description-append`; finding from
pattern-recognition-specialist; sweep re-counted by the orchestrator (3).
**Learnings:** `captureTools` takes caller-supplied members, so every lifecycle test re-spells the set.
