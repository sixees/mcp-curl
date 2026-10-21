// src/lib/security/rate-limiter.ts
// Rate limiting with fixed time windows, an optional per-host sliding log, and periodic cleanup

import { RATE_LIMIT } from "../config/session.js";
import type { HostRateLimit, RateLimitEntry } from "../types/index.js";
import { assertPositiveInteger } from "../utils/index.js";

/**
 * Rate limiting with fixed time windows and periodic cleanup.
 *
 * Two separate limits are enforced:
 * 1. Per-hostname: Protects individual target servers from being hammered
 * 2. Per-client: Prevents a single client from making too many requests overall
 *
 * Without per-client limits, an attacker could bypass per-hostname limits by
 * spreading requests across many different hostnames.
 *
 * The per-host gate is a fixed 60/min window by default. An embedder's
 * `rateLimit` (installed through {@link installHostRateLimit}) replaces it with a
 * sliding log of timestamps. A long fixed window cannot serve that case: the
 * 10 s sweep deletes any entry whose window has closed, and a fixed window
 * admits `2 × max` across its boundary — a burst the upstream quota it is meant
 * to sit under would refuse. The client gate is never configurable.
 */

// Private maps for hostname and client rate limiting (encapsulated state)
const hostRateLimitMap = new Map<string, RateLimitEntry>();
const clientRateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Admission timestamps per host, oldest first, used only while a host limit is
 * configured. Each log holds at most `max` entries, because a request is
 * refused before it is recorded once the log is full.
 */
const hostSlidingLog = new Map<string, number[]>();

/** The configured per-host limit; `undefined` selects the fixed default. */
let hostLimit: HostRateLimit | undefined;

/** Returned by {@link installHostRateLimit}; only its holder can release the limit. */
export type HostRateLimitHandle = symbol;

/** The handle of whoever installed `hostLimit`. */
let hostLimitOwner: HostRateLimitHandle | undefined;

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
    return leftWindow(entry.windowStart, now, RATE_LIMIT.WINDOW_MS);
}

/**
 * Whether a timestamp has left a window. The request check and the sweep both
 * ask this, so they cannot disagree about the boundary: a sweep that deleted
 * what the check still counted would admit more than `max` in one window.
 */
function leftWindow(timestamp: number, now: number, windowMs: number): boolean {
    return now - timestamp >= windowMs;
}

/**
 * Drop timestamps that have left the window. The log is oldest first, so the
 * expired ones are a prefix.
 */
function pruneLog(log: number[], now: number, windowMs: number): void {
    let expired = 0;
    while (expired < log.length && leftWindow(log[expired], now, windowMs)) expired++;
    if (expired > 0) log.splice(0, expired);
}

/**
 * Delete sliding logs whose newest timestamp has left the window.
 */
function cleanupExpiredLogs(): void {
    if (!hostLimit) {
        hostSlidingLog.clear();
        return;
    }
    const now = elapsedNow();
    for (const [key, log] of hostSlidingLog) {
        if (log.length === 0 || leftWindow(log[log.length - 1], now, hostLimit.windowMs)) {
            hostSlidingLog.delete(key);
        }
    }
}

/**
 * Refuse a key the map cannot track. Called only for a key not already in it.
 *
 * Only a key we are not already tracking can grow the map, and nothing
 * guarantees the cleanup interval is running: it is started by the three
 * process mains, and an embedder reaching here through the exported
 * `registerEndpointTools` or `executeCurlRequest` starts none of them.
 *
 * This REJECTS where `bounded-throttle.ts::setBounded` evicts — that file owns
 * why a counter may not be evicted. Refusing a key we cannot track fails
 * closed: a request that cannot be counted is not admitted uncounted.
 */
function ensureCapacity(map: Map<string, unknown>, sweep: () => void, keyKind: "host" | "client"): void {
    if (map.size < RATE_LIMIT.MAX_TRACKED_KEYS) return;
    sweep();
    if (map.size >= RATE_LIMIT.MAX_TRACKED_KEYS) {
        // Not the caller's quota, so not the caller's error message.
        throw new Error(
            `Rate-limit tracking is at capacity (${RATE_LIMIT.MAX_TRACKED_KEYS} distinct keys). Refusing an untracked ${keyKind}.`
        );
    }
}

/** Whole seconds when exact, otherwise milliseconds. */
function formatWindow(ms: number): string {
    return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
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
        if (!entry) ensureCapacity(map, () => cleanupExpiredEntries(map), keyKind);
        map.set(key, { count: 1, windowStart: now });
        return;
    }

    if (entry.count >= maxRequests) {
        throw new Error(`${errorPrefix}. Maximum ${maxRequests} requests per minute.`);
    }

    entry.count++;
}

