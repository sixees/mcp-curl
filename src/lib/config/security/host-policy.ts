// src/lib/config/security/host-policy.ts
// Which hosts a server may send a request to: the allowedHosts list, its default, and the match

/**
 * The hosts a request may go to. `"any"` is the explicit opt-out; a list is
 * matched exactly after {@link canonicalHost}, and an empty list refuses every
 * request.
 */
export type HostPolicy =
    | { readonly kind: "any" }
    | { readonly kind: "list"; readonly hosts: ReadonlySet<string> };

/** The `"any"` policy: every host passes this check (the SSRF gate still runs). */
export const ANY_HOST_POLICY: HostPolicy = Object.freeze({ kind: "any" });

/**
 * The key a host is compared and counted under. A trailing dot names the same
 * DNS host (`api.example.com.` is the fully-qualified spelling of
 * `api.example.com`), and the URL parser keeps it, so without this a trailing
 * dot would buy a second rate-limit budget, and the host list would refuse a
 * listed host spelled with one. Every trailing dot goes, not just one, so the
 * host list and `checkRateLimits` share one key. A loop rather than a regex:
 * the hostname is model-chosen.
 */
export function canonicalHost(hostname: string): string {
    let end = hostname.length;
    while (end > 0 && hostname[end - 1] === ".") end--;
    return hostname.slice(0, end);
}

/**
 * Characters that make an entry something other than a bare host: a scheme or
 * path (`/`, `\`), userinfo (`@`), a query or fragment, a wildcard, or
 * whitespace. A `:` is allowed only inside a bracketed IPv6 literal, so a port
 * is refused.
 */
const NON_HOST_CHARACTERS = /[/\\@?#*\s]/;
const BRACKETED_IPV6 = /^\[[^\]]*\]$/;

/**
 * Read `allowedHosts` once and return a frozen copy in canonical form, or
 * `"any"`. Each entry goes through the same WHATWG parser that request URLs
 * do, so `API.Example.com`, `2130706433` and `[::1]` compare equal to what a
 * request names. The error names the entry's index, never its value: an entry
 * refused for carrying `@` may hold a credential.
 */
export function parseAllowedHosts(value: unknown): readonly string[] | "any" {
    if (value === "any") return "any";
    if (!Array.isArray(value)) {
        throw new Error('allowedHosts must be an array of host names or the string "any"');
    }
    const hosts = value.map((entry: unknown, index) => {
        const refuse = (why: string) =>
            new Error(`allowedHosts[${index}] ${why}; give a bare host name such as api.example.com`);
        if (typeof entry !== "string") throw refuse("is not a string");
        if (entry === "" || NON_HOST_CHARACTERS.test(entry)) {
            throw refuse("is not a bare host name (no scheme, port, path, userinfo or wildcard)");
        }
        if (entry.includes(":") && !BRACKETED_IPV6.test(entry)) {
            throw refuse("carries a port or scheme");
        }
        let hostname: string;
        try {
            hostname = new URL(`http://${entry}`).hostname;
        } catch {
            throw refuse("does not parse as a host name");
        }
        const canonical = canonicalHost(hostname);
        if (canonical === "" || canonical.split(".").includes("")) {
            throw refuse("has an empty label");
        }
        return canonical;
    });
    return Object.freeze(hosts);
}

/**
 * The policy a server enforces. An explicit `allowedHosts` wins; left unset,
 * a server with a `baseUrl` may reach only that host, and one without a
 * `baseUrl` may reach any host. A `baseUrl` that cannot give a host throws
 * rather than yielding an empty or open list. The message does not echo the
 * `baseUrl`, which may carry credentials.
 */
export function deriveHostPolicy(config: {
    readonly baseUrl?: string;
    readonly allowedHosts?: readonly string[] | "any";
}): HostPolicy {
    if (config.allowedHosts !== undefined) {
        const parsed = parseAllowedHosts(config.allowedHosts);
        if (parsed === "any") return ANY_HOST_POLICY;
        return Object.freeze({ kind: "list" as const, hosts: new Set(parsed) });
    }
    if (config.baseUrl === undefined) return ANY_HOST_POLICY;
    let host = "";
    try {
        const base = new URL(config.baseUrl);
        if (base.protocol === "http:" || base.protocol === "https:") host = canonicalHost(base.hostname);
    } catch {
        // Falls through to the refusal below.
    }
    if (host === "") {
        throw new Error(
            "baseUrl is not an absolute http(s) URL, so the default allowedHosts cannot be derived from it; " +
                'fix baseUrl or set allowedHosts explicitly ("any" allows every host)'
        );
    }
    return Object.freeze({ kind: "list" as const, hosts: new Set([host]) });
}

/** Whether `policy` lets a request go to `hostname`, compared in canonical form. */
export function isHostAllowed(policy: HostPolicy, hostname: string): boolean {
    if (policy.kind === "any") return true;
    return policy.hosts.has(canonicalHost(hostname.toLowerCase()));
}
