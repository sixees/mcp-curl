---
status: pending
severity: low
effort: s
tags: [code-review, duplicated-logic, tests, extensible, tool-wrapper]
dependencies: []
---

# Fake-`registerTool` handler-capture arrangement copied inline per test

## Problem Statement

Tests that need a registered tool handler each build their own fake server whose
`registerTool` stores the handler and discards the meta. That skips the SDK's
input parse and hides which `inputSchema` was registered — which, since
`feat/embedder-base-url`, depends on `config.baseUrl`. The same branch added
`in-memory-client.test-fixture.ts::connectInMemory`, whose header names this
arrangement as how `baseUrl` shipped broken, and also added one more inline copy.

Failing case: if schema selection regressed (strict schema registered with a
`baseUrl`), the new capture test in `tool-wrapper.test.ts` → "registerCurlToolWithHooks
— baseUrl resolution error" still passes `{ url: "/users" }` straight to the handler
and stays green. The e2e suite covers the SDK path but cannot see the wrap tag, so
the invariant-1 assertion for that path rests on the capture copy alone.

## Findings

- instances:
  - `src/lib/extensible/tool-wrapper.test.ts` → "registerCurlToolWithHooks — baseUrl resolution error" — added by this diff — confirmed
  - `src/lib/extensible/tool-wrapper.test.ts` → "post-processor wrap (registerCurlToolWithHooks integration)" — 8 pre-existing inline copies — confirmed (out of the diff; sibling instances)
  - `src/lib/tools/register-all-tools.test.ts::registerViaShippedPath` — already a local helper — confirmed (out of the diff)
  - `src/lib/extensible/mcp-curl-server.test.ts` → "PR-6b custom-tool wrap (registerToolsOnServer)" — `beforeEach` capture — confirmed (out of the diff)
- sweep: `rg -n 'registerTool:\s*\(|registerTool: \(' src -g '*.test.ts'` plus
  `rg -n 'capturedHandler' src` → 11 candidates → 11 confirmed.
- Reviewer: pattern-recognition-specialist (P3, confidence medium).

## Proposed Solutions

### Option 1: one capture fixture

Extract `captureToolRegistration(register, options)` beside
`in-memory-client.test-fixture.ts`, returning `{ handler, meta }` per tool name;
route the copies through it and assert `meta.inputSchema` where it matters.
**Effort:** s · **Risk:** low

### Option 2: assert the schema in the one new copy only

Record `_meta` in the new test and assert `meta.inputSchema === CurlExecuteBaseUrlSchema`.
**Effort:** s · **Risk:** low — leaves the 10 other copies as they are.

## Recommended Action

_Unfilled — needs the operator's call._

## Acceptance Criteria

- [ ] A test fails if `registerCurlToolWithHooks` registers the strict schema on a `baseUrl` server, without going through the SDK client
- [ ] The capture arrangement exists once

## Work Log

### 2026-10-20 - Filed by /sixees-workflow:review (Surface 2)

**By:** Claude Code
**Actions:** Dispositioned in scope (confirmed instance added by diff `8edf9e7..HEAD`).
