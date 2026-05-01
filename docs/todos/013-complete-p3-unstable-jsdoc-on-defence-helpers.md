---
status: complete
priority: p3
issue_id: 013
tags: [code-review, public-api, semver, documentation]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Mark response-side defence helpers `@unstable` / document output-format coupling

## Problem Statement

The current sentinel format is `---EXTERNAL-CONTENT-BEGIN-{uuid}---\n{content}\n---EXTERNAL-CONTENT-END-{uuid}---`. Once exported on `src/lib.ts`, downstream tools that prompt-template against the sentinel boundary lock in this exact string. A future hardening change wanting to switch to random-byte sentinels or JSON envelopes would be a breaking API change.

`sanitizeResponse` similarly exposes implementation details — collapses 50+ spaces, strips a specific Unicode character class. Custom tools doing `sanitizeResponse(x) === x` to detect "clean" input will break the day either threshold changes.

## Findings

- **File:** `src/lib.ts:81`
- **File:** `src/lib/utils/sanitize.ts`
- **Reviewer (Security, S5):** "anything exported here implicitly carries semver weight."

## Proposed Solutions

1. **JSDoc note on each export** flagging the security invariant (no Unicode invisibles, no 50+ space runs, no naturally-occurring sentinels) as the stable contract — *not* the exact output format. Effort: S.
2. **Move to a `mcp-curl/internal` subpath export** until shape stabilises. Effort: M. Tradeoff: docs already point at the main barrel.
3. **Status quo + changelog notes.** Effort: 0.

Recommended: 1. Cheap, sets reader expectations.

## Acceptance Criteria

- [ ] `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern` JSDoc notes "no compatibility guarantee on output exact format — only the security invariant is stable across versions"
- [ ] Decision recorded on whether to revisit at 4.0 / pre-1.0 demarcation

## Resources

- `src/lib/utils/sanitize.ts`
- `package.json` (currently 3.0.2)
