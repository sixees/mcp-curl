// src/lib/extensible/schema-sanitizer.ts
// Deep, in-place sanitisation of Zod field `description` metadata.
//
// Why in-place (and not "rebuild via z.object/z.array/z.union")?
// The earlier rebuild approach silently dropped runtime invariants:
//   - `.refine()` / `.check()` chains on a ZodObject (`z.object(newShape)`
//     produces a fresh node with no checks).
//   - `.strict()` / `.passthrough()` mode (catchall is part of `_def`,
//     not the shape).
//   - `.array().min()` / `.max()` / `.length()` / `.nonempty()` length
//     constraints (rebuilding via `z.array(elem)` wipes them).
//   - `ZodDiscriminatedUnion` discriminator (rebuild via `z.union(opts)`
//     downgrades it to a plain ZodUnion).
//   - Factory defaults on ZodDefault — `_def.defaultValue` is a *getter*
//     that evaluates the factory, so `.default(field._def.defaultValue)`
//     freezes the factory closure into a single concrete value.
//
// Mutating the registry entry on the original schema instance preserves
// every one of those invariants while still neutralising Unicode-attack
// chars (bidi / zero-width / variation selectors) in advertised metadata.
//
// Side-effect contract: this function intentionally mutates the caller's
// schema (the `description` registry entry only — no parsing semantics
// change). This is a security-improving mutation, not a behaviour change.
// Callers that need to keep the unsanitised text around should clone with
// `.describe(originalText)` BEFORE handing the schema in.

import { z } from "zod";
import { sanitizeDescription } from "../utils/index.js";

/**
 * Recursion depth bound. A pathological caller-built schema with
 * thousands of nesting layers should not blow the call stack — we cap
 * traversal at 100 levels (matching the bound used by other defensive
 * walkers in the repo).
 */
const MAX_RECURSION_DEPTH = 100;

/**
 * Walk a Zod object schema and sanitise every `description` registered
 * in `z.globalRegistry` for the schema and its descendants.
 *
 * Recursion contract — descends into:
 *   - `ZodObject` — every value of `.shape`.
 *   - `ZodArray` — `.element`.
 *   - `ZodUnion` (and `ZodDiscriminatedUnion`, which `instanceof ZodUnion`
 *     in Zod v4) — every `.options` entry.
 *   - `ZodTuple` — every `.def.items` entry plus `.def.rest` if set.
 *   - `ZodRecord` / `ZodMap` — `.keyType` and `.valueType`.
 *   - `ZodSet` — `.def.valueType`.
 *   - `ZodIntersection` — `.def.left` and `.def.right`.
 *   - `ZodPipe` (produced by `.transform()` and `.pipe()`) — `.in` and `.out`.
 *   - `ZodLazy` — the schema returned by `.unwrap()` (which calls the lazy
 *     getter). Recursive lazy schemas are handled by the WeakSet cycle guard.
 *   - `ZodOptional` / `ZodNullable` / `ZodDefault` / `ZodReadonly` /
 *     `ZodCatch` / `ZodPromise` — `.unwrap()`.
 *
 * `.refine()` / `.check()` / `.superRefine()` do **not** wrap the schema in
 * Zod v4 — they append checks to the existing instance — so descriptions
 * placed before a refinement are sanitised in place by the leaf walk.
 *
 * Other Zod types (numeric/string/literal/enum leaves, plus any future
 * wrapper not enumerated above) are treated as leaves: their own description
 * (if any) is sanitised but no further descent happens.
 *
 * Idempotent: a second call on the same schema is a no-op (sanitisation
 * doesn't change a value that's already clean).
 *
 * Performance: O(N) WeakSet lookups across N schema nodes per call. The
 * earlier WeakMap memo cache was removed because in-place idempotence
 * makes it redundant for correctness, and `registerCustomTool` is a
 * startup-time call site. Hot-reload patterns that re-register the same
 * deeply nested schema hundreds of times per second would re-walk on
 * every call — reintroduce a cache at that point.
 *
 * @param schema - Top-level ZodObject to walk
 * @returns The same `schema` instance (registry entries mutated in place)
 */
export function sanitizeFieldDescriptionsDeep<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T
): T {
    sanitizeNode(schema, 0, new WeakSet());
    return schema;
}

/**
 * Internal walker. Sanitises the node's own description, then recurses
 * into structural children. The `visited` WeakSet guards against cycles
 * — schemas can be referenced multiple times in the same tree (DAG-shaped
 * registrations and recursive `z.lazy(...)` definitions are legitimate),
 * and re-walking is wasted work even when not cyclic.
 */
