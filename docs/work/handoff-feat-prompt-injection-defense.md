# Work Handoff: Prompt Injection Defense

**Date:** 2026-04-20 | **Branch:** feat/prompt-injection-defense | **Plan:** docs/plans/2026-04-20-feat-prompt-injection-defense-mcp-responses-plan.md | **Status:** complete

## Summary

Implemented a layered prompt injection defense for the mcp-curl MCP server. The core concern is that HTTP API responses fed back to LLMs may contain adversarial content (bidi overrides, invisible Unicode, whitespace padding, explicit instruction-override phrases) that manipulate the LLM into ignoring its actual instructions. All defenses are detection/sanitization only — no content is suppressed.

## What was implemented

### Foundation utilities (`src/lib/utils/sanitize.ts`, `src/lib/security/detection-logger.ts`)

- **What:** Core sanitization + detection functions and a throttled detection logger
- **Key files:** `src/lib/utils/sanitize.ts` (new), `src/lib/security/detection-logger.ts` (new), `src/lib/utils/index.ts` (exports), `src/lib/security/index.ts` (exports)
- **Approach:**
  - `sanitizeDescription(s)` — replaces attack chars with space, preserves `\t \n \r`; used on tool metadata
  - `sanitizeResponse(s)` — removes attack chars (C0/C1 excluding `\t \n \r`, bidi, zero-width, Tags block, variation selectors, soft hyphen) + replaces 50+ consecutive spaces with `[WHITESPACE REMOVED]`; used on API response bodies
  - `detectInjectionPattern(s)` — 16-pattern regex (no `g` flag — safe for repeated calls), returns sanitized matched phrase or null; observability only
  - `applySpotlighting(content, requestId)` — wraps content in `<response id="UUID">` sentinels; requestId is per-call, never module-level constant
  - `logInjectionDetected(hostname)` — throttled (1/hostname/60s), logs event class only, never logs matched content
  - `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000`

### Response pipeline (`src/lib/response/processor.ts`)

- **What:** Added sanitization before jq filtering with content-type gating
- **Pipeline order:** size guard → (if not binary) HTML comment stripping → `sanitizeResponse` → `detectInjectionPattern` + log → jq filter → size check/save
- **Why this order:** Size guard before sanitization avoids wasting CPU on oversized responses. Sanitize before jq filter so jq operates on clean content AND the filter can't concentrate injection strings that bypass pre-filter detection.

### Tool layer (`src/lib/tools/jq-query.ts`, `src/lib/extensible/tool-wrapper.ts`)

- **jq-query:** Post-filter `sanitizeResponse` + `detectInjectionPattern` (jq extracts fields that could concentrate injection phrases from sparse data)
- **tool-wrapper:** Optional spotlighting via `config.enableSpotlighting` — applied after `executeWithHooks` so `afterResponse` hooks receive clean (pre-spotlight) content

### Schema/prompt sanitization (`src/lib/schema/generator.ts`, `src/lib/prompts/api-*.ts`)

- Removed local `CONTROL_CHARS` regex from generator.ts; replaced with `sanitizeDescription`
- Applied to: endpoint title, description, param descriptions, filter preset descriptions/jqFilters
- Applied to `auth_token` in api-discovery.ts and `description` in api-test.ts

### Config extension (`src/lib/types/public.ts`, `src/lib/extensible/mcp-curl-server.ts`)

- Added `enableSpotlighting?: boolean` to `McpCurlConfig`
- `KNOWN_CONFIG_KEYS_ARRAY` updated (compile-time exhaustiveness check)
- `registerCustomTool`: now stores a sanitized defensive copy; silently truncates descriptions to 1000 chars with a `console.warn`
- Lifecycle: injection detection map cleanup interval wired into `start()` and cleared in `shutdown()`/rollback

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Sanitize in `processResponse`, not at HTTP layer | Closest to LLM context; jq filter needs to operate on sanitized data | HTTP layer (too early, before jq) |
| Spotlighting in `tool-wrapper`, not in executor | Config-dependent; hooks should see clean content, not spotlighted | Inside `executeCurlRequest` via extra param |
| `detectInjectionPattern` on already-sanitized content | Invisible-char-split phrases (e.g., `Ig\u200Bnore`) become detectable after sanitization | Before sanitization |
| No `g` flag on `INJECTION_PATTERNS` | `g` flag causes `lastIndex` accumulation on repeated `.test()`/`.match()` calls | Would require resetting `lastIndex` before each call |
| Replace with space for `sanitizeDescription`, remove for `sanitizeResponse` | Descriptions should remain readable; response bodies benefit from compact output | Remove in both |

