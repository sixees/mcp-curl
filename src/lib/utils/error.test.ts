import { describe, it, expect } from 'vitest';
import {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
    LOCAL_REFUSAL_CODES,
    LOCAL_REFUSAL_CODE_REASONS,
    LOCAL_REFUSAL_FIRST_LINES,
    LOCAL_REFUSAL_REASONS,
    LocalRefusalError,
    formatLocalRefusal,
    type LocalRefusal,
    type LocalRefusalReason,
} from './error.js';
import { sanitizeErrorMessage } from '../response/parser.js';

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

describe('LocalRefusalError', () => {
    const reasons = Object.keys(LOCAL_REFUSAL_REASONS) as LocalRefusalReason[];
    const everyRefusal = LOCAL_REFUSAL_CODES.flatMap((code) =>
        (LOCAL_REFUSAL_CODE_REASONS[code] as readonly LocalRefusalReason[]).flatMap((reason) => {
            const refusal = (code === 'LOCAL_REDIRECT_REFUSED' ? { code, reason, requestsSent: 2 } : { code, reason }) as LocalRefusal;
            // A rate-limit refusal is rendered with and without its wait.
            return reason === 'rate-limited' ? [refusal, { ...refusal, retryAfterSeconds: 42 } as LocalRefusal] : [refusal];
        })
    );

    it('has a first-line renderer for every code, and a code for every renderer', () => {
        expect(Object.keys(LOCAL_REFUSAL_FIRST_LINES).sort()).toEqual([...LOCAL_REFUSAL_CODES].sort());
    });

    it('gives every code an admissible reason, and every reason a code that admits it', () => {
        expect(Object.keys(LOCAL_REFUSAL_CODE_REASONS).sort()).toEqual([...LOCAL_REFUSAL_CODES].sort());
        for (const code of LOCAL_REFUSAL_CODES) {
            expect(LOCAL_REFUSAL_CODE_REASONS[code].length).toBeGreaterThan(0);
        }
        const admitted = new Set<string>(Object.values(LOCAL_REFUSAL_CODE_REASONS).flat());
        expect([...admitted].sort()).toEqual([...reasons].sort());
    });

    it('does not compile a reason its code does not admit, or requestsSent where nothing was sent', () => {
        // @ts-expect-error -- host-not-allowed is not a rate-limit reason
        const mismatched: LocalRefusal = { code: 'LOCAL_RATE_LIMITED', reason: 'host-not-allowed' };
        // A variable, not a literal: a literal is caught by the excess-property
        // check alone, so only this form shows `requestsSent?: never` holds.
        const withCount = { code: 'LOCAL_HOST_NOT_ALLOWED', reason: 'host-not-allowed', requestsSent: 2 } as const;
        // @ts-expect-error -- nothing was sent, so there is no count
        const counted: LocalRefusal = withCount;
        expect([mismatched, counted]).toHaveLength(2);
    });

    it('opens with the fixed first line when nothing was sent', () => {
        const error = new LocalRefusalError({ code: 'LOCAL_HOST_NOT_ALLOWED', reason: 'host-not-allowed' });
        expect(error.message).toBe(
            "Refused locally: no request was sent (LOCAL_HOST_NOT_ALLOWED). The target host is not in this server's allowedHosts list."
        );
        expect(error.code).toBe('LOCAL_HOST_NOT_ALLOWED');
        expect(error.requestsSent).toBe(0);
        expect(error.name).toBe('LocalRefusalError');
        expect(error.constructor.name).toBe('LocalRefusalError');
    });

    it('says how many requests were sent when a redirect hop is refused', () => {
        const error = new LocalRefusalError({ code: 'LOCAL_REDIRECT_REFUSED', reason: 'redirect-limit', requestsSent: 3 });
        expect(error.message).toBe(
            'Redirect refused locally: 3 request(s) were sent; hop 4 was not (LOCAL_REDIRECT_REFUSED). The redirect chain reached max_redirects.'
        );
        expect(error.requestsSent).toBe(3);
    });

    it.each([0, -1, 1.5, NaN])('refuses a redirect refusal with requestsSent %s', (requestsSent) => {
        expect(() => new LocalRefusalError({ code: 'LOCAL_REDIRECT_REFUSED', reason: 'redirect-limit', requestsSent })).toThrow(TypeError);
    });

    it('ends a rate-limit refusal with its wait, on hop 1 and on a redirect hop', () => {
        const hop1 = new LocalRefusalError({ code: 'LOCAL_RATE_LIMITED', reason: 'rate-limited', retryAfterSeconds: 42 });
        expect(hop1.message).toBe(
            'Refused locally: no request was sent (LOCAL_RATE_LIMITED). The rate limit for this target or session is exhausted; wait before retrying. Retry in 42 s.'
        );
        expect(hop1.retryAfterSeconds).toBe(42);
        const hop2 = new LocalRefusalError({ code: 'LOCAL_REDIRECT_REFUSED', reason: 'rate-limited', requestsSent: 1, retryAfterSeconds: 7 });
        expect(hop2.message).toMatch(/^Redirect refused locally: 1 request\(s\) were sent.* Retry in 7 s\.$/);
    });

    it('does not compile a wait on a code no rate limit produces', () => {
        // @ts-expect-error -- a host-list refusal has no wait
        const waited: LocalRefusal = { code: 'LOCAL_HOST_NOT_ALLOWED', reason: 'host-not-allowed', retryAfterSeconds: 3 };
        expect(waited).toBeDefined();
    });

    it.each([0, -1, 1.5, NaN])('refuses a wait of %s', (retryAfterSeconds) => {
        expect(() => new LocalRefusalError({ code: 'LOCAL_RATE_LIMITED', reason: 'rate-limited', retryAfterSeconds })).toThrow(TypeError);
    });

    it('renders the message formatLocalRefusal renders', () => {
        for (const refusal of everyRefusal) {
            expect(new LocalRefusalError(refusal).message).toBe(formatLocalRefusal(refusal));
        }
    });

    it('is left unchanged by sanitizeErrorMessage, with or without details', () => {
        for (const refusal of everyRefusal) {
            const text = formatLocalRefusal(refusal);
            expect(sanitizeErrorMessage(text, false)).toBe(text);
            expect(sanitizeErrorMessage(text, true)).toBe(text);
        }
    });
});
