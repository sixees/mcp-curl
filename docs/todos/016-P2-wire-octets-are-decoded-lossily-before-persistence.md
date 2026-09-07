---
id: 016
title: "Wire octets are decoded lossily at ingest, and the replacement is what gets persisted and measured"
status: open
severity: P2
tags: [code-review, data-integrity, worsened-by-008]
class-id: missing-validation
source: /sixees-workflow:review of PR #37 (Surface 2, round 4, data-integrity-guardian)
reviewers: [data-integrity-guardian]
created: 2026-09-07
---

# Wire octets are decoded lossily at ingest, and the replacement is what gets persisted

> **PARTLY LANDED 2026-09-07 and deliberately still open** — see the work log. The plumbing and the size gate are done; **the artefact's form moved to `018`**, and the reader half (`jq-query.ts`) is untouched. Do not close this on the write half alone.

## Problem

`parseResponseWithMetadata` decodes the wire body with `raw.toString("utf8")`, so
any byte that is not valid UTF-8 becomes U+FFFD. Every downstream consumer then
treats that converted form as the origin's bytes: `saveResponseToFile` takes a
`string` and writes it, the size gates measure it, `savedMessage` reports its
length, and `jq_query` reads it back. **There is no second copy and no signal
that a substitution occurred.**

The decode itself is unchanged by PR #37 and is byte-identical at the base ref.
**What #37 changed is that the saved file is now the SOLE representation** of an
over-cap body — `ProcessedResponse`'s saved arm carries no `content` — and the
model is *advertised* to it by `savedMessage`. So the same commit that makes
`9223372036854775807` survive into that artefact byte-exact leaves any non-UTF-8
octet in it silently replaced: a fidelity guarantee that holds for numbers and
not for bytes, on the same file.

## Findings

Confirmed instances, all reading what the boundary produced:

- `src/lib/response/parser.ts::parseResponseWithMetadata` — the decode, on both
  the separator-found and separator-absent arms. **This is the root**; every
  other instance is a consumer.
- `src/lib/response/file-saver.ts::saveResponseToFile` — signature takes `string`
  and writes `encoding: "utf-8"`, so the artefact carries the replacement.
- `src/lib/response/processor.ts::processResponse` — gates `MAX_RESPONSE_SIZE`
  and `exceedsInlineCap` on the decoded length, and persists the decoded string.
- `src/lib/response/processor.ts::savedMessage` — reports
  `Buffer.byteLength(content, "utf8")` as the response's size. True of the file,
  and not an answer to *"how big was the response"*.
- `src/lib/tools/jq-query.ts::executeJqQuery` — `readFile(..., "utf-8")` returns
  the replacement as origin content.
- `src/lib/response/header-channel.ts::extractHeaderChannel` — sibling instance
  with a *different* consequence: a byte-slice can cut a multi-byte sequence
  mid-character. Not persisted, and the truncation is announced via
  `headers_truncated`, so it does not carry the silent half.

**Sweep:** `rg 'toString\("utf8"\)|encoding: "utf-8"|Buffer\.byteLength' src/ --glob '!*.test.ts'`
— 20 candidates → 6 confirmed as class members. The remainder are strip-path and
defence-path measurements of strings this boundary already produced.

### Failure scenario

An origin serves a 700 KB `text/html; charset=windows-1252` page, or a JSON body
emitted in ISO-8859-1 (`{"name":"Jos\xe9"}`). The body is over the 500 KB default
cap, so it is written to disk with `\xe9` replaced by `EF BF BD` and the model is
given the path. cURL's stdout buffer is gone and there is no inline copy, so
nothing in the process can reconstruct the octets.

Second arm of the same mechanism: U+FFFD is three bytes where the origin sent
one, so a 4 MB body of mostly-invalid octets measures up to 12 MB and is refused
with *"Response size (N bytes) exceeds maximum allowed"* for an N the origin never
sent.

## Why this was declined in-branch rather than fixed

Recorded per `.claude/rules/03-divergence.md` so the next round cites it rather
than re-litigating it.

The fix that actually closes it moves **three signatures together** —
`ParsedResponse.body`, `processResponse`'s parameter and `saveResponseToFile`'s
first argument. The reviewer's proposed interim, announcing the substitution in
`message`, adds another model-facing sentence — and that surface generated four
findings across three review rounds in this same PR (`LESSONS.md` RC-30). Rule 42's
convergence test says a change that has not settled in two rounds should be cut
rather than patched a third time, and PR #37 is on its fourth.

**Declined on convergence, not on population.** The population is real: any
origin that serves a non-UTF-8 body. This is a scope call and the operator may
reverse it.

## Proposed solutions

