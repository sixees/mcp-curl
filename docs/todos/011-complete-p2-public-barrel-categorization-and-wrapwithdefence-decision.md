---
status: complete
priority: p2
issue_id: 011
tags: [code-review, architecture, public-api, future-prs]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Decide on `wrapWithDefence` vs primitive exports + group public barrel by category

## Problem Statement

PR-1 grew the public barrel from 1 sanitization helper to 4 helpers across two categories. PR-6b will add `wrapWithDefence`, a higher-level helper that composes `sanitizeResponse` + `detectInjectionPattern` + `applySpotlighting`. PR-7/PR-8 will likely add more.

Two architectural decisions have to land **before PR-6b** to avoid churn:

1. **Is `wrapWithDefence` the canonical helper that supersedes the three primitives, or do both stay public?** If the former, mark the primitives `@deprecated` when `wrapWithDefence` lands — give callers a soft migration. If both, document when each is appropriate.
2. **How is the barrel structured as it grows past 6+ helpers?** Subpath exports (`mcp-curl/security`) vs flat re-export with section comments. PR-1 has started flat with section comments; tighten the convention so PR-5/PR-6b/PR-7 know exactly where to insert.

## Findings

- **File:** `src/lib.ts:73-86`
- **Reviewer (Architecture, A2):** "Decide now (before PR-6b lands) whether `wrapWithDefence` is the canonical public helper or whether the three primitives stay individually exported."
- **Reviewer (Security, S5):** "no compatibility guarantee on output exact format" — once exported, signatures and output shapes carry semver weight.

## Proposed Solutions

1. **Flat barrel + section comments + canonical `wrapWithDefence`** (recommended). Section ordering: core API → schema utilities → public types → security helpers (sanitization + URL + spotlighting). When `wrapWithDefence` lands, mark primitives `@deprecated` in JSDoc. Effort: S.
2. **Subpath exports** — `import { wrapWithDefence } from "mcp-curl/security"`. Forces categorisation; breaks deep-imports; more package.json plumbing. Effort: M.
3. **Status quo + soft promises in changelog only.** Effort: 0. Risk: future churn.

Recommended: 1. Decision should be recorded in the plan's PR-6b section as an explicit acceptance criterion.

## Acceptance Criteria

- [ ] `src/lib.ts` has section-grouped re-exports with one-line comments per category
- [ ] Decision recorded in the plan's PR-6b section: `wrapWithDefence` is canonical; primitives stay public but `@deprecated`
- [ ] Add a unit test that imports each public-barrel symbol and asserts it's the same reference as the deep import (regression guard)

## Resources

- `src/lib.ts`
- Plan items B3, B6, B9
- Technical Review Corrections A2, A3
