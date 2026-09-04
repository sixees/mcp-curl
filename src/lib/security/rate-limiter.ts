// src/lib/security/rate-limiter.ts
// Rate limiting with fixed time windows and periodic cleanup

import { RATE_LIMIT } from "../config/session.js";
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
 * Elapsed-time source for rate-limit windows.
 *
 * **Monotonic, not wall-clock, and the distinction is load-bearing.**
 * `Date.now()` moves backwards on an NTP correction, a VM resume or a snapshot
 * restore, and a window measured against it then fails in both directions at
 * once: an entry stamped in the future never expires, wedging the tracking cap
 * against every new key, while reading that same negative age as expiry hands
 * every caller already at its quota a fresh one. Neither arm of that trade is
 * safe, so the clock is the thing to fix rather than the comparison. Nothing
 * here wants a calendar — `windowStart` is only ever subtracted from a later
 * reading of the same clock.
 */
function elapsedNow(): number {
    return performance.now();
}

/**
 * Whether an entry's window has closed.
 */
function windowClosed(entry: RateLimitEntry, now: number): boolean {
    return now - entry.windowStart >= RATE_LIMIT.WINDOW_MS;
}

/**
 * Clean up expired entries from a rate limit map.
 */
function cleanupExpiredEntries(map: Map<string, RateLimitEntry>): void {
    const now = elapsedNow();
    for (const [key, entry] of map) {
        if (windowClosed(entry, now)) {
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
    errorPrefix: string,
    keyKind: "host" | "client"
): void {
    const now = elapsedNow();
    const entry = map.get(key);

    if (!entry || windowClosed(entry, now)) {
        // Only a key we are not already tracking can grow the map, and nothing
        // guarantees the cleanup interval is running: it is started by the
        // three process mains, and an embedder reaching here through the
        // exported `registerEndpointTools` or `executeCurlRequest` starts none
        // of them.
        //
        // This REJECTS where `bounded-throttle.ts::setBounded` evicts — that
        // file owns why a counter may not be evicted. Refusing a key we cannot
        // track fails closed: a request that cannot be counted is not admitted
        // uncounted.
        if (!entry && map.size >= RATE_LIMIT.MAX_TRACKED_KEYS) {
            cleanupExpiredEntries(map);
            if (map.size >= RATE_LIMIT.MAX_TRACKED_KEYS) {
                // Not the caller's quota, so not the caller's error message.
                throw new Error(
                    `Rate-limit tracking is at capacity (${RATE_LIMIT.MAX_TRACKED_KEYS} distinct keys). Refusing an untracked ${keyKind}.`
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
    // **Client gate first, and the order is load-bearing.** Whichever map is
    // checked first takes a key for requests the other gate goes on to reject,
    // because the write happens before either throw. Hostnames are model-chosen
    // and unbounded in cardinality, so the host map is the one that must not
    // grow on rejected requests.
    //
    // The mirror is accepted, not overlooked: a request the HOST gate rejects
    // has already taken a client key. Client ids are server-generated and
    // bounded by SESSION.MAX_SESSIONS, so that space cannot be driven the same way.
    checkRateLimitInternal(
        clientRateLimitMap,
        clientId,
        RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE,
        "Client rate limit exceeded",
        "client"
    );

    checkRateLimitInternal(
        hostRateLimitMap,
        hostname,
        RATE_LIMIT.MAX_PER_HOST_PER_MINUTE,
        `Rate limit exceeded for host "${hostname}"`,
        "host"
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
