---
status: pending
severity: low
effort: s
tags: [code-review, documentation, response, parser, tests, public-types]
dependencies: []
---

# Prose still describes the deleted content-type grammar selection, MEDIA_TYPE_HEAD, isDefinitelyJson and decodeEntities as live

## Problem Statement

Branch `refactor/018-delete-content-type-selection` deleted the grammar selector,
`MEDIA_TYPE_HEAD`, `isDefinitelyJson`, `isCompositeValue`'s last mention and the
`decodeEntities` option, and updated the comments in the files it rewrote — but not these.
They compile, pass and are believed (`01-known-shapes.md` → K-7). The worst: a reader of
`register-all-tools.test.ts` is told the parser trims the Content-Type to `text/plain`, so
adding an echo would look safe; and the published `McpCurlConfig` `.d.ts` tells library
consumers the wrap uses a "strictest grammar" that no longer exists.

## Findings

Found independently by code-simplicity-reviewer, typescript-reviewer and
pattern-recognition-specialist (merged on shared confirmed instances).

**Instances** (all confirmed; "in diff" = file modified on the branch):
- `src/lib/config/limits.ts::LIMITS.MAX_CONTENT_TYPE_FIELD_LENGTH` — "selects the strictest grammar downstream" — in diff
- `src/lib/response/parser.ts` — module header "Parse cURL output and check content types" — in diff
- `src/lib/response/parser.test.ts::"on the not-found arm, bodyBytes is the whole buffer and not the origin's body"` — "selects the strictest grammar and the whole thing is stripped" — in diff
- `src/lib/response/parser.test.ts::"leaves an over-bound field absent, never partial, and the others intact"` — "Both select the strictest grammar" — in diff
- `src/lib/tools/curl-execute.headers.test.ts::"does not strip a JSON body when the content type is undetermined"` — "The strictest-grammar posture…" — in diff
- `src/lib/tools/curl-execute.json-passthrough.test.ts::"018 AC6 — the artefact gate is the body gate, with no strip cap"` — argues from the deleted `isDefinitelyJson` — in diff
- `src/lib/utils/json-lexeme.ts::rawJson` — cites the deleted `processor.ts::isCompositeValue` — in diff
- `src/lib/response/strip-blocks.test.ts` — `REDOS_BUDGET_MS` docblock and the ReDoS table comment claim `stripScriptStyleBlocks` returns input untouched above `STRIP_PATH_MAX_BYTES`; the cap now lives only in `defendText` (performance-oracle note) — in diff
- `src/lib/types/public.ts::McpCurlConfig` (`enableSpotlighting`) — "under the strictest grammar" — outside the diff, made false by it; ships in the `.d.ts`
- `src/lib/tools/register-all-tools.test.ts::"does not echo a Content-Type header carrying prose"` and the case before it — cite `MEDIA_TYPE_HEAD` — outside the diff
- `src/lib/response/post-processor.test.ts::"does NOT decode numeric HTML entities (RC-3)"` — cites the deleted `decodeEntities: false` — outside the diff
- `src/lib/tools/curl-output.test-fixture.ts::metadataSuffix` — "against the strictest grammar" — outside the diff
- `src/lib.ts` section 7 comment — "the wrap applies the full pipeline" holds for non-JSON parts only (architecture-strategist note) — in diff

**Sweep:** `rg -n -i 'strictest|grammar|MEDIA_TYPE_HEAD|isDefinitelyJson|isCompositeValue|decodeEntities|check content types' src` — reviewers reported 30 candidates → 9–10 confirmed in comments (the rest are JSON/jq "grammar" uses that are still true, or accurate `defendText` references). Not counted here: `.sixees/sixees-workflow.local.md` and `docs/compound/compound-engineering-profile.md` still name "4-iteration fixed-point loops in the strip/sanitise path" (gitignored/per-clone; only the sanitise loop remains).

## Proposed Solutions

1. **One sweep rewriting each sentence to the present mechanism**, deleting it where nothing is left to say, then rebuild `dist/` so the `.d.ts` follows. Effort s.
2. `/sixees-workflow:sync-comments --branch` over the branch — broader, audits every comment the branch touched.

## Recommended Action

_Unfilled — pending._

## Acceptance Criteria

- [ ] The sweep above returns only still-true uses.
- [ ] `dist/` rebuilt so the published `McpCurlConfig` docblock matches.

## Work Log

### 2026-11-26 - Filed by /sixees-workflow:review
**By:** Claude Code
**Actions:** three reviewers' `stale-comment` classes merged on overlapping instances; no ledger match.
**Learnings:** a deletion's vocabulary needs its own sweep, separate from its symbols (K-20).
