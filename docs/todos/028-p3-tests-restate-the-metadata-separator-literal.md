---
status: pending
severity: low
effort: s
tags: [code-review, convention-drift, test-fixtures, response-parser, metadata-block]
dependencies: []
---

# Test suites restate the full-length metadata separator instead of importing the fixture's

## Problem Statement

`METADATA_SEPARATOR` in `src/lib/tools/curl-output.test-fixture.ts` exists so every suite
uses the real-length separator (the parser's window is sized from it). The new parser
describe copies the literal although the file already imports from the fixture. If
`generateMetadataSeparator`'s length changes, the copies keep the old one and window-margin
cases pass against a separator production no longer emits.

## Findings

- `src/lib/response/parser.test.ts` — "the multi-field block (invariant 13)" describe — new literal — confirmed
- `src/lib/response/parser.test.ts` — "window sizing" describe — pre-existing literal — confirmed
- `src/lib/tools/register-all-tools.test.ts::curlOutput` — its own literal, now passed to `metadataSuffix` — confirmed. **Caveat (RC-35):** this suite's `vi.mock` factory references `SEP`; a factory cannot safely reference an import, so this one may have to keep its literal.

Sweep: `rg -n 'MCP-CURL-0|---MCP-CURL' src` — 6 hits → 4 full-length literals (fixture + 3).

## Proposed Solutions

### Option 1: import outside factories
Import `METADATA_SEPARATOR` in `parser.test.ts`; leave `register-all-tools.test.ts`'s literal with a one-line RC-35 note.
**Effort:** s. **Risk:** low.

### Option 2: assert equality instead
Keep literals, add a test asserting each equals `METADATA_SEPARATOR` and the length of `generateMetadataSeparator()`'s output.
**Effort:** s. **Risk:** low.

## Recommended Action

_Pending the operator's choice._

## Acceptance Criteria

- [ ] No full-length separator literal can drift from the fixture's unnoticed
- [ ] Every touched suite still collects its tests when run alone (RC-35)

## Work Log

### 2026-10-28 - Filed from /sixees-workflow:review of feat/metadata-block-parser
**By:** Claude Code
**Actions:** pattern-recognition-specialist finding; added the RC-35 caveat for the mocked suite.
