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
 * Clear all rate limit maps (for testing purposes).
 */
export declare function clearRateLimitMaps(): void;
