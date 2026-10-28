---
status: pending
severity: medium
effort: s
tags: [code-review, fail-open-default, response-processor, response-parser, file-saver, metadata-block]
dependencies: []
---

# A saved response claims to hold the origin's exact bytes when the body boundary was never found

## Problem Statement

When `parseResponseWithMetadata` cannot locate the `-w` block, `bodyBytes` is all of
cURL's stdout, separators and cURL-authored fields included. `processResponse` receives
`contentTypeUndetermined: true` for that case but does not read it when it decides
`originBytesExact`, so the saved-file message says "The file holds the origin's exact
bytes" for a file that holds the metadata tail too.

This branch adds a new trigger: `%{redirect_url}` legitimately carries long remote values,
and with `Location` + `Content-Type` over `LIMITS.MAX_METADATA_TAIL_LENGTH` (16,451 bytes)
the first separator leaves the window. The saved file then also holds the status and the
redirect URL, whose query string may carry tokens.

Reviewer graded P3. Raised to P2 under `/sixees-workflow:review` §4.1: `fail-open-default`
matches RC-31 (and RC-1, RC-64). **Recurred.**

## Findings

- `src/lib/response/processor.ts::processResponse` — `originOnDisk` / `originBytesExact` never read `options.contentTypeUndetermined` — confirmed
- `src/lib/response/parser.ts::parseResponseWithMetadata` — the not-found arm returns `bodyBytes: raw`; its doc says a fidelity path "has to read the flag" — confirmed (source of the ambiguity; documented correctly)

Sweep: `rg '\.bodyBytes|metadataFound|contentTypeUndetermined' src/lib -g '!*.test.ts'` — 1 consumer of `bodyBytes` → 1 confirmed misreading site.

Failure: `follow_redirects: false`, origin sends a ~12 KB `Location` and a ~5 KB
`Content-Type`; separator count is 2, `metadataFound: false`, the body is saved as
`invalid-syntax`, and the message claims exact origin bytes.

## Proposed Solutions

### Option 1: read the flag in `processResponse`

**Approach:** `contentTypeUndetermined: true` makes `originBytesExact` false and the saved
message says the file may hold trailing cURL metadata.
**Pros:** smallest change; claim matches reality. **Cons:** file still holds the tail.
**Effort:** s. **Risk:** low.

### Option 2: also cut at the first separator present

**Approach:** on the not-found arm, if any separator is in the window, cut `bodyBytes` there
and report that the metadata is undetermined.
**Pros:** recovers the body when only the leading separator was evicted.
**Cons:** a second arm with its own reasoning about partial blocks (invariant 13).
**Effort:** m. **Risk:** medium.

## Recommended Action

_Pending the operator's choice._

## Acceptance Criteria

- [ ] An undetermined boundary never produces "the origin's exact bytes"
- [ ] Test in `curl-execute.size-and-save.test.ts`: 12,000-byte `redirectUrl` + 5,000-byte `contentType` via `curlOutputFor`, asserting the message lacks that claim (fails today)
- [ ] Teeth probe recorded

## Work Log

### 2026-10-28 - Filed from /sixees-workflow:review of feat/metadata-block-parser
**By:** Claude Code
**Actions:** data-integrity-guardian finding; escalated one level on the RC-31 class match.
**Learnings:** the parser's own doc-block warned this consumer; the warning was not enforced (RC-31 shape: a claim about a consumer must be enforced at the consumer).