function sanitizeNode(
    field: z.ZodTypeAny,
    depth: number,
    visited: WeakSet<object>
): void {
    if (depth > MAX_RECURSION_DEPTH) return;
    if (visited.has(field)) return;
    visited.add(field);

    sanitizeOwnDescription(field);

    if (field instanceof z.ZodObject) {
        for (const key of Object.keys(field.shape)) {
            sanitizeNode(field.shape[key] as z.ZodTypeAny, depth + 1, visited);
        }
        return;
    }
    if (field instanceof z.ZodArray) {
        sanitizeNode(field.element as z.ZodTypeAny, depth + 1, visited);
        return;
    }
    if (field instanceof z.ZodUnion) {
        for (const opt of field.options as readonly z.ZodTypeAny[]) {
            sanitizeNode(opt, depth + 1, visited);
        }
        return;
    }
    if (field instanceof z.ZodTuple) {
        // ZodTuple has no public instance accessor for items; `.def.items`
        // is the supported public alias for the underlying definition.
        const def = field.def as unknown as {
            items: readonly z.ZodTypeAny[];
            rest: z.ZodTypeAny | null;
        };
        for (const item of def.items) {
            sanitizeNode(item, depth + 1, visited);
        }
        if (def.rest) {
            sanitizeNode(def.rest, depth + 1, visited);
        }
        return;
    }
    if (field instanceof z.ZodRecord || field instanceof z.ZodMap) {
        // ZodRecord and ZodMap expose `keyType` and `valueType` as own
        // instance properties, so we read them directly off the instance.
        // ZodSet (handled in the next branch) does NOT — it surfaces only
        // `valueType`, and only via `.def` — which is why the access
        // pattern below differs from this one.
        const keyed = field as unknown as {
            keyType: z.ZodTypeAny;
            valueType: z.ZodTypeAny;
        };
        sanitizeNode(keyed.keyType, depth + 1, visited);
        sanitizeNode(keyed.valueType, depth + 1, visited);
        return;
    }
    if (field instanceof z.ZodSet) {
        // Unlike ZodRecord/ZodMap above, ZodSet has no public instance
        // accessor for its element schema in Zod v4 — `.def.valueType` is
        // the supported public alias.
        const def = field.def as unknown as { valueType: z.ZodTypeAny };
        sanitizeNode(def.valueType, depth + 1, visited);
        return;
    }
    if (field instanceof z.ZodIntersection) {
        const def = field.def as unknown as {
            left: z.ZodTypeAny;
            right: z.ZodTypeAny;
        };
        sanitizeNode(def.left, depth + 1, visited);
        sanitizeNode(def.right, depth + 1, visited);
        return;
    }
    if (field instanceof z.ZodPipe) {
        // `.transform()` and `.pipe()` both produce a ZodPipe whose `.in`
        // is the source schema and `.out` is the post-transform schema.
        // `.in` / `.out` are public instance getters in Zod v4 (analogous
        // to `ZodArray.element`). Re-verify on Zod v5 migration — the
        // wider plan calls out Zod-v4 stability as a known fragility.
        const piped = field as unknown as {
            in: z.ZodTypeAny;
            out: z.ZodTypeAny;
        };
        sanitizeNode(piped.in, depth + 1, visited);
        sanitizeNode(piped.out, depth + 1, visited);
        return;
    }
    if (
        field instanceof z.ZodOptional ||
        field instanceof z.ZodNullable ||
        field instanceof z.ZodDefault ||
        field instanceof z.ZodReadonly ||
        field instanceof z.ZodCatch ||
        field instanceof z.ZodPromise ||
        field instanceof z.ZodLazy
    ) {
        // `unwrap()` returns the core `$ZodType` base; the classic walker
        // recurses on the wider classic type. Casting through unknown keeps
        // the assertion narrow without `any`. For ZodLazy, `unwrap()` invokes
        // the deferred getter — recursive lazy schemas are bounded by the
        // WeakSet cycle guard above.
        const inner = field.unwrap() as unknown as z.ZodTypeAny;
        sanitizeNode(inner, depth + 1, visited);
        return;
    }
    // Leaves: nothing further to descend into. Own description (if any)
    // was already sanitised above.
}

/**
 * If this node has a registered description, sanitise it and write the
 * result back via `z.globalRegistry.add()` (which overwrites the existing
 * entry on the same instance — no clone, no rebuild).
 *
 * Empty descriptions ⇒ remove the description key so it doesn't surface in
 * JSON Schema output as a meaningless empty string. Applies symmetrically
 * to two cases: the caller registered `.describe("")` directly, OR the
 * description was non-empty but sanitised down to an empty string. Other
 * registered meta keys (id, title, …) are preserved.
 */
function sanitizeOwnDescription(field: z.ZodTypeAny): void {
    const existing = z.globalRegistry.get(field);
    // Narrow `existing` to non-null up front so the registry writes below
    // need no `!` assertion, and to remove any TOCTOU-style fragility if a
    // future caller mutates the registry between the two reads.
    if (!existing) return;
    const desc = existing.description;
    if (typeof desc !== "string") return;

    if (desc.length === 0) {
        removeDescriptionEntry(field, existing);
        return;
    }

    const sanitised = sanitizeDescription(desc);
    if (sanitised === desc) return;

    if (sanitised.length === 0) {
        removeDescriptionEntry(field, existing);
        return;
    }

    z.globalRegistry.add(field, { ...existing, description: sanitised });
}

/**
 * Strip the `description` key from an existing registry entry, removing the
 * whole entry when no other meta keys remain. Caller is responsible for
 * having already confirmed `existing` is non-null.
 */
function removeDescriptionEntry(
    field: z.ZodTypeAny,
    existing: { description?: string } & Record<string, unknown>
): void {
    const { description: _omit, ...rest } = existing;
    if (Object.keys(rest).length === 0) {
        z.globalRegistry.remove(field);
    } else {
        z.globalRegistry.add(field, rest);
    }
}
