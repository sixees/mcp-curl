---
status: pending
severity: low
effort: s
tags: [code-review, dead-code, redirects, tools]
dependencies: []
---

# Unreachable "origin did not parse" arm in the redirect loop

## Problem Statement

A guard on a state an earlier gate in the same function has already ruled out:
it is unreachable, and it is folded into a refusal reason that describes a
different cause (the redirect *target*), so a reader maintaining refusal reasons
has to work out that one of the condition's two causes cannot happen.

## Findings

Class `dead-code` (code-simplicity-reviewer, Surface-2 review of
`feat/per-hop-redirects`, 2026-10-28). Confidence medium. Legibility only — P3.

**Why unreachable:** `origin = safeUrl(params.url)` is `undefined` only when
`params.url` does not parse; then hop 1's `gateHop` → `validateUrlAndResolveDns`
throws `Invalid URL format` before the loop can reach a redirect.

**Instances:**
- `src/lib/tools/curl-execute.ts::executeCurlRequest` — `if (next === undefined || origin === undefined)` refusing `unusable-redirect-target`, with `origin` taken from `safeUrl(params.url)` before the loop — confirmed

**Sweep:** `=== undefined`, `?? ` and `safeUrl(` across `curl-execute.ts` and `redirect-hop.ts` — 6 candidates → 1 confirmed.

## Proposed Solutions

### Option 1: Take the origin from what hop 1's gate proved
**Approach:** set the hop-1 origin from `hop.url` once `gateHop` returns on
`requestsSent === 0` (or have the gate return the parsed URL), so its type carries
no `undefined`. **Pros:** the refusal condition states its only real cause.
**Cons:** none of note. **Effort:** s. **Risk:** low.

### Option 2: Leave it, with a comment
**Pros:** zero change. **Cons:** the type still claims a state the program cannot produce. **Effort:** s. **Risk:** none.

## Recommended Action

_Not yet decided — pending a human call._

## Acceptance Criteria

- [ ] The unusable-target refusal condition names only the target.
- [ ] `curl-execute.redirects.test.ts` (unusable targets) and the unparseable-URL cases stay green.

## Work Log

### 2026-10-28 - Filed from Surface-2 review
**By:** Claude Code
**Actions:** Filed from code-simplicity-reviewer's finding on `feat/per-hop-redirects` (`831042a..HEAD`), in scope: the loop is new on that branch.
**Learnings:** —
