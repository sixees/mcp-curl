---
status: complete
priority: p3
issue_id: "008"
tags: [code-review, prompt-injection]
dependencies: []
pr: "#20"
---

# Missing Binary MIME Types in isBinaryContentType

## Problem Statement

`isBinaryContentType` in `processor.ts` gates Unicode sanitization for binary responses. Its current coverage is missing several common binary MIME types. If a server returns one of the missing types, the response will be run through `sanitizeResponse` unnecessarily — stripping content that may be legitimately binary-encoded text or producing garbled output.

## Findings

Missing from `isBinaryContentType` (line 22–33, `processor.ts`):
- `application/wasm` — WebAssembly binary
- `application/zip` — ZIP archive
- `application/gzip` / `application/x-gzip` — compressed data
- `application/x-tar` — tar archive
- `multipart/*` — multipart responses (e.g., `multipart/form-data`) contain binary parts

Also potentially:
- `application/x-protobuf` / `application/protobuf` — Protocol Buffers binary wire format
- `application/cbor` — CBOR binary encoding

HTML comment stripping is gated on `text/html` only — does not apply to `application/xhtml+xml` (XHTML) or `text/xml` which can also contain HTML-style comments.

## Proposed Solutions

### Option 1: Add Missing Types to isBinaryContentType

```typescript
mime === "application/wasm" ||
mime === "application/zip" ||
mime === "application/gzip" || mime === "application/x-gzip" ||
mime === "application/x-tar" ||
mime.startsWith("multipart/")
```

And extend HTML comment stripping:
```typescript
if (options.contentType?.startsWith("text/html") ||
    options.contentType?.includes("xhtml") ||
    options.contentType?.startsWith("text/xml")) {
    content = content.replace(HTML_COMMENT_PATTERN, "");
}
```

**Pros:**
- Comprehensive coverage
- No functional change for common use cases

**Cons:**
- `multipart/*` bodies are rarely returned as-is to the LLM; this case may be theoretical
- `text/xml` comment stripping may be overly broad

**Effort:** 30 minutes

**Risk:** Very Low

---

### Option 2: Allowlist Text Types Instead

Invert the check: sanitize ONLY known text types rather than blocklisting binary ones:

```typescript
function isTextContentType(contentType: string | undefined): boolean {
    const mime = contentType?.split(";")[0].trim().toLowerCase() ?? "";
    return mime.startsWith("text/") ||
           mime === "application/json" ||
           mime === "application/xml" ||
           mime === "application/javascript";
}
// Then: if (!isTextContentType(options.contentType)) skip sanitization
```

**Pros:**
- Allowlist is more conservative; new binary types don't require code updates
- Matches "secure by default" principle

**Cons:**
- Would skip sanitization for responses with unknown/absent content-type
- Currently `processResponse` sanitizes responses with no content-type (which is safe/conservative behaviour)

**Effort:** 45 minutes

**Risk:** Low

---

## Recommended Action

Option 1 — add the most common missing binary types. The current blocklist approach is acceptable; just ensure common types are covered.

## Technical Details

**Affected files:**
- `src/lib/response/processor.ts:22-33` — `isBinaryContentType` function
- `src/lib/response/processor.ts:68-70` — HTML comment stripping gate

## Acceptance Criteria

- [ ] `application/wasm`, `application/zip`, `application/gzip` are treated as binary
- [ ] `multipart/*` content types are treated as binary
- [ ] Tests for the new binary type entries

## Work Log

### 2026-04-20 - Identified in code review

**By:** Claude Code (review agent)

**Actions:**
- Reviewed isBinaryContentType against IANA MIME type registry
- Identified common binary types missing from the check
