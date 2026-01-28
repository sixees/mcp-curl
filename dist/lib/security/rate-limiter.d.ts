/**
 * Check both per-hostname and per-client rate limits.
 *
 * @param hostname - Target hostname (for per-host limit)
 * @param clientId - Client identifier (session ID for HTTP, default for stdio)
 * @throws Error if either rate limit is exceeded
 */
export declare function checkRateLimits(hostname: string, clientId?: string): void;
/**
 * Start the rate limit cleanup interval.
 * Cleans up expired entries to prevent memory growth.
 *
 * @returns The interval handle (call stopRateLimitCleanup to clear)
 */
export declare function startRateLimitCleanup(): NodeJS.Timeout;
/**
 * Stop the rate limit cleanup interval.
 */
export declare function stopRateLimitCleanup(interval: NodeJS.Timeout): void;
/**
 * Clear all rate limit maps.
 *
 * **WARNING: For testing purposes only.** Do not call in production code.
 * This bypasses rate limiting protections and should only be used in test
 * suites to reset state between test cases.
 *
 * @internal
 */
export declare function clearRateLimitMaps(): void;
