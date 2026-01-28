import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateUrlAndResolveDns, isLocalhostAllowed } from './ssrf.js';

describe('validateUrlAndResolveDns', () => {
    describe('protocol validation', () => {
        it('blocks file:// protocol', async () => {
            await expect(validateUrlAndResolveDns('file:///etc/passwd'))
                .rejects.toThrow('file:// URLs are not allowed');
        });

        it('blocks ftp:// protocol', async () => {
            await expect(validateUrlAndResolveDns('ftp://example.com'))
                .rejects.toThrow('Protocol "ftp:" is not allowed');
        });

        it('allows http:// protocol', async () => {
            // Will succeed DNS resolution for example.com
            const result = await validateUrlAndResolveDns('http://example.com');
            expect(result).toBeDefined();
            expect(result.hostname).toBe('example.com');
        });

        it('allows https:// protocol', async () => {
            const result = await validateUrlAndResolveDns('https://example.com');
            expect(result).toBeDefined();
            expect(result.hostname).toBe('example.com');
        });
    });

    describe('UNC path blocking', () => {
        it('blocks Windows UNC paths', async () => {
            await expect(validateUrlAndResolveDns('\\\\server\\share'))
                .rejects.toThrow('UNC paths are not allowed');
        });
    });

    describe('localhost handling', () => {
        const originalEnv = process.env.MCP_CURL_ALLOW_LOCALHOST;

        beforeEach(() => {
            delete process.env.MCP_CURL_ALLOW_LOCALHOST;
        });

        afterEach(() => {
            if (originalEnv !== undefined) {
                process.env.MCP_CURL_ALLOW_LOCALHOST = originalEnv;
            } else {
                delete process.env.MCP_CURL_ALLOW_LOCALHOST;
            }
        });

        it('blocks localhost by default', async () => {
            await expect(validateUrlAndResolveDns('http://localhost/api'))
                .rejects.toThrow('Requests to localhost are blocked by default');
        });

        it('allows localhost when env var is set', async () => {
            process.env.MCP_CURL_ALLOW_LOCALHOST = 'true';
            const result = await validateUrlAndResolveDns('http://localhost:8080/api');
            // localhost can resolve to either IPv4 (127.0.0.1) or IPv6 (::1) depending on system config
            expect(['127.0.0.1', '::1']).toContain(result.resolvedIp);
        });

        it('blocks localhost on privileged ports even when allowed', async () => {
            process.env.MCP_CURL_ALLOW_LOCALHOST = 'true';
            await expect(validateUrlAndResolveDns('http://localhost:22/api'))
                .rejects.toThrow('Port 22 is not allowed');
        });
    });
});

describe('isLocalhostAllowed', () => {
    const originalEnv = process.env.MCP_CURL_ALLOW_LOCALHOST;

    beforeEach(() => {
        delete process.env.MCP_CURL_ALLOW_LOCALHOST;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.MCP_CURL_ALLOW_LOCALHOST = originalEnv;
        } else {
            delete process.env.MCP_CURL_ALLOW_LOCALHOST;
        }
    });

    it('returns false by default', () => {
        expect(isLocalhostAllowed()).toBe(false);
    });

    it('returns true for "true"', () => {
        process.env.MCP_CURL_ALLOW_LOCALHOST = 'true';
        expect(isLocalhostAllowed()).toBe(true);
    });

    it('returns true for "1"', () => {
        process.env.MCP_CURL_ALLOW_LOCALHOST = '1';
        expect(isLocalhostAllowed()).toBe(true);
    });

    it('returns true for "yes"', () => {
        process.env.MCP_CURL_ALLOW_LOCALHOST = 'yes';
        expect(isLocalhostAllowed()).toBe(true);
    });

    it('returns false for other values', () => {
        process.env.MCP_CURL_ALLOW_LOCALHOST = 'false';
        expect(isLocalhostAllowed()).toBe(false);
    });
});
