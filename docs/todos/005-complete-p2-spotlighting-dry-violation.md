---
status: complete
priority: p2
issue_id: "005"
tags: [spr-dry, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# Spotlighting Block Duplicated in tool-wrapper.ts

## Problem Statement

The 4-line spotlighting block is copy-pasted identically in both `registerCurlToolWithHooks` and `registerJqToolWithHooks` in `tool-wrapper.ts`. Any future change to spotlighting logic (e.g., handling multi-item content arrays, validating requestId, changing sentinel format) must be made in two places.

```typescript
// Duplicated at line 111-116 AND line 145-150
if (config.enableSpotlighting && !result.isError && result.content.length > 0) {
    return {
        ...result,
        content: [{ type: "text" as const, text: applySpotlighting(result.content[0].text, randomUUID()) }],
    };
}
```

Additionally, `result.content[0].text` is accessed without verifying the content item's type is `"text"`. For non-text content items (image/resource), `.text` is `undefined`, and `applySpotlighting(undefined, ...)` would produce the string `"<response id="...">\nundefined\n</response>"`.

## Findings

- `src/lib/extensible/tool-wrapper.ts:111-117` — curl_execute spotlight block
- `src/lib/extensible/tool-wrapper.ts:145-151` — jq_query spotlight block (identical)
- `result.content[0].text` — no type guard; assumes content[0] is a text item
- `result.content[1..N]` — silently dropped when spotlighting is applied (multi-item content loss)

## Proposed Solutions

### Option 1: Extract maybeApplySpotlighting Helper

```typescript
function maybeApplySpotlighting(
    result: CallToolResult,
    config: Readonly<McpCurlConfig>
): CallToolResult {
    if (!config.enableSpotlighting || result.isError || result.content.length === 0) {
        return result;
    }
    const first = result.content[0];
    if (first.type !== "text") return result; // only spotlight text content
    return {
        ...result,
        content: [{ type: "text" as const, text: applySpotlighting(first.text, randomUUID()) }],
    };
}
```

Replace both inline blocks with `return maybeApplySpotlighting(result, config)`.

**Pros:**
- Single implementation — DRY
- Adds type guard (only spotlights text items)
- Explicitly handles non-text content gracefully

**Cons:**
- Drops `content[1..N]` for multi-item results (same as current behaviour — but now explicit)

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Spotlight All Text Content Items

Handle multi-item content arrays by spotlighting each text item separately:

```typescript
content: result.content.map((item, i) =>
    item.type === "text"
        ? { type: "text" as const, text: applySpotlighting(item.text, randomUUID()) }
        : item
),
```

**Pros:**
- No silent data loss for multi-item content
- More correct semantics

**Cons:**
- Each item gets a different requestId — could be confusing
- Slightly more complex

**Effort:** 45 minutes

**Risk:** Low

---

## Recommended Action

Option 1 — extract helper with type guard. Multi-item text content is not currently produced by either tool, so explicit single-item handling is fine for now.

## Technical Details

**Affected files:**
- `src/lib/extensible/tool-wrapper.ts:111-117,145-151` — extract into shared helper

## Acceptance Criteria

- [ ] Spotlighting logic exists in exactly one place in `tool-wrapper.ts`
- [ ] Non-text content items (type !== "text") are not spotlighted (no `undefined` interpolation)
- [ ] All existing tool wrapper tests pass

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Identified identical 4-line block at two locations in tool-wrapper.ts
- Noted missing type guard on content[0].text access
- Noted silent content[1..N] drop issue