1. **Carry the Buffer through to disk (closes it).** `parseResponseWithMetadata`
   returns the octets alongside the decoded string; `ProcessedResponse` carries
   them on the saved arm; `saveResponseToFile` writes the original bytes. Decode
   only for the defence and inline paths. Trade: three signatures move, and the
   defence still operates on the decoded form, so the persisted artefact and the
   defended text diverge — which needs stating in `ARCHITECTURE.md` invariant 14.
2. **Announce rather than fix.** Compare `Buffer.from(body, "utf8")` against the
   source subarray and, where they differ, say so in `savedMessage`. Converts
   silent corruption into announced corruption. Cheap; adds a model-facing
   sentence, which is the surface RC-30 is about.
3. **Refuse a body that does not decode cleanly.** Simplest and worst: it makes
   the proxy unusable for any origin serving legacy encodings, which is a real
   population.

## Acceptance criteria

- [ ] A body containing `0xE9` and the metadata separator, saved via
      `save_to_file`, produces a file **byte-equal to the wire body**. Assert at
      `tools/curl-execute.ts::executeCurlRequest` with `executeCommand` stubbed to
      return a Buffer — a test beside the parser asserts only what the parser was
      already told to do.
- [ ] `MAX_RESPONSE_SIZE` is measured against wire octets, not against the
      inflated decoded length.
- [ ] The byte count in `message` is the count of what is on disk, and says which
      quantity it is.
- [ ] Teeth probed: reverting each half fails a distinct test.

## Already-persisted artefacts

There is nothing to migrate and nothing to roll back. Every artefact already
written by a shipped version is already lossy for any non-UTF-8 origin, and no
forward fix repairs it — **nor can those files be distinguished from clean ones
after the fact**, because U+FFFD is a legitimate character an origin may
genuinely have sent.

## Work log

- 2026-09-07 — filed from PR #37 review round 4. Declined in-branch on
  convergence grounds; see above.
- 2026-09-07 — **partly implemented on `fix/016-carry-wire-octets-through-to-persistence`
  (`LESSONS.md` RC-33, RC-34). Left open on purpose.**

  **Landed:**
  - `ParsedResponse` carries `bodyBytes: Buffer` and **no decoded sibling** — the
    decoded field turned out to have zero production readers once the octets
    arrived, so keeping it meant decoding a body up to 10 MB twice per request
    (RC-28's `repeated-computation` recurring; measured 602 → 478 ms CPU on
    9.5 MB once removed).
  - `processResponse(responseBytes: Buffer, …)` performs the request's single
    decode. `saveResponseToFile(content: Buffer, …)` takes a Buffer with **no
    `string | Buffer` union**, so the one legitimate encode is visible at its
    call site.
  - **AC 2, in a corrected form.** `MAX_RESPONSE_SIZE` is checked against both
    representations rather than swapped onto the wire form. Gating the wire form
    *alone* — which is what this todo's AC 2 literally asked for — removed the
    bound on the decode: an ordinary 9.5 MB gzip inflates 1.81x and went from
    refused to accepted at 10.3x the peak RSS, past the memory ceiling documented
    as covering all concurrent requests. **RC-34 records that; treat AC 2 as
    superseded by it rather than as met as written.**
  - AC 3, and a correction to this todo's premise: the byte count in `message` is
    the length of the buffer actually written. But **this todo was wrong to call
    it a defect** — at base, `saveResponseToFile` wrote `content` as UTF-8 and
    `diskBytes` was `Buffer.byteLength(content, "utf8")`, so the two agreed
    exactly. It became wrong only under the reverted persistence change.
  - AC 4: teeth probed. Each guard reverted in turn; each failed a distinct test.

  **Reverted in review, and now `018`'s:**
  - Persisting the origin's octets — **AC 1 is not met and is no longer this
    todo's to meet.** `savedMessage` tells the model to read a non-JSON artefact
    *"with your own tooling"* and `jq_query` cannot open a non-JSON file, so raw
    octets withdrew Step 2 sanitisation from the one representation the model is
    told to read. The artefact's safety is a property of its reader, and which
    reader a non-JSON body gets is `018`'s decision.

  **Still open here:**
  - Instance 5, `tools/jq-query.ts::executeJqQuery` — `readFile(…, "utf-8")`
    still substitutes U+FFFD at read time. Flagged independently by three
    reviewers this round. It is not a regression (the artefact was already lossy)
    but it is the class's last live silent member, and closing this todo on the
    write half would make it unfindable to anyone re-running the recorded sweep.
  - Instance 6, `header-channel.ts` — re-read unchanged at HEAD; the scope-out
    reasoning above still holds.

## Resources

- `LESSONS.md` RC-8, RC-10 (bytes pinned on the persisted path), RC-30
  (the model-facing-sentence surface), RC-31 (this round).
- `ARCHITECTURE.md` invariant 14.
