# TODO: Public API symmetry for spotlighting helpers

## Problem

`src/lib.ts` re-exports `sanitizeDescription` and
`MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH` so that callers building custom tools can
match the server's internal sanitization policy on tool descriptions.

However, callers building custom tools that emit external content (HTTP body
text, file content, third-party API responses) cannot replicate the built-in
spotlighting and response-sanitisation behaviour, because:

- `applySpotlighting` is not re-exported
- `sanitizeResponse` is not re-exported
- `detectInjectionPattern` is not re-exported

Result: a custom tool author who wants to honour the user's
`enableSpotlighting` config has no public surface to do so. They would have to
import from internals, which is an API-stability hazard.

## Proposed Fix

Re-export from `src/lib.ts`:

- `applySpotlighting(content, requestId)`
- `sanitizeResponse(input)`
- `detectInjectionPattern(input)` (observability-only — useful for callers
  that want to log per their own pipeline)

Document the contract: callers wrapping external content for the LLM should
sanitise + spotlight using the same helpers the server uses internally,
keying the spotlight by `randomUUID()` per request.

## Location

- `src/lib.ts` — re-export block
- `src/lib/utils/sanitize.ts` — source of the helpers

## Source

PR #21 comprehensive review (typescript-reviewer)
