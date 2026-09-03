// src/lib/security/rate-limiter.ts
// Rate limiting with fixed time windows and periodic cleanup

import { RATE_LIMIT, THROTTLE } from "../config/session.js";
import type { RateLimitEntry } from "../types/index.js";

/**
 * Rate limiting with fixed time windows and periodic cleanup.
 *
 * Two separate limits are enforced:
 * 1. Per-hostname: Protects individual target servers from being hammered
 * 2. Per-client: Prevents a single client from making too many requests overall
 *
 * Without per-client limits, an attacker could bypass per-hostname limits by
 * spreading requests across many different hostnames.
 */

// Private maps for hostname and client rate limiting (encapsulated state)
const hostRateLimitMap = new Map<string, RateLimitEntry>();
const clientRateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries from a rate limit map.
 */
function cleanupExpiredEntries(map: Map<string, RateLimitEntry>): void {
    const now = Date.now();
    for (const [key, entry] of map) {
        if ((now - entry.windowStart) >= RATE_LIMIT.WINDOW_MS) {
            map.delete(key);
        }
    }
}

/**
 * Internal rate limit check for a single map.
 */
function checkRateLimitInternal(
    map: Map<string, RateLimitEntry>,
    key: string,
    maxRequests: number,
    errorPrefix: string
): void {
    const now = Date.now();
    const entry = map.get(key);

    // Start new window if none exists or current window expired
    if (!entry || (now - entry.windowStart) >= RATE_LIMIT.WINDOW_MS) {
        // Only a key not already tracked can grow the map, and the cleanup
        // interval is started by the three process mains alone — an embedder
        // reaching here through the exported `registerEndpointTools` or
        // `executeCurlRequest` starts none of them, so without this the map
        // grows one entry per distinct hostname for the life of the process.
        //
        // **This rejects where `security/bounded-throttle.ts` evicts, and the
        // difference is the whole reason it is not that helper.** Evicting a
        // counter resets it, which is a bypass of the very limit this function
        // exists to enforce. Refusing a key we cannot track fails closed:
        // a request that cannot be counted is not admitted uncounted.
        // `SessionManager.set` is this same policy for sessions.
        if (!map.has(key) && map.size >= THROTTLE.MAX_TRACKED_KEYS) {
            cleanupExpiredEntries(map);
            if (map.size >= THROTTLE.MAX_TRACKED_KEYS) {
                throw new Error(
                    `${errorPrefix}. Tracking ${THROTTLE.MAX_TRACKED_KEYS} distinct keys already; refusing an untracked one.`
                );
            }
        }
        map.set(key, { count: 1, windowStart: now });
        return;
    }

    if (entry.count >= maxRequests) {
        throw new Error(`${errorPrefix}. Maximum ${maxRequests} requests per minute.`);
    }

    entry.count++;
}

/**
 * Check both per-hostname and per-client rate limits.
 *
 * @param hostname - Target hostname (for per-host limit)
 * @param clientId - Client identifier (session ID for HTTP, default for stdio)
 * @throws Error if either rate limit is exceeded
 */
export function checkRateLimits(hostname: string, clientId: string = RATE_LIMIT.STDIO_CLIENT_ID): void {
    // **Client limit first, and the order is load-bearing.** `checkRateLimitInternal`
    // writes its entry before it can throw, so checking the host first meant every
    // request that was about to be rejected for exceeding the client quota still
    // inserted a host entry — putting the growth upstream of the only thing that
    // bounds it. Rejecting at the client gate first means an over-quota caller
    // adds no host keys at all, and the host counter now counts requests that
    // were actually admitted rather than every one that was attempted.
    checkRateLimitInternal(
        clientRateLimitMap,
        clientId,
        RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE,
        "Client rate limit exceeded"
    );

    // Then the per-hostname limit, which protects the target server.
    checkRateLimitInternal(
        hostRateLimitMap,
        hostname,
        RATE_LIMIT.MAX_PER_HOST_PER_MINUTE,
        `Rate limit exceeded for host "${hostname}"`
    );
}

/**
 * Start the rate limit cleanup interval.
 * Cleans up expired entries to prevent memory growth.
 *
 * @returns The interval handle (call stopRateLimitCleanup to clear)
 */
export function startRateLimitCleanup(): NodeJS.Timeout {
    const interval = setInterval(() => {
        cleanupExpiredEntries(hostRateLimitMap);
        cleanupExpiredEntries(clientRateLimitMap);
    }, RATE_LIMIT.CLEANUP_INTERVAL_MS);

    // Prevent interval from keeping process alive during shutdown
    interval.unref();

    return interval;
}

/**
 * Stop the rate limit cleanup interval.
 */
export function stopRateLimitCleanup(interval: NodeJS.Timeout): void {
    clearInterval(interval);
}

/**
 * Clear all rate limit maps.
 *
 * **WARNING: For testing purposes only.** Do not call in production code.
 * This bypasses rate limiting protections and should only be used in test
 * suites to reset state between test cases.
 *
 * @internal
 */
export function clearRateLimitMaps(): void {
    hostRateLimitMap.clear();
    clientRateLimitMap.clear();
}

/**
 * Test-only: tracked-key counts, so a test can assert the caps hold.
 *
 * @internal
 */
export function rateLimitMapSizes(): { hosts: number; clients: number } {
    return { hosts: hostRateLimitMap.size, clients: clientRateLimitMap.size };
}
