---
status: complete
priority: p3
issue_id: "007"
tags: [code-review, prompt-injection]
dependencies: ["005"]
pr: "#20"
---

# Spotlighting Wraps File-Save Acknowledgment Messages

## Problem Statement

When a response is large and saved to disk, `processResponse` returns a message like `"Response (1234567 bytes) saved to: /tmp/mcp-curl-abc123/response.json"`. Spotlighting in `tool-wrapper.ts` wraps this acknowledgment message in sentinel tags — not the actual response data (which is on disk).

The spotlighting technique is designed to delimit untrusted external data from system context. Wrapping a file-path acknowledgment message in sentinels is semantically misleading: it implies the filepath string is external untrusted data, when it is an internal system message.

## Findings

- `src/lib/response/processor.ts:138` — returns file-save message: `"Response (...bytes) saved to: ${filepath}"`
- `src/lib/extensible/tool-wrapper.ts:111-116` — applies spotlight to `result.content[0].text` without distinguishing inline data from system messages
- `result.savedToFile` flag is available in `ProcessedResponse` but not propagated to the tool's returned `CallToolResult` — the wrapper has no way to distinguish the two cases

## Proposed Solutions

### Option 1: Skip Spotlighting When Result Was Saved to File

Propagate a flag through the result so `tool-wrapper.ts` can skip spotlighting for file-save acknowledgments:

```typescript
// In CallToolResult, add optional metadata field
type CallToolResult = { ...; _savedToFile?: boolean };
// In tool-wrapper maybeApplySpotlighting:
if (result._savedToFile) return result; // file-path message not external data
```

**Pros:**
- Semantically correct — only external data is spotlighted

**Cons:**
- Adds a non-standard field to the MCP result type
- Minor coupling between processing and presentation

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Accept Current Behaviour as Benign

The file-path string is short and contains no external data. Spotlighting it is slightly misleading but causes no security or functional harm. The sentinel tags wrap an internal message, and the LLM will understand the file path reference.

**Pros:**
- No code change required

**Cons:**
- Confusing semantics for developers reasoning about spotlighting

**Effort:** 0

**Risk:** None

---

## Recommended Action

Option 2 for now — the mis-wrapping is a cosmetic/semantic issue, not a functional one. Revisit if spotlighting semantics matter to downstream tooling.

## Technical Details

**Affected files:**
- `src/lib/extensible/tool-wrapper.ts:111-116` — spotlighting logic (consider adding file-save check)

## Acceptance Criteria

- [ ] Decision documented — either spotlighting correctly skips file-save messages, or the known semantic gap is documented in a code comment

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Traced spotlighting application path for large responses
- Identified that file-save acknowledgment text gets spotlighted instead of actual content
