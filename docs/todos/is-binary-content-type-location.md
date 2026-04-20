# TODO: Move isBinaryContentType to utils or config

## Problem

`isBinaryContentType()` is a pure predicate function currently defined as a module-private
function in `src/lib/response/processor.ts`. It has no dependency on response-processing
logic and would be more discoverable and reusable in `src/lib/utils/` or
`src/lib/config/security/`.

## Proposed Fix

Move `isBinaryContentType()` to `src/lib/utils/content-type.ts` (new file) or
`src/lib/config/security/` alongside the other pure predicate functions. Export it
and update the import in `processor.ts`.

Note: This is a pure refactor with no behaviour change. Ensure existing tests still pass.

## Location

- `src/lib/response/processor.ts:22-39` — current location
- Target: `src/lib/utils/` or `src/lib/config/security/`

## Source

PR #20 code review (coderabbitai)
