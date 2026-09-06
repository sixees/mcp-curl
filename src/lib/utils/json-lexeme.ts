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
    rawJSON?: (text: string) => object;
    isRawJSON?: (value: unknown) => boolean;
};

/**
 * **The check lives in the module that makes the claim, and the optionality above
 * is what forces it to.**
 *
 * `engines` is advisory — npm installs on an older host anyway without
 * `engine-strict` — so a runtime without these functions is reachable. There
 * `rawJson` is `undefined` and the call throws inside whichever defence pass
 * reached it first; `post-processor.ts::createWrapper` catches that and tags the
 * **undefended** result as wrapped, so the whole defence is skipped, a downstream
 * wrap short-circuits on the tag, and nothing on the response says so.
 * `LESSONS.md` RC-20 is that failure measured, and RC-24 is where reaching for
 * this API nearly reintroduced it.
 *
 * This guard used to sit at `response/processor.ts` module scope, which was the
 * wrong layer once the primitive moved here: it reached `jq_query` only because
 * `tools/jq-query.ts` imports `defendText` from the same barrel that re-exports
 * `processor.ts`, so an import path that did not need `defendText` would have
 * downgraded a loud startup error to an opaque `TypeError` from inside
 * `JSON.parse`. Declaring the two functions optional is what makes this
 * unskippable rather than conventional — delete the guard and the narrowing
 * below stops compiling, so `tsc` now carries the obligation the cast used to
 * merely assert. RC-29.
 *
 * A throw here is loud, immediate, and names the reason. Silence would be a
 * security bypass wearing a compatibility fallback's clothing.
 */
if (typeof rawJsonImpl !== "function" || typeof isRawJsonImpl !== "function") {
    throw new Error(
        "mcp-curl requires Node >= 22: JSON.rawJSON / JSON.isRawJSON are unavailable on this " +
            "runtime, and the response defence cannot preserve JSON number values without them. " +
            `Detected ${process.version}.`
    );
}

/**
 * Deliberately NOT exported.
 *
 * **`isRawNumber` is `JSON.isRawJSON`, which is true for a marker built from any
 * JSON text — not only a number.** Four structural guards read it as "this is a
 * scalar, do not descend", so a marker wrapping an object would make all four
 * treat a composite as a scalar and `defendJsonLeaves` would return an
 * undefended remote object graph — the RC-16 failure arriving through the guard
 * added to prevent it. Keeping this private leaves `keepNumberLexeme` as the
 * only producer in the tree, so the name is true by construction rather than by
 * a convention nothing enforces. RC-29.
 */
const rawJson: (text: string) => object = rawJsonImpl;

/**
 * Whether `value` is a preserved number lexeme rather than ordinary data.
 *
 * **Every consumer that inspects a parsed graph structurally must ask this
 * first.** A marker is an ordinary object at runtime, so a `typeof x ===
 * "object"` test, an `isRecord` test or a key lookup all treat a NUMBER as a
 * container — which is how the marker's internals leak into output, and how a
 * walk over "objects" starts descending into scalars.
 */
export const isRawNumber: (value: unknown) => boolean = isRawJsonImpl;

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
 * **The measured cost, recorded because the cap is the only lever and the next
 * caller needs the number.** Attaching ANY reviver drops V8 off its bulk parse
 * path onto a per-node JS callback, and that — not the wrappers — is the
 * dominant cost: an identity reviver `(_k, v) => v` already costs 14.3x on a
 * 5 MB document, and these wrappers add roughly 30% on top. So no cleverness at
 * the mechanism recovers it. Two mitigations were measured and rejected:
 * wrapping only numbers whose default spelling differs from the source
 * (2562 ms vs 2229 ms adversarially, and *worse* on realistic bodies, because
 * `String(v)` costs what the allocation costs), and a regex pre-screen (74 ms on
 * a 5 MB document when it does not fire, and it early-exits into the reviver on
 * any document containing a decimal — i.e. most of them).
 *
 * Measured, Node 24, per parse:
 *
 * | body                       | plain   | with this reviver |
 * |----------------------------|---------|-------------------|
 * | PageSpeed-shaped, 3.5 MB   | 12.3 ms | 34.8 ms           |
 * | Toggl-shaped, 1.6 MB       |  3.2 ms | 24.3 ms           |
 * | numeric, 9.5 MB            |   18 ms | 384 ms            |
 *
 * The 9.5 MB row also peaks ~308 MB RSS against ~83 MB. **Accepted rather than
 * fixed**, because the realistic payloads this proxy exists for cost ~+22 ms and
 * the alternative — falling back to a plain parse above a threshold — would
 * re-corrupt exactly the large bodies `jq_query` is now the advertised route to,
 * which is one invariant's fix reintroducing another's violation. **If that
 * trade ever needs revisiting, the lever is `JQ.MAX_QUERY_FILE_SIZE` (10 MB
 * today), not this function.**
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
