# TODO: Sanitize YAML schema descriptions at load time

## Problem

`src/lib/schema/generator.ts` calls `sanitizeDescription()` in 7 places
(approximately lines 60, 74, 315, 322, 462, 469, 471, 473, 500, 530) — once
per YAML→tool seam (`buildToolDescription`, `generateInputSchema`,
`resolveJqFilter`, `registerEndpointTools`, `generateToolDefinitions`).

Each call site is correct, but the contract is implicit: the schema object
itself can carry un-sanitized strings, and callers must remember to sanitize
on every read. This is fragile — a future caller can easily forget.

## Proposed Fix

Sanitize once at YAML load time (in `src/lib/schema/loader.ts`) and store the
sanitized strings on the schema object. The contract becomes:

> A schema object returned by `loadApiSchema()` is pre-sanitized; downstream
> callers do not need to re-sanitize.

Eliminates the repeated calls in `generator.ts` and makes sanitization an
invariant of the schema type, not a discipline.

This is a refactor — calls are pure and cheap, so there's no urgency, but it
strengthens the type system's role in enforcing the trust boundary.

## Location

- `src/lib/schema/loader.ts` — `loadApiSchema()` (where to add sanitization)
- `src/lib/schema/generator.ts` — call sites to remove
- `src/lib/schema/types.ts` — consider branding the schema type to mark it
  as pre-sanitized

## Source

PR #21 comprehensive review (code-simplicity-reviewer)
