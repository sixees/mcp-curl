import { describe, it, expect } from 'vitest';
import { parseJqFilter, splitJqFilters } from './parser.js';

describe('parseJqFilter', () => {
    it('parses simple dot notation', () => {
        const result = parseJqFilter('.data.items');
        expect(result).toEqual([
            { type: 'key', value: 'data' },
            { type: 'key', value: 'items' }
        ]);
    });

    it('parses array index access', () => {
        const result = parseJqFilter('.items[0]');
        expect(result).toEqual([
            { type: 'key', value: 'items' },
            { type: 'index', value: 0 }
        ]);
    });

    it('parses quoted keys', () => {
        const result = parseJqFilter('.["key-with-dashes"]');
        expect(result).toEqual([
            { type: 'key', value: 'key-with-dashes' }
        ]);
    });

    it('parses numeric index via dot notation', () => {
        const result = parseJqFilter('.items.0');
        expect(result).toEqual([
            { type: 'key', value: 'items' },
            { type: 'index', value: 0 }
        ]);
    });

    it('parses array slices', () => {
        const result = parseJqFilter('.items[0:5]');
        expect(result).toEqual([
            { type: 'key', value: 'items' },
            { type: 'slice', start: 0, end: 5 }
        ]);
    });

    it('rejects leading zeros in indices via dot notation', () => {
        // Leading zeros validation happens in parseJqFilter for dot notation (e.g., .items.007)
        expect(() => parseJqFilter('.items.007'))
            .toThrow('leading zeros');
    });

    it('rejects unclosed brackets', () => {
        expect(() => parseJqFilter('.items[0'))
            .toThrow('Unterminated bracket');
    });

    it('rejects unclosed quotes', () => {
        expect(() => parseJqFilter('.["unclosed'))
            .toThrow('Missing closing quote');
    });

    it('parses identity filter', () => {
        // Just "." should produce empty tokens (handled by applySingleJqFilter)
        const result = parseJqFilter('.');
        expect(result).toEqual([]);
    });

    it('rejects negative array indices', () => {
        expect(() => parseJqFilter('.items[-1]'))
            .toThrow('negative indices');
    });

    it('rejects negative slice start', () => {
        expect(() => parseJqFilter('.items[-1:5]'))
            .toThrow('negative indices');
    });

    it('rejects negative slice end', () => {
        expect(() => parseJqFilter('.items[0:-1]'))
            .toThrow('negative indices');
    });
});

describe('splitJqFilters', () => {
    it('splits comma-separated filters', () => {
        const result = splitJqFilters('.name,.email');
        expect(result).toEqual(['.name', '.email']);
    });

    it('handles single filter', () => {
        const result = splitJqFilters('.name');
        expect(result).toEqual(['.name']);
    });

    it('respects brackets when splitting', () => {
        const result = splitJqFilters('.items[0:5],.name');
        expect(result).toEqual(['.items[0:5]', '.name']);
    });

    it('respects quotes when splitting', () => {
        const result = splitJqFilters('.["a,b"],.name');
        expect(result).toEqual(['.["a,b"]', '.name']);
    });

    it('handles many filters within limit', () => {
        // splitJqFilters now enforces the max filters limit
        const manyFilters = Array(20).fill('.x').join(',');
        const result = splitJqFilters(manyFilters);
        expect(result.length).toBe(20);
    });

    it('rejects too many filters', () => {
        const tooManyFilters = Array(21).fill('.x').join(',');
        expect(() => splitJqFilters(tooManyFilters))
            .toThrow('Maximum allowed is 20');
    });

    it('rejects leading comma', () => {
        expect(() => splitJqFilters(',.name'))
            .toThrow('leading comma');
    });

    it('rejects trailing comma', () => {
        expect(() => splitJqFilters('.name,'))
            .toThrow('trailing comma');
    });

    it('rejects consecutive commas', () => {
        expect(() => splitJqFilters('.name,,.email'))
            .toThrow('consecutive comma');
    });

    it('rejects unclosed brackets', () => {
        expect(() => splitJqFilters('.items[0'))
            .toThrow('unclosed bracket');
    });

    it('rejects unclosed quotes', () => {
        expect(() => splitJqFilters('.["unclosed'))
            .toThrow('unclosed');
    });
});

describe('parseJqFilter — unsupported jq expression syntax', () => {
    // Regression: these expressions were previously absorbed into a bare key
    // name and silently resolved to null instead of being reported as
    // unsupported. See UNSUPPORTED_KEY_CHARS in src/lib/config/jq.ts.
    it.each([
        ['pipe into object construction', '.data | {id, name}'],
        ['pipe into single-field object', '.data | {id}'],
        ['object construction', '{temp: .main.temp}'],
        ['map()', '.items | map(.id)'],
        ['select()', '.items | select(.id == 1)'],
        ['length', '.items | length'],
        ['string interpolation', '.items[0].name | @text'],
        ['variable binding', '.items as $x'],
        ['optional operator', '.items?'],
        ['arithmetic', '.a+.b'],
        ['comparison', '.a==1'],
    ])('rejects %s', (_label, filter) => {
        expect(() => parseJqFilter(filter)).toThrow('unsupported jq syntax');
    });

    it('names the offending character and its position', () => {
        // The space precedes the pipe, so it is reported first.
        expect(() => parseJqFilter('.data | {id}'))
            .toThrow(/unsupported jq syntax " " at position 5/);
        // Without spaces, the pipe itself is named.
        expect(() => parseJqFilter('.data|{id}'))
            .toThrow(/unsupported jq syntax "\|" at position 5/);
    });

    it('still accepts hyphens and underscores in bare keys', () => {
        expect(parseJqFilter('.content-type')).toEqual([{ type: 'key', value: 'content-type' }]);
        expect(parseJqFilter('.assignee_user_ids')).toEqual([
            { type: 'key', value: 'assignee_user_ids' },
        ]);
    });

    it('rejects iterate-and-project, which would silently resolve to null', () => {
        expect(() => parseJqFilter('.results[].id'))
            .toThrow('cannot be followed by further path segments');
        expect(() => parseJqFilter('.a[].b[].c'))
            .toThrow('cannot be followed by further path segments');
    });

    it('still accepts a trailing "[]" as an array passthrough', () => {
        expect(parseJqFilter('.results[]')).toEqual([
            { type: 'key', value: 'results' },
            { type: 'iterate' },
        ]);
    });

    it('still accepts jq operator characters inside bracket notation', () => {
        expect(parseJqFilter('.["a|b: {c}"]')).toEqual([{ type: 'key', value: 'a|b: {c}' }]);
    });
});
