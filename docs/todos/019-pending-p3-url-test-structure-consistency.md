---
status: pending
priority: p3
issue_id: 019
tags: [code-review, tests, consistency]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Apply nested-describe convention consistently in `url.test.ts`

## Problem Statement

The new `httpOnlyUrl` block in `src/lib/utils/url.test.ts:81-145` uses three nested `describe`s. Matches `src/lib/security/ssrf.test.ts:4-69` style. But the sibling `resolveBaseUrl` and `safeHostname` blocks in the same file remain flat. Mixed structure inside one file.

## Findings

- **File:** `src/lib/utils/url.test.ts`
- **Reviewer (TypeScript, T4):** "if the convention is 'nested describes for grouped behaviours', consider applying it to the rest of the file in a follow-up."

## Proposed Solutions

1. **Refactor `resolveBaseUrl` and `safeHostname` blocks** with nested `describe`s ("with trailing slash", "with leading slash", "edge cases"). Effort: S.
2. **Flatten the new `httpOnlyUrl` block** to match the existing flat sibling style. Effort: S. Tradeoff: loses the grouping that aids skim-reading.
3. **Status quo + comment noting the mixed style is intentional.** Effort: 0.

Recommended: 1.

## Acceptance Criteria

- [ ] All three function-blocks in `url.test.ts` use the same describe-nesting convention
- [ ] Tests still pass

## Resources

- `src/lib/utils/url.test.ts`
- `src/lib/security/ssrf.test.ts` (reference style)
