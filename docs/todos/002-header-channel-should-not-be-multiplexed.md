---
id: 002
title: "Stop multiplexing headers and body onto one stream — use -D instead of -i"
status: open
severity: P1
tags: [code-review, security, class-fix, escalation-rung-3]
class-id: broken-contract
aliases: [untyped-boundary, injectable-input, fail-open-default]
source: /sixees-workflow:review rounds 1-3, PR #32
reviewers: [security-sentinel, typescript-reviewer, data-integrity-guardian, performance-oracle]
created: 2026-09-01
---

# Stop multiplexing headers and body onto one stream

## The case for this is that the layer has failed three times

`curl -i` writes the header block and the body to one stream, and everything
since has been an attempt to recover the boundary arithmetically. Each attempt
was correct about the defect it fixed and wrong in a new way:

| Round | Mechanism | How it failed |
|---|---|---|
| 1 | Scan for status lines, consume blocks | A body may legitimately *be* an HTTP transcript. Forgery into the header channel, body silently truncated, and quadratic — 2MB of crafted stdout blocked the event loop 2.9s (RC-1) |
| 2 | Index at cURL's `%{size_header}` | The count is in wire bytes; stdout had been decoded lossily, so U+FFFD inflated 1 byte to 3 and the split landed early (RC-2) |
| 3 | Index the octets at `%{size_header}` | `%{size_header}` does not count **chunked trailers**, which `-i` writes to stdout *after* the body — so trailer text lands inside `response` |

`skill: pr-resolver-safety` → *the escalation ladder* names this exactly: rung 3,
*"recognise that no fix exists at that layer, and move the precondition."*
Naming it is the finding. A fourth arithmetic patch is the wrong shape of answer.

## Verified, not assumed

Against real cURL 8.7.1 on a loopback server:

```
# chunked response with a trailer section
size_header=95   total stdout=133   trailer text present in stdout: True
-> bytes [95,133) = body + trailer, so the trailer is returned as body
```

Also verified, and worth keeping because it removes a plausible-sounding worry:
**cURL suppresses intermediate 3xx bodies under `-i -L`.** A 302 carrying a
65-byte body produced stdout in which that body is absent, and the header region
ended exactly at `\r\n\r\n`. So header blocks *are* contiguous, and the
redirect-interleaving failure mode does **not** exist. That was raised in round 3
and refuted.

## The fix

Replace `-i` with `--dump-header <tempfile>` in
`execution/curl-args-builder.ts::buildCurlArgs`, read that file in
`tools/curl-execute.ts::executeCurlRequest`, and let stdout carry the body alone.

This makes the split **structural rather than inferred**, and it retires in one
move: the byte-offset arithmetic, `%{size_header}`, the lossy-decode hazard, the
trailer ambiguity, and the terminator precondition added as a stopgap in round 3.

## What it costs, stated honestly

One temp file per `include_headers` request, plus a cleanup path that must hold on
the error and timeout branches. `files/temp-manager.ts` already owns a managed
directory with the right permissions, so the infrastructure exists — but the
lifecycle is the part to get right, and it is why this was **not** done in round 3:
there was no further review round to catch a mistake in it.

## Instances

- `src/lib/execution/curl-args-builder.ts::buildCurlArgs` — pushes `-i`, the multiplexing decision — confirmed
- `src/lib/response/parser.ts::splitResponseHeaders` — the arithmetic that has failed three times — confirmed
- `src/lib/response/parser.ts::parseResponseWithMetadata` — carries `%{size_header}`, which exists only to serve the arithmetic — confirmed

## Sweep

```bash
rg -n '"-i"|size_header|splitResponseHeaders' src --type ts -g '!*.test.ts'
```

At time of filing: 6 non-test hits → 3 confirmed instances.

## Acceptance criteria

- [ ] `-i` no longer appears in `buildCurlArgs`; stdout carries the body alone.
- [ ] The chunked-trailer case returns the trailer nowhere in `response`.
- [ ] The temp file is removed on success, on error, and on timeout — asserted.
- [ ] `%{size_header}`, `headerBytes`, and the terminator precondition are gone.
- [ ] `ARCHITECTURE.md` invariant 13 is restated: the boundary is structural, not
      derived. RC-1/RC-2 keep their bodies; add `**Mechanism superseded:**` lines.

## Work log

- 2026-09-01 — filed from review round 3. Trailer behaviour and redirect-body
  suppression both verified against real cURL rather than assumed.