## What to pay attention to during review

- **Risk areas:**
  - `RESPONSE_SANITIZE_PATTERN` excludes `\u0009`, `\u000A`, `\u000D` (tab, LF, CR) — deliberate to preserve JSON/text formatting. The ranges `\u0000-\u0008`, `\u000B`, `\u000C`, `\u000E-\u001F` are covered.
  - `INJECTION_PATTERNS` has no `g` flag — this is intentional. Using `g` would make `.match()` return all matches but also set `lastIndex` on the RegExp object, causing stale state on repeated calls.
  - `applySpotlighting` takes `requestId` from the caller (must be a fresh UUID per call, not a module constant).

- **Edge cases:**
  - Binary content types (image/*, audio/*, video/*, application/octet-stream, pdf, font/*) skip sanitization entirely — these aren't text and shouldn't be modified.
  - HTML responses have `<!-- ... -->` comments stripped before Unicode sanitization.
  - jq-query uses the file basename as the "hostname" in `logInjectionDetected` — not a hostname, but it provides tracing context.

- **Under-tested:**
  - Integration test for spotlighting end-to-end (wrap → check content) not written
  - `processResponse` sanitization pipeline not directly tested (relies on `sanitize.ts` unit tests + integration via existing response tests)
  - HTML comment stripping not explicitly tested

- **Pattern deviations:**
  - `detection-logger.ts` does not follow the `start*/stop*` pattern of `rate-limiter.ts` exactly — the cleanup interval is owned by `McpCurlServer` rather than the module, to keep `detection-logger.ts` stateless except for the map.

## Known issues and limitations

- **Patterns don't match across newlines:** `INJECTION_PATTERNS` uses `.` without the `s` (dotAll) flag, so multi-line injection phrases like `"Ignore\nprevious\ninstructions"` are not detected. Acceptable for v1 — most injections are single-line.
- **False positives possible:** `\bDAN\b` could match in unrelated text; `"system prompt"` will match AI tool responses that discuss their own system prompts. Detection-only, so false positives are just log noise.
- **`sanitizeResponse` strips most C0 controls including VT/FF:** These are legitimately unused in API responses but worth noting.
- **Spotlighting doesn't apply to schema-generated endpoint tools** (in `src/lib/schema/generator.ts`). These tools call `executeCurlRequest` directly and are not wrapped by `tool-wrapper.ts`. Would require additional integration.

## Testing summary

- Tests added: 66 new (58 sanitize.ts, 8 detection-logger.ts) | Passing: yes | Linting: passes (tsc clean)
- Manual testing: not run (no curl binary available in this environment)
- Test gaps: processResponse sanitization pipeline, spotlighting integration, HTML stripping

## Commit history

```git
49e87e7 feat(security): add prompt injection defense layer
```

## Review context

- Start with `src/lib/utils/sanitize.ts` and `src/lib/security/detection-logger.ts` — foundation
- Then `src/lib/response/processor.ts` — main pipeline change
- Then `src/lib/extensible/tool-wrapper.ts` — spotlighting
- Then `src/lib/schema/generator.ts` — schema sanitization
- Related: plan at `docs/plans/2026-04-20-feat-prompt-injection-defense-mcp-responses-plan.md`

## Follow-up work

- [ ] Add integration tests for `processResponse` sanitization pipeline
- [ ] Add spotlighting coverage for schema-generated endpoint tools (src/lib/schema/generator.ts createToolHandler)
- [x] Added `[\s\S]{0,n}` to bounded wildcards in `INJECTION_PATTERNS` — covers cross-line detection
- [ ] Add tests verifying binary content types are not sanitized
- [ ] Consider metrics/telemetry integration point for `logInjectionDetected`

### Outstanding Todos
<!-- All todos from the code review have been resolved — see docs/todos/*-complete-* -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| ~~`docs/todos/001-complete-p1-u2028-u2029-missing-sanitize.md`~~ | P1 | ✅ U+2028/U+2029 added to sanitize regex | code-review |
| ~~`docs/todos/002-complete-p2-detection-logger-lifecycle.md`~~ | P2 | ✅ startInjectionCleanup/stopInjectionCleanup added | code-review |
| ~~`docs/todos/003-complete-p2-post-jq-injection-detection.md`~~ | P2 | ✅ post-jq detectInjectionPattern call added | code-review |
| ~~`docs/todos/004-complete-p2-log-injection-unvalidated-filepath.md`~~ | P2 | ✅ sanitizeDescription wraps filepath in log | code-review |
| ~~`docs/todos/005-complete-p2-spotlighting-dry-violation.md`~~ | P2 | ✅ maybeApplySpotlighting helper extracted | code-review |
| ~~`docs/todos/006-complete-p2-custom-tool-schema-sanitization.md`~~ | P2 | ✅ JSDoc documents inputSchema sanitization responsibility | code-review |
| ~~`docs/todos/007-complete-p3-spotlighting-file-save-messages.md`~~ | P3 | ✅ Comment documents file-save spotlighting semantics | code-review |
| ~~`docs/todos/008-complete-p3-missing-binary-mime-types.md`~~ | P3 | ✅ wasm/zip/gzip/x-tar/multipart added | code-review |
| ~~`docs/todos/009-complete-p3-test-coverage-gaps.md`~~ | P3 | ✅ processor.test.ts + spotlighting + U+2028/U+2029 tests added | code-review |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|

---

## Code Review — 2026-04-20

### Review Summary
- **Reviewer:** automated multi-agent review
- **Agents used:** security-sentinel, code-simplicity-reviewer, typescript-reviewer, silent-failure-hunter, pr-test-analyzer
- **Findings:** 🔴 P1: 1 | 🟡 P2: 5 | 🔵 P3: 3

### Handoff Assessment
The builder's self-assessment was honest and complete. "Known issues and limitations" and "Under-tested" sections proactively surfaced the main gaps. The only significant issue NOT flagged by the builder was the U+2028/U+2029 omission from the sanitize regex — a genuine security bypass that should have been caught during pattern range review. All P2 findings were either acknowledged (test gaps, spotlighting limitations) or are natural review-time discoveries (DRY violations, log injection). Confidence in the implementation is high.

### Key Findings
| ID | Severity | Category | Description | Todo File |
|----|----------|----------|-------------|-----------|
| 1 | 🔴 P1 | Security | U+2028/U+2029 (Unicode line separators) missing from both sanitize regex patterns — injection phrase bypass | `001-pending-p1-u2028-u2029-missing-sanitize.md` |
| 2 | 🟡 P2 | DRY/SRP | detection-logger.ts missing `startInjectionCleanup`/`stopInjectionCleanup` wrappers; mcp-curl-server.ts hardcodes `60_000` instead of using module constant | `002-pending-p2-detection-logger-lifecycle.md` |
| 3 | 🟡 P2 | Security | `detectInjectionPattern` not called after jq filter in `processor.ts` — jq-concentrated phrases evade detection | `003-pending-p2-post-jq-injection-detection.md` |
| 4 | 🟡 P2 | Security | `basename(params.filepath)` unvalidated before use in `console.error` in jq-query.ts | `004-pending-p2-log-injection-unvalidated-filepath.md` |
| 5 | 🟡 P2 | DRY | Identical 4-line spotlighting block duplicated in both tool handlers in `tool-wrapper.ts` | `005-pending-p2-spotlighting-dry-violation.md` |
| 6 | 🟡 P2 | Security | `registerCustomTool` sanitizes top-level description but not Zod inputSchema field descriptions | `006-pending-p2-custom-tool-schema-sanitization.md` |
| 7 | 🔵 P3 | Quality | Spotlighting wraps file-save acknowledgment messages (misleading semantics) | `007-pending-p3-spotlighting-file-save-messages.md` |
| 8 | 🔵 P3 | Quality | `isBinaryContentType` missing: wasm, zip, gzip, multipart/* | `008-pending-p3-missing-binary-mime-types.md` |
| 9 | 🔵 P3 | Testing | Test gaps: processResponse pipeline, spotlighting e2e, HTML stripping, binary gating | `009-pending-p3-test-coverage-gaps.md` |

### Verified Claims
| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass | Yes | 66 new tests; all pass per handoff; tsc clean |
| "No g flag on INJECTION_PATTERNS" | Yes | Confirmed `"i"` flag only at sanitize.ts:46 |
| "Binary content types skip sanitization" | Yes | isBinaryContentType gates the sanitize block |
| "Sanitize before jq filter" | Yes | Confirmed pipeline order in processor.ts |
| "No known issues beyond listed" | Partial | U+2028/U+2029 gap was not surfaced by builder |

### Blockers
P1 finding #1 (U+2028/U+2029 missing from sanitize regex) should be fixed before merge. All other findings are P2/P3 and can be resolved post-merge.

---

## Review Comments Addressed — 2026-04-20

### Changes Made

| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Handoff fenced code block missing language label | @coderabbitai | False positive | Added `git` language label to code block |
| Truncation warning fires on sanitization-shrunk descriptions (false positive) | @coderabbitai | Fix needed | Compute `sanitizedDesc` before slicing; compare length to `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH` directly |
| Normalize MIME before `text/html` check in `processor.ts` | @coderabbitai | Fix needed | Extract `normalizedMime` via `.split(";")[0].trim().toLowerCase()`; use `=== "text/html"` |
| CRITICAL: Re-sanitize jq output before returning — JSON.parse decodes Unicode escapes | @coderabbitai | Fix needed | Added `content = sanitizeResponse(content)` after `applyJqFilterToParsed` |
| `preset.name` used raw in `buildToolDescription` (schema/generator.ts) | @coderabbitai | Fix needed | Extract `presetName = sanitizeDescription(preset.name)` before interpolation |
| Sanitize hostname in `logInjectionDetected` (log injection risk) | @coderabbitai | Fix needed | Added `normalizeDetectionLabel` helper (strips C0/C1, caps at 128 chars); applied in `logInjectionDetected` |
| `INJECTION_PATTERNS` uses `.{0,n}` which doesn't match across newlines | @coderabbitai | Fix needed | Replaced all bounded `.{0,n}` wildcards with `[\s\S]{0,n}` in 6 patterns |
| Why not extract post-jq detection into a shared helper? | @gemini-code-assist | Decision conflict | Kept separate: pre-jq block sanitizes (text only); post-jq block sanitizes AND re-sanitizes after JSON.parse decoding. Different responsibilities — premature DRY abstraction would obscure the intent |

### Decisions Revised

| Original Decision | New Approach | Reason | Reviewer |
|-------------------|-------------|--------|----------|
| `INJECTION_PATTERNS` `.{0,n}` wildcards (acceptable for v1) | `[\s\S]{0,n}` — matches newlines | Multi-line injection bypasses noted in known issues; bounded wildcards make this safe | @coderabbitai |
| Warn when `sanitizedMeta.description.length < meta.description.length` | Warn only when `sanitizedDesc.length > MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH` | Original condition fires when attack chars are stripped (not a truncation) | @coderabbitai |

### Files Modified

- `src/lib/utils/sanitize.ts` — `[\s\S]{0,n}` in INJECTION_PATTERNS
- `src/lib/security/detection-logger.ts` — `normalizeDetectionLabel` helper in `logInjectionDetected`
- `src/lib/response/processor.ts` — MIME normalization + CRITICAL post-jq `sanitizeResponse`
- `src/lib/schema/generator.ts` — `sanitizeDescription(preset.name)`
- `src/lib/extensible/mcp-curl-server.ts` — truncation warning false positive fix
- `src/lib/utils/sanitize.test.ts` — multi-line injection detection tests
- `src/lib/security/detection-logger.test.ts` — hostname normalization tests
- `src/lib/response/processor.test.ts` — JSON-decoded attack char test (critical path)
- `docs/work/handoff-feat-prompt-injection-defense.md` — markdownlint fix + this section
