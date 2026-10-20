---
status: pending
severity: high
effort: s
tags: [code-review, data-integrity, response, processor, fail-open-default]
dependencies: []
pr: ""
---

# A JSON body's raw bytes are declared usable by a check that cannot answer the question

## Problem Statement

`processResponse` decides whether the origin's decode can be handed over as-is with `sanitised === response || (classified.json && parsesUntrimmed(response))`. The first disjunct short-circuits the parse, and `classifyBody` calls `String.prototype.trim()`, which removes more whitespace than JSON accepts. A body padded with a Unicode space the sanitiser keeps is classified JSON, saved as the origin's "exact bytes", and advertised as "valid to analyse with jq_query" — and `jq_query`'s untrimmed `JSON.parse` then rejects it.

**Failure:** origin sends `\u00A0{"pad":"…"}` over the inline cap → saved raw, message claims exact bytes and points at jq_query → `jq_query` returns "not valid JSON". Reproduced by the orchestrator: `saved: true, exact-claim: true, parses: false`.

**Severity raised P2 → P1:** class-id `fail-open-default` matches the ledger (`LESSONS.md` RC-10, RC-32, RC-39) — a recurrence.

## Findings

**Instances:**
- `src/lib/response/processor.ts::classifyBody` — `trim()` before `JSON.parse` (source) — confirmed
- `src/lib/response/processor.ts::processResponse` — the `originIsUsable` short-circuit — confirmed
- `src/lib/response/processor.ts::savedMessage` — the claims built on that verdict — confirmed

**Sweep:** enumerate every BMP codepoint `trim()` removes, minus `" \t\n\r"`, minus those `sanitizeResponse` removes → **16 candidates → 16 confirmed**: U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000 (re-run by the orchestrator).

**Fix (class level):** make the JSON decision with the parse the downstream reader runs: `classifyBody` strips only a leading U+FEFF and leaves JSON whitespace to `JSON.parse`, and `originIsUsable` becomes `classified.json ? parsesUntrimmed(response) : sanitised === response`.

## Proposed Solutions

### Option 1: Narrow `classifyBody`'s trim to U+FEFF, and parse untrimmed on the JSON arm
**Pros:** one answer for every reader; an NBSP-padded body gets the honest non-JSON message. **Cons:** one extra parse per JSON body. **Risk:** Low.

### Option 2: Fix `originIsUsable` only
**Pros:** smallest diff. **Cons:** the sanitised copy keeps the NBSP too, so the fallback is equally unparseable; the classifier still disagrees with jq_query. **Risk:** Medium.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] A body with a leading or trailing codepoint from the 16 above is never saved under an "exact bytes / valid to analyse" claim that jq_query cannot honour
- [ ] End-to-end case in `curl-execute.json-passthrough.test.ts` or `curl-execute.size-and-save.test.ts`: saved file parses with untrimmed `JSON.parse`, or the message does not route to jq_query
- [ ] The sweep above is re-run and returns no survivor that reaches a false claim

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers data-integrity-guardian, typescript-reviewer reported the class; the orchestrator re-ran the sweep and reproduced it end to end.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
