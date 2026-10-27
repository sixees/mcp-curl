import { describe, it, expect } from 'vitest';
import {
    ANY_HOST_POLICY,
    canonicalHost,
    deriveHostPolicy,
    isHostAllowed,
    parseAllowedHosts,
} from './host-policy.js';
import { resolveRequestUrl } from '../../utils/url.js';

const list = (...hosts: string[]) => deriveHostPolicy({ allowedHosts: hosts });

describe('canonicalHost', () => {
    it('strips every trailing dot, the key the rate limiter has always used', () => {
        expect(canonicalHost('api.test.')).toBe('api.test');
        expect(canonicalHost('api.test..')).toBe('api.test');
        expect(canonicalHost('api.test')).toBe('api.test');
    });
});

describe('isHostAllowed', () => {
    it('matches case-insensitively', () => {
        expect(isHostAllowed(list('api.test'), 'API.Test')).toBe(true);
        expect(isHostAllowed(list('API.TEST'), 'api.test')).toBe(true);
    });

    it('treats a trailing dot as the same host, on either side', () => {
        expect(isHostAllowed(list('api.test'), 'api.test.')).toBe(true);
        expect(isHostAllowed(list('api.test.'), 'api.test')).toBe(true);
    });

    it('matches exactly: no subdomain, parent or suffix match', () => {
        const policy = list('api.test');
        expect(isHostAllowed(policy, 'x.api.test')).toBe(false);
        expect(isHostAllowed(policy, 'test')).toBe(false);
        expect(isHostAllowed(policy, 'evilapi.test')).toBe(false);
    });

    it('refuses every host for an empty list', () => {
        const policy = deriveHostPolicy({ allowedHosts: [] });
        expect(isHostAllowed(policy, 'api.test')).toBe(false);
        expect(isHostAllowed(policy, '')).toBe(false);
    });

    it('allows every host for "any"', () => {
        expect(isHostAllowed(ANY_HOST_POLICY, 'anything.test')).toBe(true);
        expect(deriveHostPolicy({ allowedHosts: 'any' })).toBe(ANY_HOST_POLICY);
    });

    it('canonicalises an IP-literal entry the way a request URL is parsed', () => {
        const policy = list('2130706433');
        expect(isHostAllowed(policy, new URL('http://127.0.0.1/').hostname)).toBe(true);
        expect(isHostAllowed(list('127.0.0.1'), new URL('http://2130706433/').hostname)).toBe(true);
    });

    it('matches a bracketed IPv6 entry against URL.hostname', () => {
        expect(isHostAllowed(list('[::1]'), new URL('http://[0:0::1]/').hostname)).toBe(true);
    });
});

describe('parseAllowedHosts', () => {
    it('returns a frozen canonical copy', () => {
        const parsed = parseAllowedHosts(['API.test.', '2130706433']);
        expect(parsed).toEqual(['api.test', '127.0.0.1']);
        expect(Object.isFrozen(parsed)).toBe(true);
    });

    it.each([
        ['a scheme', 'https://api.test'],
        ['a port', 'api.test:8080'],
        ['a bare colon', 'api.test:'],
        ['a path', 'api.test/v1'],
        ['a backslash', 'api.test\\v1'],
        ['userinfo', 'user:pass@api.test'],
        ['a wildcard', '*.api.test'],
        ['a query', 'api.test?x'],
        ['a fragment', 'api.test#x'],
        ['whitespace', 'api .test'],
        ['an empty string', ''],
        ['an empty label', 'api..test'],
        ['a leading dot', '.api.test'],
        ['only dots', '...'],
        ['an unparseable host', 'exa%mple.com'],
    ])('rejects %s', (_label, entry) => {
        expect(() => parseAllowedHosts([entry])).toThrow(/allowedHosts\[0\]/);
    });

    it('never echoes the refused entry', () => {
        expect(() => parseAllowedHosts(['user:s3cret@api.test'])).toThrow(
            expect.objectContaining({ message: expect.not.stringContaining('s3cret') })
        );
    });

    it.each([
        ['a non-string entry', [42]],
        ['a string other than "any"', 'api.test'],
        ['an object', { hosts: [] }],
        ['null', null],
    ])('rejects %s', (_label, value) => {
        expect(() => parseAllowedHosts(value)).toThrow(/allowedHosts/);
    });
});

describe('deriveHostPolicy', () => {
    it('defaults to the baseUrl host when allowedHosts is unset', () => {
        const policy = deriveHostPolicy({ baseUrl: 'https://API.test:8443/v1' });
        expect(isHostAllowed(policy, 'api.test')).toBe(true);
        expect(isHostAllowed(policy, 'other.test')).toBe(false);
    });

    it('allows any host with neither baseUrl nor allowedHosts', () => {
        expect(deriveHostPolicy({})).toBe(ANY_HOST_POLICY);
    });

    it('lets an explicit allowedHosts win over the baseUrl default', () => {
        const policy = deriveHostPolicy({ baseUrl: 'https://api.test', allowedHosts: ['other.test'] });
        expect(isHostAllowed(policy, 'other.test')).toBe(true);
        expect(isHostAllowed(policy, 'api.test')).toBe(false);
    });

    it.each([
        ['an unparseable baseUrl', 'not a url'],
        ['a non-http(s) baseUrl', 'ftp://api.test'],
    ])('throws for %s with allowedHosts unset, without echoing it', (_label, baseUrl) => {
        expect(() => deriveHostPolicy({ baseUrl })).toThrow(
            expect.objectContaining({
                message: expect.stringMatching(/^baseUrl is not an absolute http\(s\) URL/),
            })
        );
        expect(() => deriveHostPolicy({ baseUrl })).toThrow(
            expect.objectContaining({ message: expect.not.stringContaining(baseUrl) })
        );
    });

    it('does not read a bad baseUrl when allowedHosts is "any"', () => {
        expect(deriveHostPolicy({ baseUrl: 'not a url', allowedHosts: 'any' })).toBe(ANY_HOST_POLICY);
    });

    // start() and the request path answer "is this baseUrl usable" the same way.
    it.each([
        'https://api.test',
        'http://API.test:8080/v1/',
        'https://api.test./',
        'http://./',
        'not a url',
        'ftp://api.test',
        'file:///etc',
        'mailto:a@b.test',
        'https://[::1]/',
    ])('throws exactly when resolveRequestUrl refuses %s', (baseUrl) => {
        let threw = false;
        try {
            deriveHostPolicy({ baseUrl });
        } catch {
            threw = true;
        }
        expect(threw).toBe(!resolveRequestUrl(baseUrl, '/x').ok);
    });
});
