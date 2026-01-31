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
    // Check per-hostname limit first (protects target servers)
    checkRateLimitInternal(
        hostRateLimitMap,
        hostname,
        RATE_LIMIT.MAX_PER_HOST_PER_MINUTE,
        `Rate limit exceeded for host "${hostname}"`
    );

    // Check per-client limit (prevents overall abuse)
    checkRateLimitInternal(
        clientRateLimitMap,
        clientId,
        RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE,
        "Client rate limit exceeded"
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
