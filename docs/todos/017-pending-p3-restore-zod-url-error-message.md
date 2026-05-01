---
status: pending
priority: p3
issue_id: 017
tags: [code-review, ux, error-messages]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Restore root-level `z.url("...")` error message lost in helper consolidation

## Problem Statement

Before PR-1, `CurlExecuteSchema.url` and `ApiInfoSchema.baseUrl` passed a base message to `z.url("Must be a valid URL")`. The factory consolidation no longer does — `z.url()` falls back to Zod's default `"Invalid URL"`. Error messages emitted to MCP clients on a malformed URL changed from "Must be a valid URL" to "Invalid URL". Minor user-visible behaviour change not called out in the PR description.

## Findings

- **File:** `src/lib/utils/url.ts:27`
- **Reviewer (TypeScript, T3):** "either accept and document the new error text, or pass a base message into `z.url()` inside the helper for parity."

## Proposed Solutions

1. **Restore the message** — `z.url("Must be a valid URL")` inside the helper. Effort: trivial. No call-site change.
2. **Accept the new default + document in changelog.** Effort: 0. Risk: subtly worse UX for downstream tools.

Recommended: 1.

## Acceptance Criteria

- [ ] `httpOnlyUrl` returns a schema whose URL-format error matches the old message ("Must be a valid URL" or similar deliberate text)
- [ ] No regression in scheme-rejection error message ("URL must use http or https scheme")

## Resources

- `src/lib/utils/url.ts`
- `src/lib/server/schemas.ts` (pre-PR git history for old message text)
