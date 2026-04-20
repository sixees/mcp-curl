---
status: complete
priority: p2
issue_id: "004"
tags: [security, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# Log Injection via Unvalidated params.filepath in jq-query.ts Error Catch

## Problem Statement

The catch block in `jq-query.ts` (line 150) logs `basename(params.filepath)` before path validation has completed. If `params.filepath` contains newline characters or other control chars, it could inject fake log lines into stderr — potentially misleading operators reading logs.

```typescript
// Line 150 — params.filepath is UNVALIDATED at this point
console.error(`jq_query error: [${basename(params.filepath)}] ${errorClass}`);
```

The `basename()` call strips directory separators but does NOT strip `\n`, `\r`, or other control characters from the filename component. An input like `/tmp/foo\n[injection-defense] [evil.com] InjectionDetected` would produce a fake security event in the log.

## Findings

- `src/lib/tools/jq-query.ts:150` — `params.filepath` used in error log before sanitization
- `path.basename()` removes `/` and `\` path separators but preserves all other characters
- The catch wraps the entire function body — validation (which would reject bad paths) is INSIDE the try block
- Pattern inconsistency: `processor.ts` (line 79-84) safely extracts hostname via `new URL()` which normalises input; no equivalent normalization here

## Proposed Solutions

### Option 1: Sanitize basename Before Logging

Apply a minimal sanitization to the basename string before interpolating it into the log message:

```typescript
const safeBase = basename(params.filepath).replace(/[\n\r\u0000-\u001F\u007F]/g, "?");
console.error(`jq_query error: [${safeBase}] ${errorClass}`);
```

**Pros:**
- Surgical — no logic changes
- Removes log injection vectors while preserving readability

**Cons:**
- Inline regex (not reusing `sanitizeDescription`)

**Effort:** 15 minutes

**Risk:** Very Low

---

### Option 2: Use sanitizeDescription on the basename

Reuse the existing `sanitizeDescription` utility (already imported in the file):

```typescript
const safeBase = sanitizeDescription(basename(params.filepath));
console.error(`jq_query error: [${safeBase}] ${errorClass}`);
```

**Pros:**
- Reuses existing utility (DRY)
- Applies the same character stripping as all other log points

**Cons:**
- `sanitizeDescription` also trims and replaces sequences; basename output could become empty string if all chars are control chars (benign edge case)

**Effort:** 15 minutes

**Risk:** Very Low

---

## Recommended Action

Option 2 — reuse `sanitizeDescription`. It's already in scope and handles the same character classes.

## Technical Details

**Affected files:**
- `src/lib/tools/jq-query.ts:150` — wrap `basename(params.filepath)` with `sanitizeDescription()`

**Note:** `sanitizeDescription` is not yet imported in jq-query.ts — it would need to be added to the import from `../utils/index.js`.

## Acceptance Criteria

- [ ] `params.filepath` is sanitized before use in any `console.error` call in `jq-query.ts`
- [ ] A filepath with embedded `\n` does not produce multiple log lines in stderr output

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Traced the try/catch structure in jq-query.ts
- Confirmed params.filepath is unvalidated at line 150
- Verified basename() does not strip control chars
