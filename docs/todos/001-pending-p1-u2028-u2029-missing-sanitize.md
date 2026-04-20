---
status: pending
priority: p1
issue_id: "001"
tags: [security, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# U+2028/U+2029 Missing From Sanitize Regex Patterns

## Problem Statement

`sanitize.ts` regex patterns `DESC_CONTROL_CHARS` and `RESPONSE_SANITIZE_PATTERN` do not include Unicode Line Separator (U+2028) or Paragraph Separator (U+2029). These are invisible characters that JavaScript regex treats as line terminators — meaning injection phrases split with them (e.g., `"ignore\u2028previous instructions"`) will not be matched by `INJECTION_PATTERNS` (which uses `.` without the `s` flag), and the characters themselves will pass through sanitization intact to the LLM.

This is a security bypass of the prompt injection defense layer.

## Findings

- `DESC_CONTROL_CHARS` (line 14–15, `sanitize.ts`): range `\u202A-\u202E` skips `\u2028-\u2029`
- `RESPONSE_SANITIZE_PATTERN` (line 19–20, `sanitize.ts`): same gap
- U+2028 / U+2029 fall between the `\u200B-\u200F` and `\u202A-\u202E` ranges and are silently omitted
- JavaScript regex `.` does NOT match U+2028 or U+2029 (they are line terminators per ECMAScript spec)
- Consequence: `"ignore\u2028previous instructions"` reaches the LLM unsanitized AND evades detection
- Both characters appear invisible in most renderers; attackers can embed them in API responses without visual indication

## Proposed Solutions

### Option 1: Extend Existing Ranges (Minimal Change)

Add `\u2028\u2029` to both regex character classes, either as a discrete escape pair or by widening the adjacent range.

**Change:**
```
// Before:
[\u200B-\u200F\u202A-\u202E ...]
// After:
[\u200B-\u200F\u2028\u2029\u202A-\u202E ...]
```

Apply identically to both `DESC_CONTROL_CHARS` and `RESPONSE_SANITIZE_PATTERN`.

**Pros:**
- Minimal diff; surgical fix
- Matches existing pattern structure

**Cons:**
- Two separate edit points (both regex constants)

**Effort:** < 30 minutes

**Risk:** Low

---

### Option 2: Widen Range to Cover Full Unicode "Format" Block

Use `\u2000-\u206F` to cover the full General Punctuation block, which includes U+2028/U+2029 plus additional invisible formatting chars (U+2061 Function Application, U+2062 Invisible Times, etc.) that are also attack vectors.

**Pros:**
- Covers related invisible chars in a single range
- Reduces risk of adjacent future omissions

**Cons:**
- Slightly broader than strictly necessary; need to verify no legitimate chars in range
- Must not remove U+2010–U+2027 which includes legitimate punctuation (em-dash U+2014, ellipsis U+2026, etc.)

**Effort:** 1–2 hours (includes range audit)

**Risk:** Low–Medium (need to audit full range)

---

## Recommended Action

Implement Option 1 — discrete escape pair. Audit the full `\u2000-\u206F` range as follow-up if desired, but the immediate fix is the two-line change.

Also add regression tests:
- `sanitizeDescription("Ig\u2028nore")` → `"Ig nore"` (replaced with space)
- `sanitizeResponse("Ig\u2028nore")` → `"Ignore"` (removed)
- `detectInjectionPattern("ignore\u2028previous instructions")` → not null (after sanitizing first)

## Technical Details

**Affected files:**
- `src/lib/utils/sanitize.ts:14-15` — `DESC_CONTROL_CHARS`
- `src/lib/utils/sanitize.ts:19-20` — `RESPONSE_SANITIZE_PATTERN`
- `src/lib/utils/sanitize.test.ts` — add regression tests for U+2028/U+2029

## Acceptance Criteria

- [ ] U+2028 and U+2029 appear in both `DESC_CONTROL_CHARS` and `RESPONSE_SANITIZE_PATTERN`
- [ ] `sanitizeDescription("x\u2028y")` returns `"x y"` (replaced with space)
- [ ] `sanitizeResponse("x\u2028y")` returns `"xy"` (removed)
- [ ] `sanitizeResponse("ignore\u2028previous instructions")` no longer contains U+2028
- [ ] All existing tests continue to pass

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Identified missing chars by inspecting `sanitize.ts` regex character class ranges
- Verified U+2028/U+2029 are ECMAScript line terminators (not matched by `.` without `s` flag)
- Confirmed injection bypass scenario: split phrase evades both detection and sanitization
