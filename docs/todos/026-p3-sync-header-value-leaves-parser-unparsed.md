---
status: pending
severity: low
effort: s
tags: [code-review, untyped-boundary, response-parser, rate-limit-sync, metadata-block]
dependencies: ["024"]
---

# The remote-chosen sync header value leaves the parser as raw text, unlike its sibling fields

## Problem Statement

`ParsedResponse.syncHeaderValue` is returned with only a length check: no digit parse
(as `httpStatus` gets) and no control-byte filter (as `redirectUrl` gets). A test asserts a
multi-line lookalike survives verbatim. The `LIMITS.MAX_SYNC_HEADER_VALUE_LENGTH` doc claims
the 64-byte bound "still refuses prose", which it does not. No consumer exists until PR-4,
so nothing is reachable today. Depends on 024: if the slot is deferred, this goes with it.

## Findings

- `src/lib/response/parser.ts::parseResponseWithMetadata` — `syncValue` returned raw — confirmed
- `src/lib/config/limits.ts::LIMITS` — `MAX_SYNC_HEADER_VALUE_LENGTH` doc overclaims — confirmed

Sweep: `rg 'syncHeaderValue|syncHeader' src` — 1 producer, 0 production consumers → 1 confirmed.

## Proposed Solutions

### Option 1: parse at the boundary
Expose `syncHeaderCount?: number` (trimmed, `/^\d{1,N}$/` → `Number`, else undefined).
**Effort:** s. **Risk:** low. Overlaps PR-4 task 14's strict parse; do it once, here.

### Option 2: filter only, parse in PR-4
Apply the control-byte filter now and correct the `LIMITS` doc; PR-4 parses.
**Effort:** s. **Risk:** low.

## Recommended Action

_Pending the operator's choice._

## Acceptance Criteria

- [ ] A multi-line or non-numeric value never leaves the parser as a usable count
- [ ] The `LIMITS` doc states only what the bound guarantees

## Work Log

### 2026-10-28 - Filed from /sixees-workflow:review of feat/metadata-block-parser
**By:** Claude Code
**Actions:** typescript-reviewer finding, filed as returned.
