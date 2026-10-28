---
status: pending
severity: low
effort: s
tags: [code-review, duplicated-logic, response-parser, url-utils, redirects]
dependencies: []
---

# The "no C0 control byte or DEL in a URL handed to cURL" rule exists twice

## Problem Statement

`src/lib/utils/url.ts::RELATIVE_PATH_PATTERN` carries the reason (WHATWG strips tab/CR/LF
that cURL is handed raw, so the SSRF gate and cURL would see different URLs) and its own
`[^\x00-\x1f\x7f]`. This branch adds a second, independent copy as
`src/lib/response/parser.ts::CONTROL_BYTE` for `redirectUrl`, the value PR-3's hop loop
will gate. Widening one set leaves the other behind.

## Findings

- `src/lib/utils/url.ts::RELATIVE_PATH_PATTERN` — pre-existing — confirmed
- `src/lib/response/parser.ts::CONTROL_BYTE` — new — confirmed

Sweep: `rg -n 'x00-\\x1|\\x7[fF]|\\x1[fF]' src --type ts` and `rg 'u0000'` — 5 candidates → 2 confirmed (log-label normalisers strip C0+C1 for a different rule).

## Proposed Solutions

### Option 1: export one character class from `utils/url.ts`
Build both checks from it, beside the reason. Layering: `response/` already imports `utils/`.
**Effort:** s. **Risk:** low.

### Option 2: drop the parser's check
Let PR-3's hop loop run every redirect target through the same URL validation as a request URL.
**Effort:** s. **Risk:** low, but leaves the parser's "unusable" arm to PR-3.

## Recommended Action

_Pending the operator's choice._

## Acceptance Criteria

- [ ] One definition of the control-byte set for URLs
- [ ] A shared table test runs it against both the relative-path schema and `redirectUrl`

## Work Log

### 2026-10-28 - Filed from /sixees-workflow:review of feat/metadata-block-parser
**By:** Claude Code
**Actions:** pattern-recognition-specialist finding, filed as returned.
