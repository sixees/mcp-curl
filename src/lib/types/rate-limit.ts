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

/**
 * An embedder-configured per-host limit: at most `max` requests to one host in
 * any `windowMs` span. Enforced as a sliding log, so it cannot be reset by the
 * fixed window's boundary or by the cleanup sweep.
 */
export interface HostRateLimit {
    /** Requests admitted per host in any one window (positive integer) */
    readonly max: number;
    /** Window length in milliseconds (positive integer) */
    readonly windowMs: number;
    /**
     * Tighten the per-host count from the upstream's own figure. `remaining`
     * names a response header carrying the requests the upstream will still
     * admit in its window; after each response, the host that answered is
     * counted as having used at least `quota − remaining`, capped at `max`. It
     * only ever tightens, and an absent, empty or malformed value changes
     * nothing.
     *
     * `quota` is the upstream's own limit for the window, and defaults to
     * `max`. Set it when `max` sits below the upstream's limit on purpose: the
     * upstream reports what is left of ITS quota, so measured against `max`
     * that figure would hand the margin back.
     *
     * The name must be an HTTP field name (RFC 9110 token) without `%`. Reading
     * the header needs cURL 7.84 or later.
     */
    readonly syncFromHeaders?: { readonly remaining: string; readonly quota?: number };
}
