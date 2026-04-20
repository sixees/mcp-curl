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

```
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
- [ ] Consider adding `s` (dotAll) flag to `INJECTION_PATTERNS` or adding `[\s\S]` alternatives for cross-line detection
- [ ] Add tests verifying binary content types are not sanitized
- [ ] Consider metrics/telemetry integration point for `logInjectionDetected`

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
