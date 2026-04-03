# TODO: Cache `server.utilities()` result

## Problem

`server.utilities()` creates a new `InstanceUtilities` object on every call via
`createInstanceUtilities(this.getConfig())`. Since config is frozen after `start()`,
the result could be cached.

## Proposed Fix

Cache the `InstanceUtilities` instance after first call (or after `start()`), return
the cached value on subsequent calls.

## Location

- `src/lib/extensible/mcp-curl-server.ts:259-261`