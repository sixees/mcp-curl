---
status: complete
effort: s
tags: [code-review, tool-description, file-saver, temp-files, retention, docs]
dependencies: []
---

# The tool description promises saved bodies are deleted, and carries text the model cannot act on

## Problem Statement

The `curl_execute` description, sent on every turn, keeps a *Temp File Lifecycle* block: files are "Stored in a secure temp directory", "Deleted on graceful server shutdown", and orphans "cleaned on next server start". Files written to a caller-chosen `output_dir` or `MCP_CURL_OUTPUT_DIR` are never deleted by mcp-curl, so the promise is false there. The block is also operator knowledge — signals, file modes, a temp prefix to check after a crash — that the model cannot act on. The same trimmed description keeps three generic *Error Handling* bullets that restate the `Returns` envelope, and the `include_headers` describe explains `headers_unsupported` twice.

## Findings

- class: a per-turn, model-facing statement of persisted-artefact retention that is wider than the deletion path delivers, in a block of text the model can neither act on nor lacks elsewhere.
- aliases: `dead-code` (code-simplicity-reviewer). Merged with data-integrity-guardian's `unretained-pii` on the shared confirmed instance `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`.
- failure: an operator sets `MCP_CURL_OUTPUT_DIR=/var/data/mcp`, or the model passes `output_dir`. Every non-JSON, over-cap or `save_to_file` body is written there and survives shutdown, while the description says it is deleted. Anyone relying on that statement for data hygiene is wrong about where the data still is. Separately, every turn pays for the lifecycle block and the generic error bullets, and none of it changes what the model sends.
- instances:
  - `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`, the *Temp File Lifecycle* block — confirmed (kept by plan task 17 without a stated reason)
  - `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`, the three generic *Error Handling* bullets; the `jq_filter` bullet is pinned by a test and stays — confirmed
  - `src/lib/server/schemas.ts::CurlExecuteSchema`, the `include_headers` describe's "Capture requires macOS…" sentence duplicating the `headers_unsupported` clause — confirmed
  - `src/lib/response/file-saver.ts::saveResponseToFile` — `outputDir ?? await getOrCreateTempDir()`, the code the claim misdescribes — confirmed, out of diff
- sweep:
  - data-integrity-guardian: `(?i)cleaned|deleted on|shutdown|orphan|temp dir` over README.md, docs/configuration.md, docs/hooks.md and docs/architecture/architecture.md, plus `save_to_file|saved` over the changed sources — 6 retention-claim candidates → 1 confirmed. `documentation.ts` correctly scopes cleanup to the system temp directory.
  - code-simplicity-reviewer: `Exit code 0|owner-only|Orphaned files|Error Handling|Returns:|TEMP_DIR.PREFIX` over `src` — 3 candidates → 3 confirmed; no test pins the text proposed for cutting.
- root: source. The trim's keep-list was drawn by section rather than by asking of each sentence whether the model can act on it and whether it is true.
- Found by: data-integrity-guardian and code-simplicity-reviewer, Surface 2 review, 2026-10-29.

## Proposed Solutions

### Option 1: Replace the block with one true, actionable sentence
For example: "Saved files in the server's temp directory are deleted when it stops; files written to output_dir are kept." Cut *Error Handling* to its `jq_filter` bullet; drop one `headers_unsupported` explanation.
- Pros: shorter and true; the model learns what it can act on.
- Effort: s. Risk: low; the pinned phrases are untouched.

### Option 2: Keep the block, scope it correctly
Say which location the cleanup covers, matching `documentation.ts`.
- Pros: smallest edit.
- Cons: keeps per-turn bytes the model cannot use.
- Effort: s.

## Recommended Action

Option 1, chosen by the operator on 2026-10-30 ("Can you fix todo 027 now?").

## Acceptance Criteria

- [x] The description makes no unconditional deletion claim.
- [x] The pins in `register-all-tools.test.ts` and `tool-wrapper.e2e.test.ts` still pass.
- [x] Optional: a test that saves with `output_dir` set, calls `cleanupTempDir()`, and asserts the file still exists.

## Work Log

### 2026-10-29 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** merged data-integrity-guardian's `unretained-pii` (P3) and code-simplicity-reviewer's `dead-code` (P3) on the description symbol.
**Learnings:** the plan's keep-list ("the Temp File Lifecycle") carried text forward whose truth nobody re-checked.

### 2026-10-30 - Resolved on docs/release-5.2.0
**By:** Claude Code
**Actions:** `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`: the *Temp File Lifecycle* block is replaced by one sentence scoping deletion to the server's temp directory and saying `output_dir`/`MCP_CURL_OUTPUT_DIR` files are kept; *Error Handling* is cut to its pinned `jq_filter` bullet; the unused `TEMP_DIR` import is dropped. `src/lib/server/schemas.ts::CurlExecuteSchema`: the macOS fact is folded into the `headers_unsupported` clause, so it is stated once. New test in `src/lib/response/file-saver.test.ts` saves one file to `output_dir` and one to the temp directory, calls `cleanupTempDir()`, and asserts the first survives and the second is gone; it fails with the `rm` in `cleanupTempDir` removed (measured, then restored from a `cp` backup). `dist/` rebuilt.
**Learnings:** —
