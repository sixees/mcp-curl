---
status: complete
priority: p2
issue_id: 022
tags: [code-review, public-api, security, defense-in-depth, dry]
dependencies: [003, 011]
source_pr: 23
review_date: 2026-05-01
review_pass: 2
---

# Expose `sanitizeAndDetect` (or document ordering invariant) on the public barrel

## Problem Statement

The internal canonical pipeline for response-side defence lives at `src/lib/security/detection-logger.ts:50` (`sanitizeAndDetect(text, label)`). It bundles:

1. `sanitizeResponse(text)` — strip Unicode invisibles, collapse 50+ space runs.
2. `detectInjectionPattern(sanitized)` — observability-only check on the *sanitized* text.
3. `logInjectionDetected(label)` — throttled-per-label stderr log.

PR-1's public-barrel additions (`src/lib.ts:81`) re-exported only the three primitives (`sanitizeResponse`, `detectInjectionPattern`, `applySpotlighting`) — not the composer, not `logInjectionDetected`, not even a JSDoc note explaining the invariant ordering.

External custom-tool authors (the stated audience in the docs `docs/custom-tools.md`) must hand-wire the order. The most likely mistake is calling `detectInjectionPattern` on **raw** text before `sanitizeResponse` strips invisible-character splits — exactly the bypass vector the sanitize step exists to close. This silently degrades detection coverage with no log signal that the wiring is wrong. It is the response-side analogue of the `detectInjectionPattern` misuse risk that todo #003 narrows for the standalone primitive.

## Findings

- **File:** `src/lib/security/detection-logger.ts:50` (`sanitizeAndDetect`); `src/lib.ts:81` (barrel)
- **Pattern-recognition reviewer (F2, second pass):** "External custom-tool authors must hand-wire the order, and a wrong ordering silently degrades detection — exactly the misuse risk todo 003 flags for `detectInjectionPattern` standalone."
- **Scope distinct from todo #003:** #003 narrows `detectInjectionPattern` JSDoc against gating misuse. This finding is about *ordering* misuse on the response side, not gating misuse.
- **Scope distinct from todo #011:** #011 is the open architecture question of whether to ship `wrapWithDefence(handler)`. This finding is the narrower question of whether to expose the already-existing internal composer regardless of the wider barrel-decision outcome.

## Proposed Solutions

1. **Re-export `sanitizeAndDetect` from `src/lib.ts`** plus `logInjectionDetected` (so external authors can pick a different log strategy if the throttled-stderr default doesn't fit). Effort: trivial. JSDoc explicitly: "*prefer this over hand-wiring the primitives.*" Recommended.
2. **Re-export an opinionated `wrapResponseWithDefence(text, label)` shim** that calls `sanitizeAndDetect` under the hood and returns only the sanitized string. Effort: S. Trades flexibility (no log-strategy override) for simplicity.
3. **Documentation only** — add an "Ordering invariant: sanitize → detect → log" callout to the barrel's JSDoc and the `docs/custom-tools.md` "Replicating the response-side defence" subsection. Effort: trivial. Tradeoff: doesn't prevent the misuse, just warns about it.

Recommended: 1 (decide before any of PR-2..PR-9 lands more public-API surface).

## Acceptance Criteria

- [ ] `sanitizeAndDetect` (and `logInjectionDetected` if 1 is chosen) re-exported from `src/lib.ts`
- [ ] JSDoc on the export documents the sanitize → detect → log ordering invariant
- [ ] `docs/custom-tools.md` updated to recommend `sanitizeAndDetect` over hand-wired primitives
- [ ] The misuse-prevention warning from todo #003 explicitly points at `sanitizeAndDetect` as the safe alternative

## Resources

- `src/lib/security/detection-logger.ts:50`
- `src/lib.ts:78-86`
- `src/lib/extensible/tool-wrapper.ts` (internal consumer of `sanitizeAndDetect`)
- Related: todo #003 (`detectInjectionPattern` misuse), todo #011 (barrel categorization + `wrapWithDefence` decision)
