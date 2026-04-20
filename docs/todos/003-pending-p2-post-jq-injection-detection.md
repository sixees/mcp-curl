---
status: pending
priority: p2
issue_id: "003"
tags: [security, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# Missing Post-JQ Injection Detection in processor.ts

## Problem Statement

`processResponse` in `processor.ts` calls `detectInjectionPattern` BEFORE the jq filter is applied (line 76), but NOT after (line 119). This is a coverage gap: jq filters can extract and concentrate injection phrases from sparse data, making phrases that were non-contiguous before filtering become detectable after. The detection at line 76 may miss these.

The handoff document acknowledged this as the motivation for `jq-query.ts` performing post-filter detection — but `processor.ts`'s inline jq path (when `options.jqFilter` is set) does not have equivalent coverage.

## Findings

- `src/lib/response/processor.ts:76` — `detectInjectionPattern(content)` called on pre-filter content ✓
- `src/lib/response/processor.ts:119` — `applyJqFilterToParsed(parsedData, options.jqFilter)` sets `content` to filtered result; no subsequent `detectInjectionPattern` call ✗
- `src/lib/tools/jq-query.ts:96-103` — `jq_query` tool correctly calls `sanitizeResponse` + `detectInjectionPattern` after `applyJqFilter` ✓
- Gap: the two code paths are inconsistent in their post-filter detection coverage

## Proposed Solutions

### Option 1: Add Post-Filter Detection in processor.ts

After line 119 (`content = applyJqFilterToParsed(...)`), re-run detection:

```typescript
// Re-detect after filter: jq may concentrate injection phrases
const postFilterPhrase = detectInjectionPattern(content);
if (postFilterPhrase !== null) {
    let hostname = "unknown";
    try { hostname = new URL(options.url).hostname; } catch { /* keep unknown */ }
    logInjectionDetected(hostname);
}
```

**Pros:**
- Closes the coverage gap
- Consistent with jq-query.ts behaviour
- Detection is cheap (single regex scan)

**Cons:**
- Duplicates hostname extraction logic (already extracted above at line 78–83)

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Extract Hostname + Log Helper, Then Call Twice

Refactor hostname extraction + log call into a local helper and call it both before and after jq:

```typescript
const logIfDetected = (text: string) => {
    if (detectInjectionPattern(text) !== null) {
        let hostname = "unknown";
        try { hostname = new URL(options.url).hostname; } catch { /* keep unknown */ }
        logInjectionDetected(hostname);
    }
};
// Pre-filter
logIfDetected(content);
// ... jq filter ...
if (options.jqFilter) { content = ...; logIfDetected(content); }
```

**Pros:**
- DRY — one implementation
- Cleaner for future additions (e.g., post-save detection)

**Cons:**
- Small refactor required

**Effort:** 45 minutes

**Risk:** Low

---

## Recommended Action

Option 2 if the hostname extraction is being cleaned up anyway; Option 1 otherwise. Both close the security gap equally.

## Technical Details

**Affected files:**
- `src/lib/response/processor.ts:119` — add post-filter detection call after `applyJqFilterToParsed`

## Acceptance Criteria

- [ ] `detectInjectionPattern` is called on the result of `applyJqFilterToParsed` in `processor.ts`
- [ ] If an injection phrase is found post-filter, `logInjectionDetected` is called
- [ ] New test: `processResponse` with a jq filter that concentrates an injection phrase triggers detection

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Traced jq filter path in processor.ts — no post-filter detectInjectionPattern call
- Compared with jq-query.ts which does have post-filter detection
- Identified as genuine coverage gap
