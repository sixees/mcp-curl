---
status: pending
severity: low
effort: s
tags: [code-review, convention-drift, typescript, redirects, tools]
dependencies: []
---

# Request method is typed as free-form `string` in the redirect method table

## Problem Statement

A value whose domain is a closed literal union already declared in the codebase is
passed and compared as plain `string`, so a misspelled or wrong-case literal compiles.

## Findings

Class `convention-drift` (typescript-reviewer, Surface-2 review of
`feat/per-hop-redirects`, 2026-10-28). Confidence medium. A smell, not a traced fault.

**Failure:** an edit writing `method === "Post"` in `dropsBody` compiles; 301/302 then
stop turning POST into a body-less GET and the POST body is replayed to the
redirect target. The union type would make that edit a compile error.

**Instances:**
- `src/lib/tools/redirect-hop.ts::effectiveMethod` — returns `string`; every value it produces is in `NonNullable<CurlExecuteInput["method"]>` — confirmed
- `src/lib/tools/redirect-hop.ts::dropsBody` — `method: string`, compared against `"HEAD"` and `"POST"` — confirmed
- `src/lib/execution/curl-args-builder.ts::CurlArgsParams.method?: string` — pre-existing, untouched by the branch — out of scope

**Sweep:** `method: string|method\?: string|\): string \{` over `src/lib` (excluding tests) — 3 candidates → 2 confirmed in the diff.

## Proposed Solutions

### Option 1: Use the schema's union
**Approach:** type both as `NonNullable<CurlExecuteInput["method"]>`. **Pros:** two
signature edits, no new type. **Cons:** none. **Effort:** s. **Risk:** none.

### Option 2: Also narrow `CurlArgsParams.method`
**Pros:** closes the out-of-scope sibling too. **Cons:** touches the builder's type, wider diff. **Effort:** s. **Risk:** low.

## Recommended Action

_Not yet decided — pending a human call._

## Acceptance Criteria

- [ ] `effectiveMethod` and `dropsBody` use the method union; `tsc --noEmit` clean.

## Work Log

### 2026-10-28 - Filed from Surface-2 review
**By:** Claude Code
**Actions:** Filed from typescript-reviewer's finding on `feat/per-hop-redirects` (`831042a..HEAD`), in scope: `redirect-hop.ts` is new on that branch.
**Learnings:** —
