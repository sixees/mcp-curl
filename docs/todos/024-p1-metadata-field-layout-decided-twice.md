---
status: pending
severity: high
effort: s
tags: [code-review, misplaced-decision, response-parser, curl-args-builder, metadata-block, rate-limit-sync]
dependencies: []
---

# The `-w` block's field layout is decided twice, and the sync-header name grammar is weaker than the plan's

## Problem Statement

Whether the cURL `-w` metadata block carries the optional `%header{…}` sync field is
decided in two places from two unrelated optional inputs:
`CurlArgsParams.syncHeaderName` (writer) and `ParseMetadataOptions.syncHeader` (reader).
Only doc comments tie them. A caller that sets one and not the other compiles, and every
response then parses as `metadataFound: false`: no status, no redirect target, no content
type, strictest grammar on every request, and every 3xx undetermined to the PR-3 hop loop.
It fails closed, but silently and for every request (K-19), and the builder test joins the
two by hand, so it never checks a production caller (K-17).

The same slot also fixes the name grammar ahead of its owner: `HTTP_FIELD_NAME` accepts
`%`, which plan task 13 (PR-4) refuses as cURL's write-out escape.

Severity: reviewers graded P2 (architecture) and P3 (typescript, pattern, simplicity).
Raised to P1 under `/sixees-workflow:review` §4.1 because the merged `class-id`
`misplaced-decision` matches RC-19's recorded `Class` (alias `broken-contract` matches
RC-17/RC-35). The match is on the defect noun; RC-19's subject is bound sizing, not this
layout. Nothing reaches the mismatch today: no production caller sets either input.

**Aliases:** broken-contract (typescript-reviewer), duplicated-logic
(pattern-recognition-specialist), unused-extensibility (code-simplicity-reviewer).

## Findings

Instances:

- `src/lib/execution/curl-args-builder.ts::CurlArgsParams` — `syncHeaderName?` decides 3 or 4 fields — confirmed
- `src/lib/execution/curl-args-builder.ts::buildCurlArgs` — the `HTTP_FIELD_NAME` check and the `%header{…}` push — confirmed
- `src/lib/response/parser.ts::ParseMetadataOptions` — `syncHeader?` separately decides `fieldCount` — confirmed
- `src/lib/response/parser.ts::parseResponseWithMetadata` — `fieldCount = options.syncHeader ? 4 : 3` and the positional reads — confirmed
- `src/lib/config/security/validation.ts::HTTP_FIELD_NAME` — accepts `%`; plan task 13 refuses it — confirmed
- `src/lib/config/limits.ts::LIMITS` — `MAX_SYNC_HEADER_VALUE_LENGTH`, read only by the unreached arm — confirmed
- `src/lib/tools/curl-output.test-fixture.ts::metadataSuffix` — a third spelling of the order (test-only, pinned to the builder) — confirmed
- `src/lib/tools/curl-execute.ts::executeCurlRequest` — the only production composition site; passes neither today — suspected (where the next mismatch lands)

Sweep (re-run by the orchestrator, reproduced):
`rg -n 'syncHeaderName|syncHeader\b|parseResponseWithMetadata\(|buildCurlArgs\(' src -g '!*.test.ts'`
— 2 production call sites in `curl-execute.ts`, 2 decision sites → 2 confirmed, 1 suspected.

Precedent: `src/lib/execution/command-executor.ts::executeCommand` reads `--dump-header`
off `args` rather than taking it alongside them, for exactly this reason.

## Proposed Solutions

### Option 1: one source for the layout

**Approach:** the parser takes the same `syncHeaderName?: string` (or a layout value that
`buildCurlArgs` returns) and derives the field count from it; drop the boolean. Tighten the
name check to refuse `%` (tchar minus `%`) so PR-4's `parseHostRateLimit` reuses it.

**Pros:** the mismatch cannot be written; PR-4 inherits the plan's grammar.
**Cons:** still builds a slot two PRs ahead of its consumer.
**Effort:** s. **Risk:** low.

### Option 2: defer the slot to PR-4

**Approach:** remove `syncHeaderName`, `ParseMetadataOptions`, the 4-field arm,
`HTTP_FIELD_NAME` and `MAX_SYNC_HEADER_VALUE_LENGTH`; the block is a fixed three fields
until PR-4 adds the sync field together with its config and validator.

**Pros:** nothing unexercised ships; less to hold in your head.
**Cons:** departs from plan task 6, which asks for `syncHeaderName?` in PR-2; PR-4 then
changes the parser's field count, re-touching a reviewed boundary.
**Effort:** s. **Risk:** low.

## Recommended Action

_Pending the operator's choice._

## Acceptance Criteria

- [ ] No call site can give the builder and the parser different field counts (compile-time, or derived from one value)
- [ ] A sync header name containing `%` is refused (Option 1), or no name is accepted at all (Option 2)
- [ ] The sweep above returns one decision site
- [ ] Full suite green

## Work Log

### 2026-10-28 - Filed from /sixees-workflow:review of feat/metadata-block-parser
**By:** Claude Code
**Actions:** merged four reviewers' classes on shared confirmed instances; re-ran the sweep; verified plan task 13's `%` rule against `HTTP_FIELD_NAME`.
**Learnings:** the builder round-trip test pins field order, not the call-site pairing.
