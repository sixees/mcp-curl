---
id: 008
title: "The over-cap preview is defended over the whole body, then discarded by the formatter"
status: open
severity: P2
tags: [performance, architecture, pre-existing]
class-id: repeated-computation
aliases: [misplaced-decision]
source: /simplify efficiency + altitude lanes, 2026-09-03
reviewers: [performance-oracle, architecture-strategist]
created: 2026-09-03
---

# The over-cap preview is computed over the whole body, then discarded

## Problem

Two lanes reached the same code from opposite directions, and together they say
something neither said alone.

**Efficiency:** on the over-cap path `processResponse` runs `defendForInline`
over the *entire* body and truncates the result to `max_result_size`. Measured on
a 9.4 MB `text/plain` body: **197 ms total, of which 91 ms is the full-body
defence whose output is discarded except its first 512,000 bytes.** Computing the
same preview from a 500 KB slice first costs 7.4 ms — 12.3× cheaper, 46% of the
whole call. `header-channel.ts::extractHeaderChannel` already does exactly this
and says so: *"Cap the INPUT first… it also stops the defence pipeline running
over more bytes than could ever be returned."*

Separately, for a body inside the growth band `exceedsInlineCap` computes
`defendForInline`, discards it, and `processResponse` immediately recomputes the
identical call on the identical string.

**Altitude:** `formatResponse`'s saved branch **never reads `stdout`**. Under
`include_metadata` it emits `saved_to_file`/`filepath`/`message` and no `response`
key; without it, only the message. `curl-execute.ts::executeCurlRequest` passes `processed.content`
straight into that parameter. So on the path where `displayContent` is built, the
consumer discards it — the 91 ms produces nothing the model ever sees.

## Why this is filed rather than fixed

**Because the two readings prescribe opposite fixes and choosing is a behaviour
decision.** Efficiency says *make the pass cheaper*; altitude says *the pass has
no consumer*. RC-15 deliberately made this preview the defended form — *"the one
place the defended form is RETURNED, because it is the only form that can be
bounded"* — so deleting it and surfacing it are both defensible, and they produce
different bytes for the model.

A third fact bears on it: `processor.ts`'s doc-block justifies the split by
calling `processResponse` *"a published entry point"*. It is not — it appears in
no export of `src/lib.ts`, `src/lib/index.ts`, `src/lib/schema/index.ts` or
`src/index.ts`, and has one caller. That is a stale premise (K-7) and it changes
what a future review is allowed to conclude here.

## Fix

Put the decision in one layer, then optimise what survives:

1. Decide whether the preview is surfaced (a `preview` key under
   `include_metadata`; a server-authored prefix without it, matching the existing
   out-of-band header notices) or dropped. **Additive field = MINOR.**
2. If it survives: bound the input before the pass, as `extractHeaderChannel`
   does — slice to `maxSize`, defend, then keep the existing post-defence re-cut.
   Invariant 14 holds because the re-cut is what enforces the ceiling; invariant
   15 holds because a smaller input cannot make a linear pattern non-linear;
   invariant 1a holds because the same pipeline runs, on fewer bytes.
   **State the one behaviour change out loud:** a slice at or below
   `STRIP_PATH_MAX_BYTES` (256 KB) now takes strip stages the 9.9 MB body skipped,
   so the preview becomes *more* defended, never less.
3. Have `exceedsInlineCap` return the defended string it already built (or hoist
   the call) so the growth-band body is defended once.
4. Correct `processor.ts`'s "published entry point" doc-block.

## Acceptance criteria

- [ ] A decision is recorded for whether the saved branch surfaces a preview.
- [ ] `processResponse` on a 9.9 MB body completes well inside the pre-fix 197 ms,
      asserted in the shape of `strip-blocks.test.ts`'s `REDOS_BUDGET_MS`.
- [ ] A growth-band body triggers exactly one `defendForInline` call.
- [ ] The `processResponse` doc-block no longer claims a published entry point.
