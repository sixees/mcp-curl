# Work Handoff: chore — address quick-win todos from PR #20 review

**Date:** 2026-04-30 | **Branch:** chore/quickwin-todos | **PR:** #21 | **Status:** in-review

> Created during PR comment review — original work did not include a handoff.

## Summary

Quick-win follow-ups from the PR #20 (prompt-injection defense) review. Pulls together SRP/DRY refactors, JSON-safe sanitization, runtime guards on the spotlighting boundary, and a binary-MIME domain extraction. Tests-only refactors collapse phrase-shape assertions into the boolean detector API.

## What was implemented

### Sanitization domain (`src/lib/utils/sanitize.ts`)
- Extracted `UNICODE_ATTACK_RANGES` as a shared string fragment so `DESC_CONTROL_CHARS` and `RESPONSE_SANITIZE_PATTERN` build their own RegExp instances (g+u flags are stateful — must not be shared).
- `RESPONSE_SANITIZE_PATTERN` collapses 50+ consecutive spaces to a single space (JSON-safe — see `applyJqFilterToParsed`).
- `detectInjectionPattern` returns `boolean` (no g flag — stable repeated calls).

### Detection logging (`src/lib/security/detection-logger.ts`)
- `sanitizeAndDetect(text, label)` extracts the sanitize → detect → log sequence used by response and tool-description paths.

### URL helper (`src/lib/utils/url.ts`)
- `safeHostname(url, fallback = "unknown")` for log-safe hostname extraction.

### Content-type domain (`src/lib/utils/content-type.ts`)
- Typed `ReadonlySet`s for binary types and markup-comment-supporting types.
- `parseMimeType`, `isBinaryContentType`, `supportsMarkupComments`.
- SVG carved out from binary classification; markup-comment stripping extended to XHTML/XML/SVG.

### Spotlighting boundary (`src/lib/extensible/tool-wrapper.ts`)
- `maybeApplySpotlighting` runtime-guards the `ToolResult.content[0]` shape because the surrounding `[key: string]: unknown` index signature lets cast values bypass the tuple type at runtime.
- **Fails closed** on shape mismatch — returns `isError: true` with `"Error: invalid tool response shape"` rather than passing the result through unchanged.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Whitespace runs collapse to a single space (not a marker) | Sanitized output is JSON-parsed downstream by `applyJqFilterToParsed`; a non-whitespace marker would break the parse on pretty-printed JSON | `[WHITESPACE REMOVED]` marker — rejected |
| `UNICODE_ATTACK_RANGES` stored as string fragment, not a shared RegExp | RegExp objects with the `g` flag carry state via `lastIndex` — sharing across call sites corrupts subsequent calls | Single shared RegExp — rejected |
| `detectInjectionPattern` returns `boolean` with no `g` flag | A g-flagged RegExp mutates `lastIndex` between calls, producing different results on repeated runs against the same input | Returning the match phrase — discarded as observability-only |
| Spotlighting boundary fails closed on invalid shape | Pass-through silently disabled the injection boundary when `enableSpotlighting` was on — that is an injection vector, not a robustness improvement. Pre-guard code threw a TypeError (effectively fail-closed); the first guard softened that to a silent pass-through (caught in review) | Pass through unchanged — rejected as fail-open |
| Binary-MIME extraction via typed `ReadonlySet` | Domain was previously inlined in response/processor; extraction enables reuse and tighter unit tests | Keep inline — rejected on SRP grounds |

## What to pay attention to during review

- Spotlighting trust boundary is security-critical — any change to `maybeApplySpotlighting`'s shape guard must preserve fail-closed semantics.
- Regex statefulness: any new consumer of `UNICODE_ATTACK_RANGES` must build its own RegExp.
- `RESPONSE_SANITIZE_PATTERN` callback distinguishes whitespace from Unicode runs by checking `match[0] === " "` — order-of-evaluation matters in single-pass replace.

## Review Comments Addressed — 2026-04-30

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| Fail closed instead of bypassing spotlighting on invalid result shape (`tool-wrapper.ts:42`) | @coderabbitai | Fix needed | Replaced pass-through with `isError: true` return + explanatory error text. Added regression test for non-text content shape. Fixed in `455235e`. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|-------------|--------|----------|
| Pass through unwrapped result on invalid shape (added in `ac893ee`) | Return `isError: true` with explicit message — fail closed | Pass-through silently disabled the injection boundary when spotlighting was enabled, weakening the security property. Restoring fail-closed posture matches the original (pre-guard) behaviour where a TypeError would be thrown. | @coderabbitai |

### Files Modified
- `src/lib/extensible/tool-wrapper.ts`
- `src/lib/extensible/tool-wrapper.test.ts`

## Known issues and limitations

- When the response was saved to a file, `content[0]` is a file-path acknowledgment string rather than the actual API response. Spotlighting wraps that internal system message — semantically benign, but worth knowing.

## Testing summary

- `npm run build` clean
- `npm test` — 484 passed, 7 skipped
- New regression test covers fail-closed branch in `maybeApplySpotlighting`

## Follow-up work

- None outstanding from this review pass.
