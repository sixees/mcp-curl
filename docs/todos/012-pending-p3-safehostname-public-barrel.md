---
status: pending
priority: p3
issue_id: 012
tags: [code-review, architecture, public-api, symmetry]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Add `safeHostname` to the public barrel for parity

## Problem Statement

`src/lib/utils/url.ts` exports three helpers: `resolveBaseUrl`, `httpOnlyUrl`, `safeHostname`. `src/lib/utils/index.ts:12` re-exports all three. `src/lib.ts` re-exports only `httpOnlyUrl`. `safeHostname` is used internally by public-facing code paths (`src/lib/tools/curl-execute.ts:217`, `src/lib/response/processor.ts:49`) and is the malformed-URL-tolerant hostname extractor.

PR-6b's `wrapWithDefence(result, hostname, config)` factory will need callers to compute hostnames per call. They can:

- Parse `new URL(...).hostname` themselves (and miss the malformed-URL fallback that `safeHostname` provides), or
- Deep-import from `mcp-curl/dist/lib/utils/url.js` (the API-stability hazard PR-1 just fixed for the other helpers), or
- Reimplement (drift hazard).

Same pattern PR-1 just fixed for `httpOnlyUrl`/spotlighting. `safeHostname` retains the asymmetry.

## Findings

- **File:** `src/lib.ts` — missing `safeHostname` export
- **File:** `src/lib/utils/index.ts:12` — already re-exports it from utils barrel
- **Reviewer (Architecture, A5):** "PR-6b will benefit; the cost today is zero."

## Proposed Solutions

1. **Add `safeHostname` to `src/lib.ts`** alongside `httpOnlyUrl`. One extra line; pure addition; no breaking change. Effort: trivial.

## Acceptance Criteria

- [ ] `safeHostname` re-exported from `src/lib.ts`
- [ ] `dist/lib.d.ts` includes `safeHostname` after build
- [ ] (No new doc needed — its JSDoc already exists in `url.ts`)

## Resources

- `src/lib.ts:84-86` (URL exports section)
- `src/lib/utils/url.ts:47-54`
