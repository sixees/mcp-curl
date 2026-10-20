---
status: pending
severity: high
effort: s
tags: [code-review, data-integrity, response, processor, broken-contract]
dependencies: []
pr: ""
---

# When raw JSON fails to parse, the whole payload is sanitised instead of removing only what blocked the parse

## Problem Statement

For a body whose raw decode parses only after Step 2 (a leading U+FEFF from a .NET or Java origin), `processResponse` returns and persists the fully sanitised text. `sanitizeResponse` also removes U+FE0F (emoji presentation), U+200D (ZWJ) and collapses 50+ space runs inside string values. The inline arm reports nothing; the disk arm says only "attack codepoints removed". A transform justified by one consumer (jq_query must open the file) is applied to a second copy (the inline body) that has no such need, contradicting 019 AC1 ("any normalised value stays internal, for `classifyBody` alone").

**Failure:** `\uFEFF{"s":"❤️","f":"👨‍👩"}` → inline content loses U+FE0F and ZWJ, silently. Reproduced by the orchestrator. The same bytes from a custom tool are returned verbatim by the wrap, so one rule gives two answers by carrier.

**Severity raised P2 → P1:** class-id `broken-contract` (alias `misplaced-decision`) matches the ledger (`LESSONS.md` RC-15, RC-21, RC-25, RC-30, RC-38) — a recurrence.

## Findings

**Instances:**
- `src/lib/response/processor.ts::processResponse` — inline `content = originIsUsable ? response : sanitised` — confirmed
- `src/lib/response/processor.ts::processResponse` — save arm `diskContent … : Buffer.from(sanitised)` — confirmed
- `src/lib/response/processor.ts::defendForInline` — the divergent sibling returning the same bytes verbatim (mirror, not defective) — confirmed

**Sweep:** grep `sanitised|sanitizeResponse|sanitizeAndDetect` in `src/lib/response/` and `src/lib/tools/` (non-test), traced to returned or persisted JSON → 4 candidates → 2 confirmed payload writes.

**Fix (class level):** split the decision by consumer: the inline copy is always the origin's decode (the wrap's classifier and the jq_filter arm both tolerate a BOM); the artefact removes only a leading U+FEFF when that alone makes it parse, and falls back to `sanitised` only after that, with the message narrowed to say so.

## Proposed Solutions

### Option 1: Minimal fallback — strip only a leading U+FEFF, then re-test
**Pros:** payload values survive on both copies; the message can say exactly what changed. **Cons:** another narrow case to reason about. **Risk:** Low (check against the RC-44 fixtures).

### Option 2: Keep whole-body sanitise, but report it inline
**Pros:** smallest change. **Cons:** still rewrites a JSON payload, which RC-49 rules out. **Risk:** Medium.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] A BOM-prefixed JSON body containing U+FE0F, a ZWJ sequence and a 50-space run returns those values intact inline
- [ ] The saved artefact for the same body parses with untrimmed `JSON.parse` and keeps those values
- [ ] `savedMessage` names exactly what was changed on that arm
- [ ] Same bytes via `processResponse` and via the wrap agree once the BOM is removed

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers data-integrity-guardian, architecture-strategist (aliases: `misplaced-decision`) reported the class; the orchestrator re-ran the sweep and reproduced it.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
