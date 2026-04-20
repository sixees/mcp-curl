# TODO: Unit tests for executeJqQuery in jq-query.ts

## Problem

`src/lib/tools/jq-query.ts` — `executeJqQuery()` — is exercised only through integration
paths. Dedicated unit tests with filesystem mocking would improve coverage of path
validation, error branches, and edge cases.

## Proposed Fix

Add `src/lib/tools/jq-query.test.ts` with unit tests that mock `fs` / `path` calls.
Scenarios to cover:
- Valid file path within allowed dirs → returns content
- Path outside allowed dirs → throws security error
- Path traversal (`..`) → throws
- Symlink resolution failure → throws
- File read error (permissions, missing) → propagates correctly
- jq filter applied to file content → correct output

## Location

- `src/lib/tools/jq-query.ts`

## Source

PR #20 code review (coderabbitai)
