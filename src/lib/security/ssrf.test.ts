import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateUrlAndResolveDns, isLocalhostAllowed } from './ssrf.js';
import {
    isBlockedHostname,
    isBlockedIp,
    isLocalhostIp,
    normalizeIpv4MappedIpv6,
} from '../config/security/ssrf.js';

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

describe('IPv4-mapped IPv6 normalization', () => {
    describe('normalizeIpv4MappedIpv6', () => {
        // Each hex pair encodes 16 bits of the IPv4 address:
        //   high → first two octets, low → last two octets.
        //   7f00:0001 → 127.0.0.1, 0a00:0001 → 10.0.0.1, c0a8:0101 → 192.168.1.1.
        it.each([
            ['::ffff:7f00:1', '127.0.0.1'],
            ['::ffff:7f00:0001', '127.0.0.1'],
            ['::ffff:a00:1', '10.0.0.1'],
            ['::ffff:c0a8:101', '192.168.1.1'],
            ['::ffff:c0a8:0', '192.168.0.0'],
            ['::ffff:a9fe:a9fe', '169.254.169.254'], // EC2/GCP metadata IP
            ['[::ffff:7f00:1]', '127.0.0.1'],        // bracketed (URL-style)
            ['[::FFFF:7F00:1]', '127.0.0.1'],        // case-insensitive
            ['::ffff:0:0', '0.0.0.0'],
        ])('rewrites %s to %s', (input, expected) => {
            expect(normalizeIpv4MappedIpv6(input)).toBe(expected);
        });

        it('returns the input unchanged when not a mapped IPv6 address', () => {
            expect(normalizeIpv4MappedIpv6('example.com')).toBe('example.com');
            expect(normalizeIpv4MappedIpv6('127.0.0.1')).toBe('127.0.0.1');
            expect(normalizeIpv4MappedIpv6('::1')).toBe('::1');
            expect(normalizeIpv4MappedIpv6('fe80::1')).toBe('fe80::1');
        });

        it('does not match the dotted-quad mapped form (handled by existing patterns)', () => {
            expect(normalizeIpv4MappedIpv6('::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
        });
    });

    describe('isBlockedHostname catches compressed-hex IPv4-mapped IPv6', () => {
        it.each([
            ['127.x loopback', '::ffff:7f00:1'],
            ['127.x loopback bracketed', '[::ffff:7f00:1]'],
            ['10.x private', '::ffff:a00:1'],
            ['172.16.x private', '::ffff:ac10:1'],
            ['172.31.x private (high boundary)', '::ffff:ac1f:fffe'],
            ['192.168.x private', '::ffff:c0a8:101'],
            ['169.254.x link-local', '::ffff:a9fe:a9fe'],
            ['0.0.0.0 all-interfaces', '::ffff:0:0'],
        ])('blocks %s (%s)', (_label, host) => {
            expect(isBlockedHostname(host)).toBe(true);
        });

        it('does not block public IPv4-mapped IPv6 (e.g. 8.8.8.8 → ::ffff:0808:0808)', () => {
            expect(isBlockedHostname('::ffff:808:808')).toBe(false);
        });
    });

    describe('isBlockedIp catches compressed-hex IPv4-mapped IPv6', () => {
        it.each([
            ['127.x loopback', '::ffff:7f00:1'],
            ['10.x private', '::ffff:a00:1'],
            ['172.16.x private', '::ffff:ac10:1'],
            ['192.168.x private', '::ffff:c0a8:101'],
            ['169.254.x link-local', '::ffff:a9fe:a9fe'],
            ['0.0.0.0 all-interfaces', '::ffff:0:0'],
        ])('blocks %s (%s)', (_label, ip) => {
            expect(isBlockedIp(ip)).toBe(true);
        });

        it('does not block public IPv4-mapped IPv6', () => {
            expect(isBlockedIp('::ffff:808:808')).toBe(false);
        });

        it('still blocks pure-IPv6 ranges (fc00::/7, fe80::, ::1) without normalisation', () => {
            expect(isBlockedIp('::1')).toBe(true);
            expect(isBlockedIp('fe80::1')).toBe(true);
            expect(isBlockedIp('fc00::1')).toBe(true);
            expect(isBlockedIp('fd12:3456::1')).toBe(true);
        });
    });

    describe('isLocalhostIp catches compressed-hex 127.x', () => {
        it.each([
            '::ffff:7f00:1',
            '::ffff:7f00:0001',
            '::ffff:7fff:fffe',
        ])('matches %s as localhost', (ip) => {
            expect(isLocalhostIp(ip)).toBe(true);
        });

        it('does not match non-loopback mapped IPv6 as localhost', () => {
            expect(isLocalhostIp('::ffff:a00:1')).toBe(false);  // 10.0.0.1
            expect(isLocalhostIp('::ffff:c0a8:101')).toBe(false); // 192.168.1.1
        });
    });
});
