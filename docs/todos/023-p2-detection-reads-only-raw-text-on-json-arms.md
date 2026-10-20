---
status: pending
severity: medium
effort: s
tags: [code-review, security, detection, response, jq-query, lost-code-path]
dependencies: []
pr: ""
---

# Injection detection on JSON now reads only the raw text, so an invisible-character-split phrase is delivered and never logged

## Problem Statement

Before this branch, `processResponse` returned the sanitised body and the wrap's JSON arm ran `sanitizeAndDetect` over it — so the wrap detected on sanitised text and caught `Ig\u200Bnore previous instructions`. Now every JSON-arm detector (`processResponse` body and post-filter, `defendForInline`, `jq_query`) reads raw text, which the regex misses because the zero-width splits the word. The model receives the split phrase (which it reads straight through) and the operator gets no `[injection-defense]` line — invariant 7's only signal on this path is blind to the cheapest evasion.

**Failure:** JSON `{"q":"Ig\u200Bnore previous instructions"}` via curl_execute → no log at HEAD; `detectInjectionPattern(raw)=false`, `detectInjectionPattern(sanitizeResponse(raw))=true`. Reproduced by the orchestrator.

## Findings

**Instances:**
- `src/lib/response/processor.ts::defendForInline` — JSON arm `detectAndLog(text)` — confirmed
- `src/lib/response/processor.ts::processResponse` — `detectAndLog(response)` and post-filter `detectAndLog(content)` — confirmed
- `src/lib/tools/jq-query.ts::executeJqQuery` — `detectAndLog(filtered)` — confirmed
- Source: `src/lib/security/detection-logger.ts::detectAndLog` tests one representation

**Sweep:** `rg -n "sanitizeAndDetect|detectAndLog|defendText\(|defendForInline\(|sanitizeResponse\(" src --glob '!*.test.ts'` → 10 call sites → 3 confirmed (the JSON detect-only sites; `defendText` callers still sanitise first).

**Fix (class level):** inside the shared helper: `detectAndLog` tests `detectInjectionPattern(text) || detectInjectionPattern(sanitizeResponse(text))` — rewrites nothing, closes the split class for every caller, and keeps detect-on-original for the class a strip would erase.

## Proposed Solutions

### Option 1: Dual-representation detect inside `detectAndLog`
**Pros:** one place; every JSON site inherits it; `sanitizeAndDetect` too. **Cons:** one extra linear sanitise per detection. **Risk:** Low.

### Option 2: Pass the already-computed `sanitised` from `processResponse`
**Pros:** saves a pass there. **Cons:** the wrap and jq_query still need their own. **Risk:** Low.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] End-to-end case on the shipped path (`register-all-tools.test.ts`, curl_execute, JSON body above) asserts the `[injection-defense]` line — fails at HEAD, passes after
- [ ] The PR-6b "does not log invisible-char-split" trade-off test is updated to match
- [ ] Plain-phrase positive control kept

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers security-sentinel reported the class; the orchestrator re-ran the sweep and reproduced it.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
