// src/lib/types/rate-limit.ts

/**
 * Rate limit tracking entry for a single hostname or client.
 * Uses a fixed time window approach - count resets when windowStart expires.
 */
export interface RateLimitEntry {
    /** Number of requests made within the current window */
    count: number;
    /**
     * When the current window started, on the **monotonic** clock
     * `rate-limiter.ts::elapsedNow` reads — milliseconds since process start,
     * not a Unix timestamp.
     *
     * **Never compare this with `Date.now()`.** The two clocks share a unit and
     * nothing else, and mixing them reproduces exactly the negative window ages
     * the monotonic source was adopted to remove: a window that never expires,
     * or one that hands a caller at its quota a fresh one.
     */
    windowStart: number;
}
