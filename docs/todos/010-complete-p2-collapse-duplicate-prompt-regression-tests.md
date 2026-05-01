---
status: complete
priority: p2
issue_id: 010
tags: [code-review, dry, tests]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Collapse byte-identical prompt regression tests into one parameterised suite

## Problem Statement

`src/lib/prompts/api-discovery.test.ts` and `src/lib/prompts/api-test.test.ts` contain six byte-identical test bodies, differing only by the imported schema. The handoff defends them as "per-consumer regression locking, in case the helper changes," but **every consumer wires through the same `httpOnlyUrl()` helper** — `url.test.ts` already covers the helper's contract. Per-consumer tests only add value if a consumer can *bypass* or *override* the helper, which neither prompt schema can.

## Findings

- **File:** `src/lib/prompts/api-discovery.test.ts:1-37`
- **File:** `src/lib/prompts/api-test.test.ts:1-37`
- **Reviewer (Simplicity, C2):** "genuine copy-paste duplication, not 'intentional regression locking'."

## Proposed Solutions

1. **Collapse to a single `prompts.test.ts`** using `it.each([apiDiscoveryBaseUrlSchema, apiTestUrlSchema])`. Duplication becomes data. Effort: S.
2. **Delete one of the two** — `url.test.ts` plus a single integration smoke test is sufficient. Effort: S.
3. **Keep duplication, add a one-line rationale comment in *both* files** — currently the rationale only lives in the handoff doc and will be lost. Effort: S.

Recommended: solution 1. The parameterised data table also benefits #004 (`vbscript:` rejection added once, applies to both consumers).

## Acceptance Criteria

- [ ] Either a single `prompts.test.ts` with parameterised schema array, or both files retained with explicit rationale comments
- [ ] `vbscript:` rejection is asserted (per finding #004) — either in the parameterised table or in both files
- [ ] All six existing test cases still execute and pass

## Resources

- `src/lib/prompts/api-discovery.test.ts`
- `src/lib/prompts/api-test.test.ts`
- Related: todo #004 (vbscript regression)
