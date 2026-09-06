// src/lib/utils/json-lexeme.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { keepNumberLexeme, isRawNumber } from "./json-lexeme.js";

/**
 * A `JSON` double that keeps every real method and replaces only what is named.
 *
 * `Object.create(JSON)` puts the genuine object on the prototype chain, so
 * `parse`, `stringify` and `Symbol.toStringTag` all resolve, while the own
 * properties defined here shadow them. `defineProperty` rather than assignment
 * because an own property of `undefined` is what the module's destructure must
 * see — a plain `= undefined` on an inherited accessor would not shadow it.
 */
function withoutRawJson(overrides: Record<string, unknown>): typeof JSON {
    const double = Object.create(JSON) as typeof JSON;
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(double, key, { value, configurable: true, enumerable: true });
    }
    return double;
}

describe("keepNumberLexeme", () => {
    const parse = (text: string) => JSON.stringify(JSON.parse(text, keepNumberLexeme));

    it.each([
        ["a 64-bit identifier past MAX_SAFE_INTEGER", '{"id":9223372036854775807}'],
        ["an exponent that overflows to Infinity", '{"exp":1e400}'],
        ["a trailing-zero decimal", '{"pi":3.140}'],
        ["negative zero", '{"z":-0.0}'],
        ["a leading-zero decimal", '{"p":0.1000}'],
        ["an uppercase signed exponent", '{"e":1E+2}'],
        ["numbers nested in arrays and objects", '{"a":[1.50,{"b":[9007199254740993]}]}'],
    ])("round-trips %s byte-exact", (_label, doc) => {
        expect(parse(doc)).toBe(doc);
    });

    it("leaves strings, booleans and null alone", () => {
        // The reviver keys on `typeof value === "number"`. Strings DO carry a
        // `context.source`, so without that arm a string would be wrapped too —
        // harmless in output, but it would make `isRawNumber` true for a string
        // and the four structural guards read that as "scalar, do not descend".
        const doc = '{"s":"1","b":true,"n":null}';
        expect(parse(doc)).toBe(doc);
        const parsed = JSON.parse(doc, keepNumberLexeme) as Record<string, unknown>;
        expect(isRawNumber(parsed.s)).toBe(false);
        expect(typeof parsed.s).toBe("string");
    });

    it("marks numbers so the structural guards can see them", () => {
        const parsed = JSON.parse('{"n":1.50}', keepNumberLexeme) as Record<string, unknown>;
        expect(isRawNumber(parsed.n)).toBe(true);
    });

    it("cannot be forged by a remote sending a marker-shaped object", () => {
        // The whole fix rests on this. A marker is an ordinary object at runtime
        // with a `rawJSON` own-property, so if `isRawJSON` keyed off that shape a
        // hostile body could claim to be a verbatim lexeme and be re-emitted
        // unescaped. It keys off an internal slot instead: the forged and genuine
        // objects have identical `Object.keys` and are still told apart.
        const forged = JSON.parse('{"a":{"rawJSON":"1,\\"injected\\":2"}}', keepNumberLexeme) as {
            a: unknown;
        };
        expect(isRawNumber(forged.a)).toBe(false);
        // Re-emitted as an escaped string, not as raw JSON — no field injected.
        expect(JSON.stringify(forged)).toBe('{"a":{"rawJSON":"1,\\"injected\\":2"}}');
    });
});

describe("the Node >= 22 capability guard", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    // TS 5.9 ships no declarations for either function, so the stubs reach for
    // them through a cast — the same cast `json-lexeme.ts` itself has to make.
    const hostJson = JSON as typeof JSON & {
        rawJSON?: (text: string) => object;
        isRawJSON?: (value: unknown) => boolean;
    };

    it("throws at IMPORT, naming the runtime, when JSON.rawJSON is absent", async () => {
        // **This module is imported in isolation on purpose.** The guard used to
        // live in `response/processor.ts`, so it protected this primitive only for
        // import paths that happened to pull that file in. Nothing here imports
        // `response/` — if the guard drifts back out of `json-lexeme.ts`, this
        // case stops throwing (RC-29).
        // **Not `{ ...JSON }`.** Every built-in method is non-enumerable
        // (ECMA-262 §17), so a spread copies NONE of them — the double would be
        // `{ rawJSON, isRawJSON }` with no `parse` and no `stringify`, i.e. a
        // runtime with no JSON at all rather than the Node-21 runtime this case
        // claims to model. Anything touching `JSON.parse` inside the stub window
        // would then throw a TypeError that does not match the expectation
        // below, turning an intact guard red for the wrong reason.
        const stubbed = withoutRawJson({ rawJSON: undefined, isRawJSON: hostJson.isRawJSON });
        vi.stubGlobal("JSON", stubbed);
        vi.resetModules();

        await expect(import("./json-lexeme.js")).rejects.toThrow(/requires Node >= 22/);
    });

    it("throws when JSON.isRawJSON is absent, not only JSON.rawJSON", async () => {
        // Both halves, because the guard tests both and a one-sided check would
        // leave `isRawNumber` returning `undefined` — falsy, so every structural
        // guard would read a marker as a composite and descend into it.
        const stubbed = withoutRawJson({ rawJSON: hostJson.rawJSON, isRawJSON: undefined });
        vi.stubGlobal("JSON", stubbed);
        vi.resetModules();

        await expect(import("./json-lexeme.js")).rejects.toThrow(/requires Node >= 22/);
    });
});
