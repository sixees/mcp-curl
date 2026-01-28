# lib/ Module Structure

Extracted utility modules organized by domain.

## Dependency Graph

```
config/ → types/ → files/ → security/ → jq/ → utils/
                                              ↓
                                          index.ts
```

No circular dependencies.

## Modules

| Module | Purpose |
|--------|---------|
| `config/` | Constants: limits, server info, session settings, SSRF patterns |
| `types/` | TypeScript type definitions |
| `files/` | Temp directory lifecycle, output directory validation |
| `security/` | SSRF protection, rate limiting, file/input validation |
| `jq/` | JQ-like filter parsing and application |
| `utils/` | Error message helpers |

## Barrel Exports

Each module has an `index.ts` that re-exports public APIs.
Test-only functions (e.g., `clearRateLimitMaps`, `clearAllowedDirsCache`)
are intentionally not exported from barrel files - import directly from
the source file if needed for testing.

## Testing

Test files co-located with source using `.test.ts` suffix.
Run: `npm test`
