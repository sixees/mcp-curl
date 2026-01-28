import { describe, it, expect } from 'vitest';
import {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
} from './error.js';

describe('getErrorMessage', () => {
    it('extracts message from Error objects', () => {
        expect(getErrorMessage(new Error('test message'))).toBe('test message');
    });

    it('converts non-Error values to string', () => {
        expect(getErrorMessage('string error')).toBe('string error');
        expect(getErrorMessage(42)).toBe('42');
        expect(getErrorMessage(null)).toBe('null');
        expect(getErrorMessage(undefined)).toBe('undefined');
    });
});

describe('createValidationError', () => {
    it('formats error without suggestion', () => {
        const err = createValidationError('filepath', 'path traversal detected');
        expect(err.message).toBe('Invalid filepath: path traversal detected.');
    });

    it('formats error with suggestion', () => {
        const err = createValidationError('filepath', 'path traversal detected', 'Use absolute path');
        expect(err.message).toBe('Invalid filepath: path traversal detected. Use absolute path.');
    });

    it('adds period to suggestion if missing', () => {
        const err = createValidationError('field', 'reason', 'Try this');
        expect(err.message).toMatch(/Try this\.$/);
    });

    it('does not add extra period when suggestion already has one', () => {
        const err = createValidationError('field', 'reason', 'Try this.');
        expect(err.message).toBe('Invalid field: reason. Try this.');
    });
});

describe('createAccessError', () => {
    it('formats access denied error', () => {
        const err = createAccessError('Requests to localhost', 'blocked by default');
        expect(err.message).toBe('Requests to localhost are not allowed: blocked by default.');
    });
});

describe('createFileError', () => {
    it('formats file error with path', () => {
        const err = createFileError('/path/to/file.json', 'does not exist');
        expect(err.message).toBe('File "/path/to/file.json" does not exist.');
    });
});

describe('createConfigError', () => {
    it('formats config error with name and value', () => {
        const err = createConfigError('MCP_CURL_OUTPUT_DIR', '/bad/path', 'directory does not exist');
        expect(err.message).toBe('Invalid MCP_CURL_OUTPUT_DIR value "/bad/path": directory does not exist.');
    });
});
