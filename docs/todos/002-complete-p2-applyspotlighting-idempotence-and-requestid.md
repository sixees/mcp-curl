---
status: complete
priority: p2
issue_id: 002
tags: [code-review, security, public-api, prompt-injection]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Harden `applySpotlighting` — idempotence guard + `requestId` shape validation

## Problem Statement

`applySpotlighting(content, requestId)` is now part of the public barrel (`src/lib.ts`). Two footguns exist:

1. **No idempotence guard.** A custom-tool author who calls `applySpotlighting(content, uuid)` will then have their result wrapped *again* by the tool-wrapper (when `enableSpotlighting` is on), producing nested `BEGIN…\nBEGIN…\ncontent\nEND…\nEND…` with two different UUIDs.
2. **`requestId` accepts any non-empty string.** The threat model relies on the requestId being unguessable per request. The function correctly throws on empty input but silently accepts `"req"`, `"session-1"`, `Date.now().toString()`, or a module-level `const SENTINEL = randomUUID()` reused across all calls — all of which produce a degraded sentinel.

## Findings

- **File:** `src/lib/utils/sanitize.ts:143-154`
- **File:** `src/lib/extensible/tool-wrapper.ts:53` (re-wraps blindly without detecting inner sentinel)
- **Reviewer (Security, S4):** "Drop the parameter from the public surface. Export a `spotlightExternalContent(content)` that calls `randomUUID()` internally. Custom tools never get to choose the wrong key."
- **Reviewer (TypeScript, T6):** "An idempotence guard… the wrapper detects the `---EXTERNAL-CONTENT-BEGIN-` prefix at the start of `first.text` and skips re-wrap."

## Proposed Solutions

1. **Idempotence guard in tool-wrapper.** Detect leading `---EXTERNAL-CONTENT-BEGIN-` and skip re-wrap. Cheap; preserves caller flexibility. Doesn't fix requestId quality.
2. **Validate `requestId` shape** — require `/^[0-9a-f-]{32,36}$/i` (UUID-ish). Fails loudly at build-time mistakes. Doesn't prevent reuse-of-the-same-UUID across calls.
3. **Replace public `applySpotlighting` with `spotlightExternalContent(content)`** — internal `randomUUID()` per call. Simplest API; safest. Breaking change for any current external user but PR-1 just shipped — no users yet.

Recommended: combine 1 + 3. Internal callers keep the keyed form; public surface is the safe `spotlightExternalContent`. Doc clearly states "do not call manually if the framework is wrapping for you."

## Acceptance Criteria

- [ ] Tool-wrapper detects existing sentinel prefix and short-circuits re-wrap (test added)
- [ ] Public surface no longer requires callers to mint a UUID (either renamed export or internal helper)
- [ ] `docs/custom-tools.md` adds an explicit "do not double-wrap" warning
- [ ] Test: calling the public spotlight helper twice produces one wrapper, not nested

## Resources

- `src/lib/utils/sanitize.ts:143-154`
- `src/lib/extensible/tool-wrapper.ts`
- Plan B3 / Technical Review Corrections A2 (idempotence symbol)
