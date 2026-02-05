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
