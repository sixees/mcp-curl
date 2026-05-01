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
 *   - `ZodUnion` (and `ZodDiscriminatedUnion`, since the latter
 *     `instanceof ZodUnion`) — every `.options` entry.
 *   - `ZodOptional` / `ZodNullable` / `ZodDefault` — `.unwrap()`.
 *
 * Other Zod types are treated as leaves: their own description (if any)
 * is sanitised but no further descent happens. This is conservative —
 * adding a new wrapper type to Zod won't break us, it just won't recurse
 * into it (unsanitised text in newly-added wrapper bodies would surface
 * as a follow-up review item, not a runtime regression).
 *
 * Idempotent: a second call on the same schema is a no-op (sanitisation
 * doesn't change a value that's already clean).
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
 * registrations are legitimate), and re-walking is wasted work even when
 * not cyclic.
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
    if (
        field instanceof z.ZodOptional ||
        field instanceof z.ZodNullable ||
        field instanceof z.ZodDefault
    ) {
        // `unwrap()` returns the core `$ZodType` base; the classic
        // walker recurses on the wider classic type. Casting through
        // unknown keeps the assertion narrow without `any`.
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
 * Empty-after-sanitisation ⇒ remove the description key so it doesn't
 * surface in JSON Schema output as a meaningless empty string. Other
 * registered meta keys (id, title, …) are preserved.
 */
function sanitizeOwnDescription(field: z.ZodTypeAny): void {
    const existing = z.globalRegistry.get(field);
    const desc = existing?.description;
    if (typeof desc !== "string" || desc.length === 0) return;

    const sanitised = sanitizeDescription(desc);
    if (sanitised === desc) return;

    if (sanitised.length === 0) {
        const { description: _omit, ...rest } = existing!;
        if (Object.keys(rest).length === 0) {
            z.globalRegistry.remove(field);
        } else {
            z.globalRegistry.add(field, rest);
        }
        return;
    }

    z.globalRegistry.add(field, { ...existing, description: sanitised });
}
