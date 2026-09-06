// src/lib/utils/json-lexeme.ts
// Number-lexeme preservation across every parse-and-reserialise in this tree.

/**
 * `JSON.rawJSON` / `JSON.isRawJSON`, typed — TypeScript 5.9 ships no
 * declaration for either.
 *
 * The pair landed in **Node 21**, and this package requires **Node ≥22**
 * (`package.json` → `engines`, `docs/getting-started.md`,
 * `docs/architecture/architecture.md`). So they are used unconditionally rather
 * than probed, and there is exactly one numeric behaviour rather than one per
 * host.
 */
const { rawJSON: rawJsonImpl, isRawJSON: isRawJsonImpl } = JSON as typeof JSON & {
    rawJSON: (text: string) => object;
    isRawJSON: (value: unknown) => boolean;
};

export const rawJson = rawJsonImpl;

/**
 * Whether `value` is a preserved number lexeme rather than ordinary data.
 *
 * **Every consumer that inspects a parsed graph structurally must ask this
 * first.** A marker is an ordinary object at runtime, so a `typeof x ===
 * "object"` test, an `isRecord` test or a key lookup all treat a NUMBER as a
 * container — which is how the marker's internals leak into output, and how a
 * walk over "objects" starts descending into scalars.
 */
export const isRawNumber = isRawJsonImpl;

/**
 * Reviver that keeps every number EXACTLY as the origin spelled it.
 *
 * **A parse-and-reserialise silently rewrites numbers, and the rewrite is not
 * cosmetic.** `JSON.parse` routes every number through a double, so
 * `9223372036854775807` — an ordinary 64-bit identifier — comes back
 * `9223372036854776000`, and `1e400` overflows to `Infinity` and stringifies as
 * `null`. Both hand the model a plausible WRONG value with no signal that
 * anything was lost.
 *
 * `context.source` is the raw lexeme the parser consumed, and `JSON.rawJSON`
 * marks it for verbatim re-emission — so the number never becomes a double at
 * all. `JSON.stringify` re-emits a marker without any help from the caller,
 * which is why only the parse side has to opt in. Measured exact across
 * `9223372036854775807`, `1e400`, `12345678901234567890`, `1.0`, `0.1000`,
 * `-0.0` and `1E+2`.
 *
 * **This lives here, and not beside one of its callers, because the rule has
 * three of them** — the response defence's region-wise walk, `curl_execute`'s
 * `jq_filter` branch and the `jq_query` tool. It had one implementation and two
 * sites without it, so the same body's numbers survived intact inline and were
 * corrupted through jq (`LESSONS.md` RC-24, RC-27).
 */
export function keepNumberLexeme(
    _key: string,
    value: unknown,
    context?: { source?: string }
): unknown {
    return typeof value === "number" && typeof context?.source === "string"
        ? rawJson(context.source)
        : value;
}
