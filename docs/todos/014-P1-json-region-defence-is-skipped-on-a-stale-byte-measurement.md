---
id: 014
title: "A JSON document's region-wise defence is skipped on a pre-sanitise byte measurement"
status: open
severity: P1
tags: [code-review, security, invariant-16]
class-id: fail-open-default
source: /sixees-workflow:review of PR #37 (Surface 2, round 2, data-integrity-guardian)
reviewers: [data-integrity-guardian, security-sentinel]
created: 2026-09-06
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

## Scope — corrected 2026-09-07

**This section previously concluded the class was not PR #37's.** Both of its
factual statements remain true — `processor.ts`'s gate is byte-identical at
`5adb7d3`, and the diff's nearest hunk began after it — and **the conclusion
became false**, because PR #37 round 4 added a reachability path to the same
mechanism through an in-diff line (`strictestGrammar`'s new
`|| options.contentType === undefined` arm). A JSON body with no declared type
crossed the gate and had an attacker-chosen span of keys deleted. Recorded as a
divergence per `.claude/rules/03-divergence.md` rather than silently edited;
`LESSONS.md` RC-32 holds it.

**Round 5 then closed that route** by computing the JSON exemption on the
post-sanitise bytes, so `parseJsonDocument`'s gate and `exceedsStripCap` now
measure the same string and cannot disagree. **What remains open here** is
whether any other caller of `parseJsonDocument` still decides a *defence* on a
pre-transform byte count — `defendForInline` and `defendJsonLeaves`'s nested-leaf
arm are the two to check — which is what this todo is now for.


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

- [ ] **Corrected 2026-09-07 — the original criterion could not fail.** It
      specified an `application/json` declaration, and `isSniffableContentType`
      returns `false` for that type while neither `supportsMarkupComments` nor
      `isMarkdownContentType` matches it — so a declared `application/json` body
      can never reach the strip path at any size. Measured against unfixed code:
      all six top-level keys intact, criterion green. It also sized the body at
      ~280 KB with ~20 KB of padding, which stays above `exceedsStripCap` after
      the collapse, so no stage would have run even had it reached the path.
      **Derive the input from the gate it must cross, not from the defect's
      prose.** The criterion is now:
- [ ] A JSON body served with **no `Content-Type` header at all**, above
      `STRIP_PATH_MAX_BYTES` (262,144) before sanitisation and below it after —
      ~327 KB with ~60 KB of collapsible ≥50-character space runs measures
      correctly — with `<!--` in an early field and `-->` in a late one, returns
      with **every top-level key intact**, driven end to end through
      `executeCurlRequest`, and asserted on the persisted file as well as the
      inline return.
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
