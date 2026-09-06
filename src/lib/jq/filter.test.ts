import { describe, it, expect } from 'vitest';
import { applyJqFilter, applySingleJqFilter } from './filter.js';

describe('applySingleJqFilter', () => {
    const testData = {
        name: 'test',
        items: [{ id: 1 }, { id: 2 }],
        nested: { deep: { value: 42 } }
    };

    it('extracts top-level keys', () => {
        expect(applySingleJqFilter(testData, '.name')).toBe('test');
    });

    it('extracts nested keys', () => {
        expect(applySingleJqFilter(testData, '.nested.deep.value')).toBe(42);
    });

    it('extracts array elements', () => {
        expect(applySingleJqFilter(testData, '.items[0]')).toEqual({ id: 1 });
    });

    it('extracts array elements via dot notation', () => {
        expect(applySingleJqFilter(testData, '.items.0')).toEqual({ id: 1 });
    });

    it('extracts array slices', () => {
        expect(applySingleJqFilter(testData, '.items[0:1]')).toEqual([{ id: 1 }]);
    });

    it('returns undefined for missing keys', () => {
        expect(applySingleJqFilter(testData, '.nonexistent')).toBeUndefined();
    });

    it('returns null for invalid path on primitive', () => {
        expect(applySingleJqFilter(testData, '.name.invalid')).toBeNull();
    });

    it('returns null for index on non-array', () => {
        expect(applySingleJqFilter(testData, '.name[0]')).toBeNull();
    });
});

describe('applyJqFilter', () => {
    const testData = {
        name: 'test',
        email: 'test@example.com',
        items: [{ id: 1 }, { id: 2 }],
        nested: { deep: { value: 42 } }
    };
    const jsonStr = JSON.stringify(testData);

    it('parses JSON strings', () => {
        const result = applyJqFilter(jsonStr, '.name');
        expect(JSON.parse(result)).toBe('test');
    });

    it('handles single filter', () => {
        const result = applyJqFilter(jsonStr, '.nested.deep.value');
        expect(JSON.parse(result)).toBe(42);
    });

    it('handles multiple filters', () => {
        const result = applyJqFilter(jsonStr, '.name,.email');
        expect(JSON.parse(result)).toEqual(['test', 'test@example.com']);
    });

    it('handles array access', () => {
        const result = applyJqFilter(jsonStr, '.items[0].id');
        expect(JSON.parse(result)).toBe(1);
    });

    it('throws on invalid JSON', () => {
        expect(() => applyJqFilter('not json', '.name'))
            .toThrow('Response is not valid JSON');
    });

    it('throws on empty filter', () => {
        expect(() => applyJqFilter(jsonStr, '.'))
            .toThrow('filter must specify a path');
    });

    it('throws on too many filters', () => {
        const manyFilters = Array(25).fill('.x').join(',');
        expect(() => applyJqFilter(jsonStr, manyFilters))
            .toThrow('too many comma-separated paths');
    });
});

describe('applyJqFilter — return type contract', () => {
    const jsonStr = JSON.stringify({ name: 'test', items: [{ id: 1 }] });

    // Regression: JSON.stringify(undefined) is undefined, not a string, so a
    // missing key used to leak a non-string out of a function declared to
    // return string. jq prints null for an absent path; so do we.
    it('returns the string "null" for a missing key, never undefined', () => {
        const result = applyJqFilter(jsonStr, '.nonexistent');
        expect(typeof result).toBe('string');
        expect(result).toBe('null');
    });

    it('returns a string for every comma-separated path that is missing', () => {
        const result = applyJqFilter(jsonStr, '.nope,.alsoNope');
        expect(typeof result).toBe('string');
        expect(JSON.parse(result)).toEqual([null, null]);
    });

    it('reports unsupported jq expressions instead of returning null', () => {
        expect(() => applyJqFilter(jsonStr, '.items | map(.id)'))
            .toThrow('unsupported jq syntax');
    });
});

describe('number lexemes survive the filter (RC-27)', () => {
    // `applyJqFilter` parses and re-serialises, and `JSON.parse` routes every
    // number through a double. So the jq path used to round a 64-bit id and
    // stringify an overflowing exponent as `null`, while the SAME body returned
    // inline kept both exact — one rule with two implementations, and the
    // corrupted one was the path a too-large response is sent down.
    const body = '{"id":9223372036854775807,"exp":1e400,"pi":3.140,"neg":-0.0,"pad":0.1000}';

    it.each([
        ['.id', '9223372036854775807'],
        ['.exp', '1e400'],
        ['.pi', '3.140'],
        ['.neg', '-0.0'],
        ['.pad', '0.1000'],
    ])('returns %s exactly as the origin spelled it', (filter, expected) => {
        expect(applyJqFilter(body, filter)).toBe(expected);
    });

    it('keeps the spelling through a multi-path filter too', () => {
        // The comma arm builds an array and stringifies that instead, so it is
        // a separate serialisation site and asserting one says nothing about it.
        expect(applyJqFilter(body, '.id,.pi')).toBe('[\n  9223372036854775807,\n  3.140\n]');
    });

    it('does not expose the marker as a navigable object', () => {
        // A preserved lexeme is an object at runtime. Without the `isRawNumber`
        // arm in `isRecord`, this returns the string "3.140" — an internal
        // representation surfaced as if the origin had sent it.
        expect(applyJqFilter(body, '.pi.rawJSON')).toBe('null');
    });

    it('still reports a genuinely missing key as null', () => {
        // The guard above returns `false` from `isRecord`, which is the same
        // answer a real primitive gives — so this must not have become the way
        // every lookup ends.
        expect(applyJqFilter(body, '.nope')).toBe('null');
        expect(applyJqFilter('{"a":{"b":1}}', '.a.b')).toBe('1');
    });
});
