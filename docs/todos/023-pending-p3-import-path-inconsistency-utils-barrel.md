---
status: pending
priority: p3
issue_id: 023
tags: [code-review, conventions, imports, dry]
dependencies: []
source_pr: 23
review_date: 2026-05-01
review_pass: 2
---

# Use the `utils/index.js` barrel for `httpOnlyUrl` imports (consistency)

## Problem Statement

Every consumer of `httpOnlyUrl` introduced or modified in PR-1 deep-imports from `../utils/url.js`:

- `src/lib/server/schemas.ts:5` → `from "../utils/url.js"`
- `src/lib/prompts/api-test.ts:6` → `from "../utils/url.js"`
- `src/lib/prompts/api-discovery.ts:6` → `from "../utils/url.js"`
- `src/lib/schema/validator.ts:7` → `from "../utils/url.js"`

But every other utility consumer in the codebase (12+ files: `src/lib/tools/curl-execute.ts:10`, `src/lib/extensible/tool-wrapper.ts:17`, `src/lib/extensible/instance-utilities.ts:8`, etc.) goes through the barrel: `from "../utils/index.js"`.

The `api-test.ts` file is the smoking gun: line 6 imports `httpOnlyUrl` from `../utils/url.js`, line 7 imports `sanitizeDescription` from `../utils/index.js`. Two import styles for two utilities in the same file.

`src/lib/utils/index.ts:12,16-22` already re-exports `httpOnlyUrl, resolveBaseUrl, safeHostname` — the barrel is wired, the deep imports are just inconsistent.

## Findings

- **Pattern-recognition reviewer (F3, second pass):** "Pick one and apply consistently — the barrel-import path is the dominant convention."
- **Files affected:** 4 consumer files, single-line edit each.
- **Why this matters:** Barrel imports allow rebinding the symbol to a different file without touching consumers. Deep imports lock the symbol to its current source path, defeating one of the reasons the barrel exists.

## Proposed Solutions

1. **Switch all 4 consumers to the barrel** — change `from "../utils/url.js"` to `from "../utils/index.js"` (or simply `from "../utils"`). Effort: trivial. Risk: none — the barrel re-exports the same symbol.
2. **Status quo + lint rule** — add an `eslint-plugin-import` rule banning deep imports from `utils/`. Effort: S. Tradeoff: project doesn't currently have ESLint configured; this would be a new dep + config surface.

Recommended: 1.

## Acceptance Criteria

- [ ] All 4 consumer files import `httpOnlyUrl` via `../utils/index.js` (or `../utils`)
- [ ] No remaining `from "../utils/url.js"` or `from "../utils/sanitize.js"` outside the barrel itself
- [ ] Tests still pass (no behaviour change)

## Resources

- `src/lib/server/schemas.ts:5`
- `src/lib/prompts/api-test.ts:6` (compare with `:7`)
- `src/lib/prompts/api-discovery.ts:6`
- `src/lib/schema/validator.ts:7`
- `src/lib/utils/index.ts` (barrel)
- Comparison: `src/lib/tools/curl-execute.ts:10`, `src/lib/extensible/tool-wrapper.ts:17` (canonical barrel-import style)
