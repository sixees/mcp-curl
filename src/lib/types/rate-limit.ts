// src/lib/types/rate-limit.ts

/**
 * Rate limit tracking entry for a single hostname or client.
 * Uses a fixed time window approach - count resets when windowStart expires.
 */
export interface RateLimitEntry {
    /** Number of requests made within the current window */
    count: number;
    /** Unix timestamp (ms) when the current rate limit window started */
    windowStart: number;
}
