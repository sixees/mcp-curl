# TODO: Add `description` field to `filterPresets` schema

## Problem

`filterPresets` schema only supports `name` + `jqFilter` per preset. `buildToolDescription()`
can only emit `"applies filter .foo"` — no way to provide rich semantic descriptions.

## Proposed Fix

Add an optional `description` field to the preset type. `buildToolDescription()` would use it
when present, falling back to the current jqFilter-based text.

## Locations

- `src/lib/schema/types.ts:73-78` — `ResponseConfig.filterPresets` type
- `src/lib/schema/validator.ts:57-60` — Zod schema for presets
- `src/lib/schema/generator.ts:447-460` — `buildToolDescription()` function
