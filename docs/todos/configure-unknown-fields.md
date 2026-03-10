# TODO: Validate `.configure()` unknown fields

## Problem

`.configure()` uses bare object spread (`{ ...this._config, ...config }`) with no validation.
Unknown fields like `serverName` are silently absorbed. This caused the `serverName`/`serverVersion`
bug caught in the first review round of PR #16.

## Proposed Fix

Either pick known fields explicitly or warn on unknown keys.

## Location

- `src/lib/extensible/mcp-curl-server.ts:102-106`
