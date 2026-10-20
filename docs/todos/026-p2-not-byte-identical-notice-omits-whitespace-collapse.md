---
status: pending
severity: medium
effort: s
tags: [code-review, data-integrity, response, saved-message, unchecked-assertion]
dependencies: []
pr: ""
---

# The "not byte-identical" notice names only codepoint removal, but the sanitiser also collapses whitespace and newline runs

## Problem Statement

`savedMessage`'s exactness false arm says "The file holds the body with attack codepoints removed". `sanitizeResponse` also collapses runs of 20+ newlines and 50+ padding spaces, so a reader diffing a saved log, CSV or fixed-width report against the origin is told the wrong thing about what changed.

**Severity raised P3 → P2:** class-id `unchecked-assertion` matches the ledger (`LESSONS.md` RC-32, RC-54, RC-30) — a recurrence.

## Findings

**Instances:**
- `src/lib/response/processor.ts::savedMessage` — the `exactness` false arm — confirmed

**Sweep:** grep `attack codepoints removed|not byte-identical` across `src` → 1 producer, asserted only for presence → 1 confirmed.

**Fix (class level):** name every transform the sanitiser applies, and narrow the sentence further on a BOM-only arm if todo 022 (the BOM fallback) is fixed first.

## Proposed Solutions

### Option 1: Complete the sentence
**Pros:** one-line change. **Cons:** none. **Risk:** Low.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] A non-JSON body with 25 consecutive newlines, saved, produces a message naming the collapse

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers data-integrity-guardian reported the class; the orchestrator re-ran the sweep.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
