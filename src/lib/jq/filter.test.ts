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
