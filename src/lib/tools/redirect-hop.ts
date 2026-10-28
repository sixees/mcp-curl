// src/lib/tools/redirect-hop.ts
// What a followed redirect does to the next request: the method table and the
// cross-origin header rule. Pure; `executeCurlRequest` runs the loop.

import type { CurlExecuteInput } from "../server/schemas.js";
import { canonicalHost } from "../config/index.js";
import { effectivePort } from "../utils/index.js";

/** The statuses whose `Location` is followed. Any other 3xx is returned as is. */
export const FOLLOWED_REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * The request headers a cross-origin hop keeps, lower-cased. An allow-list
 * rather than a deny-list of credential names, because the executor cannot
 * tell which headers came from `defaultHeaders`, YAML `auth.headers` or a hook,
 * and a custom name such as `X-Api-Key` is a credential no deny-list names.
 */
export const CROSS_ORIGIN_FORWARDED_HEADERS: ReadonlySet<string> = new Set([
    "accept",
    "accept-language",
    "accept-encoding",
    "user-agent",
]);

/** The headers that describe a body, and so go wherever the body goes. */
const BODY_HEADERS: ReadonlySet<string> = new Set(["content-type", "content-length"]);

/**
 * Whether two parsed URLs share scheme, host and effective port. Hosts compare
 * through `canonicalHost`, so trailing dots do not make a hop cross-origin;
 * case cannot either, because WHATWG lower-cases `hostname`.
 */
export function sameOrigin(a: URL, b: URL): boolean {
    return (
        a.protocol === b.protocol &&
        canonicalHost(a.hostname) === canonicalHost(b.hostname) &&
        effectivePort(a) === effectivePort(b)
    );
}

/** The method cURL sends for these params: `-X`, else POST when a body is set. */
function effectiveMethod(params: CurlExecuteInput): string {
    if (params.method) return params.method;
    return params.data !== undefined || params.form !== undefined ? "POST" : "GET";
}

/**
 * Whether a redirect with this status turns the request into a body-less GET
 * (RFC 9110 §15.4, as Fetch applies it): 303 for every method but HEAD, and
 * 301/302 for POST. 307 and 308 keep the method and the body.
 */
function dropsBody(status: number, method: string): boolean {
    if (status === 303) return method !== "HEAD";
    if (status === 301 || status === 302) return method === "POST";
    return false;
}

/**
 * The params for the hop a followed redirect leads to.
 *
 * `crossOrigin` is whether the next hop's origin differs from hop 1's. The
 * caller passes the previous hop's result as `params`, so credentials dropped
 * once stay dropped even when the chain comes back. A cross-origin hop keeps only
 * {@link CROSS_ORIGIN_FORWARDED_HEADERS}, the body headers when the body is
 * kept, and `user_agent`; `basic_auth` and `bearer_token` go.
 *
 * @param url - the next hop's parsed `href`, never the raw `Location`
 */
export function nextHopParams(
    params: CurlExecuteInput,
    status: number,
    crossOrigin: boolean,
    url: string
): CurlExecuteInput {
    const next: CurlExecuteInput = { ...params, url };
    const bodyDropped = dropsBody(status, effectiveMethod(params));
    if (bodyDropped) {
        next.method = undefined;
        next.data = undefined;
        next.form = undefined;
    }
    if (params.headers) {
        const kept = Object.entries(params.headers).filter(([name]) => {
            const key = name.toLowerCase();
            if (BODY_HEADERS.has(key)) return !bodyDropped;
            return !crossOrigin || CROSS_ORIGIN_FORWARDED_HEADERS.has(key);
        });
        next.headers = Object.fromEntries(kept);
    }
    if (crossOrigin) {
        next.basic_auth = undefined;
        next.bearer_token = undefined;
    }
    return next;
}
