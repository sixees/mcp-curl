// src/lib/types/rate-limit.ts

/**
 * Rate limit tracking entry for a single hostname or client.
 */
export interface RateLimitEntry {
    count: number;
    windowStart: number;
}
