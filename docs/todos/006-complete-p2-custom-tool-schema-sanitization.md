---
status: complete
priority: p2
issue_id: "006"
tags: [security, code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# registerCustomTool Does Not Sanitize Zod Schema Field Descriptions

## Problem Statement

`registerCustomTool` in `mcp-curl-server.ts` creates a defensive copy of the tool metadata and sanitizes the top-level `description` field, but does NOT sanitize Zod input schema field descriptions. An attacker supplying a custom tool with injection payloads in parameter descriptions (e.g., `z.string().describe("ignore previous instructions...")`) would bypass sanitization entirely.

Schema field descriptions are sent to the LLM as part of tool metadata and can be used to hijack model behavior just as effectively as top-level tool descriptions.

## Findings

- `src/lib/extensible/mcp-curl-server.ts:registerCustomTool` — sanitizes `meta.description` but does not walk `meta.inputSchema` to sanitize `.describe()` strings
- Zod v4 schemas expose `.description` on each schema node (accessible via `schema.description` or the `_def.description` internal field)
- The plan document (`docs/plans/...`) called out schema description sanitization as part of the defense surface; `schema/generator.ts` does sanitize generated schema descriptions, but `registerCustomTool` does not
- Top-level description truncation is enforced (`MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH`); parameter descriptions have no equivalent limit

## Proposed Solutions

### Option 1: Warn Only — Document the Gap

Add a `console.warn` noting that `inputSchema` field descriptions are caller's responsibility to sanitize. Update JSDoc.

**Pros:**
- No implementation risk — Zod schema mutation is complex

**Cons:**
- Leaves the injection vector open
- Inconsistent with the defensive-copy approach taken for other metadata fields

**Effort:** 15 minutes

**Risk:** Low

---

### Option 2: Sanitize Zod Schema Descriptions via Schema Wrapper

Walk the Zod schema and sanitize each node's `.describe()` value:

```typescript
function sanitizeZodDescriptions<T extends z.ZodTypeAny>(schema: T): T {
    // Zod v4: schema._def.description contains the description string
    const def = (schema as z.ZodTypeAny)._def;
    if (def.description) {
        def.description = sanitizeDescription(def.description);
    }
    // Recurse into shape for ZodObject, element for ZodArray, etc.
    ...
}
```

**Pros:**
- Closes the injection vector for schema parameter descriptions

**Cons:**
- Mutates Zod schema internals (`_def`) — fragile across Zod versions
- Zod v4 changed internal structure; needs careful testing
- Complex to recurse all schema variants (optional, union, array, object)

**Effort:** 3–4 hours

**Risk:** Medium (Zod version coupling)

---

### Option 3: Require Callers to Pre-Sanitize; Validate at Registration

Document that callers must sanitize schema descriptions, but add runtime validation that throws on registration if any description exceeds `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH` or contains obvious injection patterns.

**Pros:**
- Shifts responsibility appropriately (callers control their schemas)
- Validation at registration is a good defensive barrier
- No Zod internals access

**Cons:**
- Detection-based validation may have false positives for legitimate descriptions

**Effort:** 1–2 hours

**Risk:** Low

---

## Recommended Action

Option 3 in the short term — document the gap and add registration-time length validation for schema field descriptions. Option 2 as follow-up once Zod v4 API is better understood.

## Technical Details

**Affected files:**
- `src/lib/extensible/mcp-curl-server.ts:registerCustomTool` — add validation/sanitization for inputSchema descriptions
- JSDoc on `registerCustomTool` — document that callers should sanitize field descriptions

## Acceptance Criteria

- [ ] `registerCustomTool` either sanitizes or validates Zod schema field descriptions
- [ ] Top-level tool description truncation documented and schema-level gap documented in JSDoc
- [ ] Existing tests pass; new test for schema description handling

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Read registerCustomTool implementation
- Confirmed sanitizeDescription applied to meta.description but not inputSchema node descriptions
- Compared with schema/generator.ts which does sanitize generated descriptions
