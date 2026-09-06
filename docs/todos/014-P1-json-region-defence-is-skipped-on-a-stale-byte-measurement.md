---
id: 014
priority: P1
status: pending
tags: [code-review, security, invariant-16]
created: 2026-09-06
source: /sixees-workflow:review of PR #37 (Surface 2, round 2, data-integrity-guardian)
---

# A JSON document's region-wise defence is skipped on a byte count taken before the sanitiser shrinks it

## Problem

Two gates measure the same document at different points in the pipeline and
disagree, and in the window between them a composite JSON document takes the
defence arm reserved for text that has no regions.

- `processor.ts::parseJsonDocument` gates on `Buffer.byteLength(text) > STRIP_PATH_MAX_BYTES`
  (256 KB), measured **before** any transform.
- `defendText`'s `exceedsStripCap` measures **after** `sanitizeAndDetect` has run,
  and that pass collapses 50+ space-class runs to one space and 20+ newlines to one.

So a JSON body above 256 KB carrying enough collapsible padding returns
`undefined` from `parseJsonDocument` — declining the region-wise leaf walk — and
then passes the strip cap after collapsing, at which point Steps 3–5 run over the
serialised JSON **as one undivided string**. `stripHtmlComments` then pairs an
opener in one field's value with `input.indexOf("-->", i)` in a later one and
deletes everything between, intervening keys included. The result is still valid
JSON, so nothing downstream can tell.

Both halves are remote-chosen: the origin picks the padding that crosses the gate
and the comment tokens that splice.

This is invariant 16 — region-wise defence of composite documents — and the repo
has already measured and closed the **mirror** half of the same mechanism.
`exceedsInlineCap`'s docblock records it as an invariant-14 problem: *"you cannot
skip the expensive arm above `STRIP_PATH_MAX_BYTES` on the reasoning that the
defence cannot grow a body larger than the strip cap. `defendText` sanitises
BEFORE it checks that cap … measured 263,900 bytes in, 407,401 out."* The
invariant-16 half is addressed nowhere.

## Evidence

- `src/lib/response/processor.ts:153` — `if (Buffer.byteLength(text, "utf8") > STRIP_PATH_MAX_BYTES) return undefined;`
- `src/lib/response/processor.ts::defendText` — `content = sanitizeAndDetect(content, hostname)` runs **before** `exceedsStripCap(content)`
- `src/lib/response/strip-blocks.ts:590` — `const close = input.indexOf("-->", i);` — the deletion is unbounded across the document
- `src/lib/utils/sanitize.ts::sanitizeResponse` — the collapse, iterated to a fixed point
- Confirmed instances: `parseJsonDocument`, `defendForInline`, `defendJsonLeaves` (the nested-string arm has the identical fallback), `defendText`

Sweeps: `rg -n "STRIP_PATH_MAX_BYTES" src/` → 5 sites, 4 confirmed. `rg -n "parseJsonDocument" src/` → 4.

## Why this is not PR #37's

`processor.ts:153` is byte-identical at `5adb7d3`; the diff's nearest hunk begins
at old line 158. Escalated to the operator during review of #37 and filed rather
than folded into that branch.

## Proposed solutions

1. **Give `parseJsonDocument` an explicit byte-cap parameter.** Keep
   `STRIP_PATH_MAX_BYTES` for `isDefinitelyJson`, where it is a pure cost gate,
   and use `LIMITS.MAX_RESPONSE_SIZE` for the two region-wise callers. A
   `JSON.parse` on ≤1 MB is already paid for on the `jq_filter` path, so the cost
   argument does not reach these callers. Trade: `defendForInline` now parses
   bodies it currently declines, at the lexeme reviver's measured rate.
2. **Sanitise once at the top of `defendForInline`** and gate both the parse and
   the strip on that single post-sanitise measurement. Smaller, but it moves
   `sanitizeAndDetect`'s logging side effect and needs checking against
   `exceedsInlineCap`'s documented decision to run the pass only in the growth band.
3. **Do not** raise `defendText`'s gate to measure pre-sanitise bytes. That closes
   this window by disabling the strip for every body that collapses — a security
   trade, not a bug fix.

## Acceptance criteria

- [ ] A ~280 KB `application/json` body with ~20 KB of space padding in one string
      value, `<!--` in an early field and `-->` in a late one, returns with **every
      top-level key intact**, driven end to end through `executeCurlRequest`.
- [ ] The nested-string arm in `defendJsonLeaves` is covered by its own case — a
      string leaf that is itself a >256 KB JSON document.
- [ ] Removing the fix makes the end-to-end case fail (teeth probed, not assumed).

## Work log

- 2026-09-06 — filed from `/sixees-workflow:review` of PR #37. Mechanism confirmed
  by data-integrity-guardian in round 2; scope confirmed out-of-diff by the
  orchestrator against `git diff`.

## Resources

- `ARCHITECTURE.md` → invariants 14 and 16
- `LESSONS.md` RC-15 (the cap measured its input where the pipeline grows its output), RC-16 (the defence paired tokens across the boundary it could not see)