/**
 * Per-host check against the configured sliding window.
 */
function checkSlidingHostLimit(hostname: string, limit: HostRateLimit, errorPrefix: string): void {
    const now = elapsedNow();
    let log = hostSlidingLog.get(hostname);

    if (log) {
        pruneLog(log, now, limit.windowMs);
    } else {
        ensureCapacity(hostSlidingLog, cleanupExpiredLogs, "host");
        log = [];
        hostSlidingLog.set(hostname, log);
    }

    if (log.length >= limit.max) {
        const retryMs = limit.windowMs - (now - log[0]);
        throw new Error(
            `${errorPrefix}. Maximum ${limit.max} requests per ${formatWindow(limit.windowMs)}; ` +
            `the oldest leaves the window in ${Math.ceil(retryMs / 1000)} s.`
        );
    }

    log.push(now);
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

    const hostPrefix = `Rate limit exceeded for host "${hostname}"`;
    if (hostLimit) {
        checkSlidingHostLimit(hostname, hostLimit, hostPrefix);
        return;
    }
    checkRateLimitInternal(
        hostRateLimitMap,
        hostname,
        RATE_LIMIT.MAX_PER_HOST_PER_MINUTE,
        hostPrefix,
        "host"
    );
}

/**
 * Reject a limit that is not `{ max, windowMs }` with both positive integers.
 * There is no "off" value, so a typo or an unset variable (`Number(undefined)`
 * is `NaN`, and `length >= NaN` is always false) cannot disable the limit.
 */
export function assertHostRateLimit(limit: unknown): asserts limit is HostRateLimit {
    if (typeof limit !== "object" || limit === null) {
        throw new Error(`rateLimit must be an object { max, windowMs }, got: ${String(limit)}`);
    }
    const { max, windowMs } = limit as Record<string, unknown>;
    assertPositiveInteger("rateLimit.max", max);
    assertPositiveInteger("rateLimit.windowMs", windowMs);
}

/**
 * Install the per-host limit for the whole process, and return the handle
 * that releases it.
 *
 * **Process-global, like the maps.** Every caller of `checkRateLimits` —
 * `curl_execute`, `utilities().executeRequest`, YAML endpoint tools — is
 * counted against it with nothing threaded through, including a second server
 * in the process that set no `rateLimit` of its own.
 *
 * **First holder wins; a second install throws** rather than replacing it.
 * Replacing would silently loosen or reset a limit another server is relying
 * on — the failure this limit exists to prevent. The limit is validated and
 * copied here, so no caller can install `NaN` or change it afterwards.
 *
 * Sliding logs start empty: a log recorded under one window says nothing
 * about another.
 */
export function installHostRateLimit(limit: HostRateLimit): HostRateLimitHandle {
    assertHostRateLimit(limit);
    if (hostLimitOwner !== undefined) {
        throw new Error(
            "rateLimit is already installed by another McpCurlServer in this process. " +
            "The per-host limit is process-wide, so only one server may set it at a time."
        );
    }
    hostLimit = { max: limit.max, windowMs: limit.windowMs };
    hostLimitOwner = Symbol("hostRateLimit");
    hostSlidingLog.clear();
    return hostLimitOwner;
}

/**
 * Restore the fixed 60/min default, if `handle` still holds the limit. Any
 * other handle is a no-op, so one server's shutdown or failed start cannot
 * reset a limit another server installed, and releasing twice is harmless.
 */
export function releaseHostRateLimit(handle: HostRateLimitHandle): void {
    if (handle !== hostLimitOwner) return;
    hostLimit = undefined;
    hostLimitOwner = undefined;
    hostSlidingLog.clear();
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
        cleanupExpiredLogs();
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
 * Clear all rate limit maps, and drop an installed host limit whoever holds it.
 *
 * **WARNING: For testing purposes only.** Do not call in production code.
 * This bypasses rate limiting protections and should only be used in test
 * suites to reset state between test cases.
 *
 * @internal
 */
export function clearRateLimitMaps(): void {
    hostLimit = undefined;
    hostLimitOwner = undefined;
    hostRateLimitMap.clear();
    clientRateLimitMap.clear();
    hostSlidingLog.clear();
}

/**
 * Test-only: tracked-key counts, so a test can assert the caps hold.
 *
 * @internal
 */
export function rateLimitMapSizes(): { hosts: number; clients: number; slidingHosts: number } {
    return { hosts: hostRateLimitMap.size, clients: clientRateLimitMap.size, slidingHosts: hostSlidingLog.size };
}
