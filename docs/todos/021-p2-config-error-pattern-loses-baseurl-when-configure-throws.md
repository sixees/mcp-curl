---
status: complete
effort: s
tags: [code-review, documentation, getting-started, hooks, baseUrl, configure]
dependencies: []
---

# A documented error report runs after a gate whose shape depends on the config that failed

## Problem Statement

`docs/getting-started.md` → *Reporting a configuration error* puts every option, `baseUrl` included, in one `configure()` call inside the `try`. A throw rejects the whole call (`configure()` parses before it merges), so `baseUrl` stays unset and `curl_execute` registers with the strict absolute-URL schema. The embedder this section is written for (one API behind `baseUrl`) has a model that calls `curl_execute({ url: "/users" })`. That call fails schema validation before any `beforeRequest` hook runs, so the model sees a URL-format error, never the configuration reason. The `curlExecuteDescriptionAppend` from the same rejected call is also lost.

## Findings

- class: an error report is placed in a layer that runs after an earlier gate, and that gate's behaviour depends on the state whose failure is being reported.
- instances:
  - `docs/getting-started.md::Reporting a configuration error`, the example and its last bullet ("A malformed call still gets the schema's error"), which does not say a relative `url` becomes malformed in exactly this state. **confirmed**
- sweep: `configError|not configured` across `docs/*.md`, `README.md`, `docs/architecture/` → 1 candidate, 1 confirmed. `baseUrl.*(Schema|schema)` in `src` → the schema is chosen once, `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks` (`config.baseUrl && { inputSchema: CurlExecuteBaseUrlSchema }`).
- root: symptom. Choosing the schema at `start()` from `_config.baseUrl` is correct and stays; the doc pattern does not account for it.
- Found by: architecture-strategist (`misplaced-decision`), Surface 2 review of `docs/release-5.1.0`, 2026-10-26.

## Proposed Solutions

### Option 1: Two `configure()` calls (recommended by the reviewer)
Configure the static, non-throwing options (`baseUrl`, `curlExecuteDescriptionAppend`) first, outside the `try`. Then configure what can fail inside it. The relative-url schema and the API description survive a config failure, and the hook sees the call.
- Pros: the reported reason actually reaches the model on the persona's commonest call.
- Cons: the example is a little longer; the reader must know which options can throw.

### Option 2: Keep the example and add a caveat
Add a bullet saying that a failed `configure()` leaves `baseUrl` unset, so relative URLs get the schema error.
- Pros: one sentence.
- Cons: documents the failure instead of avoiding it.

## Recommended Action

_Option 1 (operator, 2026-10-26: "fix 021-023 first")._ Fixed options go in their own `configure()` call before the `try`.

## Acceptance Criteria

- [x] The section's example, followed as written with `EXAMPLE_API_KEY` unset, answers `curl_execute({ url: "/x" })` with the configuration reason, not a schema error, or the section states plainly that it does not.
- [x] Optional: an integration case (through `connectInMemory`) that builds the documented server with the key unset and asserts the reason text.

## Work Log

### 2026-10-26 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** Filed from the `/sixees-workflow:review` pass inside `/sixees-workflow:work` PR-4 (branch `docs/release-5.1.0`). Checked against `src/lib/extensible/mcp-curl-server.ts::configure` ("a throw leaves the config as it was") and `tool-wrapper.ts::registerCurlToolWithHooks`.
**Learnings:** The snippet was type-checked but not run; the defect is in the composition of `configure()` atomicity and schema selection (K-5).

### 2026-10-26 - Fixed (19fed56)
**By:** Claude Code
**Actions:** `docs/getting-started.md::Reporting a configuration error` now configures `baseUrl` and `curlExecuteDescriptionAppend` first, outside the `try`, and adds a bullet explaining why. A scratch test drove both shapes through `connectInMemory` against the real `McpCurlServer.start()`, then was deleted. The old shape answered `curl_execute({url: "/users"})` with "Input validation error … format url"; the new one answered "This server is not configured: EXAMPLE_API_KEY is not set". No permanent test was added: it would guard a doc snippet, and the composition it checks is covered by the existing `configure()` atomicity and schema-selection tests.
