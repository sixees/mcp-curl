# lib/ Module Structure

Extracted utility modules organized by domain.

## Dependency Graph

```
Foundational (no lib deps):
  config/    - Constants and configuration
  types/     - TypeScript type definitions
  utils/     - Error message helpers

Layer 1 (depends on config only):
  files/     → config/

Layer 2 (depends on layer 1):
  jq/        → config/, types/
  security/  → config/, types/, files/, utils/

Layer 3 (depends on layer 2):
  execution/ → config/, security/ (for validateNoCRLF)
  response/  → config/, files/, jq/

Entry point:
  index.ts   → all modules
```

No circular dependencies.

## Modules

| Module | Purpose |
|--------|---------|
| `config/` | Constants: limits, server info, session settings, environment variables, SSRF patterns, validation rules |
| `types/` | TypeScript type definitions |
| `files/` | Temp directory lifecycle, output directory validation |
| `security/` | SSRF protection, rate limiting, file/input validation |
| `jq/` | JQ-like filter parsing and application |
| `utils/` | Error message helpers |
| `execution/` | Command execution with memory tracking, cURL argument building |
| `response/` | Response parsing, formatting, file saving, and processing orchestration |

## Barrel Exports

Each module has an `index.ts` that re-exports public APIs.
Test-only functions (e.g., `clearRateLimitMaps`, `clearAllowedDirsCache`, `resetMemoryTracking`)
are intentionally not exported from barrel files - import directly from
the source file if needed for testing.

## Testing

Test files co-located with source using `.test.ts` suffix.
Run: `npm test`
