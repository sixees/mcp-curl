---
status: pending
severity: low
effort: s
tags: [code-review, naming, response, processor, types]
dependencies: []
---

# An option keeps the name of a removed responsibility, and its only reader renames it on the way in

## Problem Statement

`ProcessResponseOptions.contentTypeUndetermined` no longer has anything to do with a content
type: since branch `refactor/018-delete-content-type-selection` its only reader maps it to
`boundaryUndetermined` ("the end of the body is unknown"). The name invites a caller to set
it from `parsed.contentType === undefined`, which would make every response with no
`Content-Type` header claim its saved file "may also hold metadata" — false.
`ParsedResponse.metadataFound`'s docblock already warns against exactly this confusion.

## Findings

typescript-reviewer (P3, confidence medium); also noted by architecture-strategist,
code-simplicity-reviewer and pattern-recognition-specialist.

**Instances** (confirmed):
- `src/lib/types/response.ts::ProcessResponseOptions.contentTypeUndetermined` — in diff
- `src/lib/response/processor.ts::processResponse` — `boundaryUndetermined: options.contentTypeUndetermined === true` — in diff
- `src/lib/tools/curl-execute.ts::executeCurlRequest` — `contentTypeUndetermined: !metadataFound` — in diff
- `src/lib/response/parser.ts::ParsedResponse.metadataFound` docblock cross-reference

**Sweep:** `rg -n contentTypeUndetermined src --glob '!*.test.ts'` — 4 candidates → 3 confirmed + 1 cross-reference. Tests set it too.

## Proposed Solutions

1. Rename to `bodyBoundaryUndetermined` (or `metadataNotFound`) at every site, tests included. `ProcessResponseOptions` is on neither published entry point, so no contract breaks. Effort s.
2. Leave the name, sharpen the docblock. Cheaper; keeps the trap.

## Recommended Action

_Unfilled — pending._

## Acceptance Criteria

- [ ] `rg contentTypeUndetermined src` returns nothing; typecheck and suite green.

## Work Log

### 2026-11-26 - Filed by /sixees-workflow:review
**By:** Claude Code
**Actions:** filed from typescript-reviewer's `convention-drift` class; no ledger match.
**Learnings:** —
