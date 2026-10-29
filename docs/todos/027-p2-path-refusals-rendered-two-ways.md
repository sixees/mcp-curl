---
status: pending
severity: medium
effort: s
tags: [code-review, refusal-shape, url, yaml-tools, duplication]
dependencies: []
pr: ""
---

# Path refusals made before any request are rendered two ways

## Problem Statement

`resolveRequestUrl` now refuses `//`, `\`, control characters and dot-segments through `formatLocalRefusal` (`LOCAL_REFUSED_PATH`). Two other refusals of the same kind are still hand-written strings:
- YAML endpoint tools refuse a `.`/`..` path parameter in `generator.ts::buildUrl` with `DotSegmentError` text;
- `resolveRequestUrl`'s unusable-`baseUrl` branch returns a plain `Error:` string.

So the dot-segment rule has two texts, and only one says "no request was sent".

**Severity:** pattern-recognition-specialist graded this P3. It is escalated to **P2** because `.sixees/LESSONS.md` → RC-46 records `duplicated-logic` as a divergence this codebase has already been burned by.

## Findings

- **Failure:** `curl_execute` with `url: "/users/%2e%2e/admin"` returns `Refused locally: no request was sent (LOCAL_REFUSED_PATH). …`. A YAML tool with path param `id: ".."` returns `Error: a path parameter must not be . or ..; …`, with no code and no "no request was sent" signal.
- **Instances:**
  - `src/lib/utils/url.ts::resolveRequestUrl` — three branches through `refusedPath` (in diff) — confirmed
  - `src/lib/utils/url.ts::resolveRequestUrl` — unusable-`baseUrl` branch, hand-written (in diff) — confirmed. This is arguably a configuration fault, not a refusal, so decide which. `refusedPath`'s doc says "the one shape every local refusal takes".
  - `src/lib/schema/generator.ts::buildUrl` — `DotSegmentError` text — confirmed (outside this diff)
- **Sweep:** `rg -n 'ok: false|DotSegmentError|hasDotSegment|Refused locally|relative url must' src/lib --glob '!*.test.ts'` — 9 candidates → 3 confirmed.
- **Reviewers:** pattern-recognition-specialist (finding). architecture-strategist and code-simplicity-reviewer reached the same sites in their notes.

## Proposed Solutions

### Option 1: Route `buildUrl` through `formatLocalRefusal` with a path-parameter reason
Also decide, and document in `resolveRequestUrl`'s doc-block, whether the bad-`baseUrl` branch stays a configuration error.
**Pros:** one text owner for the dot-segment rule.
**Cons:** adds a reason to the closed set, and YAML tool error text changes.
**Effort:** s · **Risk:** low

### Option 2: Leave `buildUrl`, and narrow `refusedPath`'s "every local refusal" wording
**Pros:** no behaviour change.
**Cons:** two texts for one rule remain.
**Effort:** s · **Risk:** low

## Recommended Action

_(pending — the operator chooses)_

## Acceptance Criteria

- [ ] A generated tool called with path param `..` returns text starting `Refused locally: no request was sent (LOCAL_REFUSED_PATH).`, or the decline is recorded.
- [ ] `resolveRequestUrl`'s doc-block states what the bad-`baseUrl` branch is.

## Work Log

### 2026-10-29 - Filed from Surface 2 review of feat/header-sync-refusal-shape
**By:** Claude Code
**Actions:** Merged with the architecture and simplicity notes. Escalated P3 → P2 on an RC-46 class-id match.
**Learnings:** moving one copy of a rule out of a pair leaves the other copy free to drift.
