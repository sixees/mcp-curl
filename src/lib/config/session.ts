// src/lib/config/session.ts
// Session management, rate limiting, throttle bounds, and temp directory constants

export const SESSION = {
    /** Maximum concurrent HTTP sessions */
    MAX_SESSIONS: 100,
    /** Session idle timeout (1 hour) */
    IDLE_TIMEOUT_MS: 3_600_000,
    /** Interval for cleaning up idle sessions (5 minutes) */
    CLEANUP_INTERVAL_MS: 300_000,
} as const;

const RATE_LIMIT_QUOTAS = {
    /** Maximum requests per host per minute */
    MAX_PER_HOST_PER_MINUTE: 60,
    /** Maximum requests per client per minute */
    MAX_PER_CLIENT_PER_MINUTE: 300,
    /** Rate limit window duration (1 minute) */
    WINDOW_MS: 60_000,
    /** Interval for cleaning up expired rate limit entries (10 seconds) */
    CLEANUP_INTERVAL_MS: 10_000,
    /** Client ID used for stdio transport */
    STDIO_CLIENT_ID: "__stdio_client__",
} as const;

export const RATE_LIMIT = {
    ...RATE_LIMIT_QUOTAS,
    /**
     * Ceiling on distinct keys either rate-limit map tracks.
     *
     * **Derived rather than chosen, because exceeding it refuses a request.**
     * The most key cardinality legitimate load can produce in one window is
     * every session spending its whole quota on distinct hosts, so a ceiling
     * at that product cannot refuse a caller who is inside their own quota.
     *
     * Deliberately not {@link THROTTLE.MAX_TRACKED_KEYS}: that one bounds log
     * throttles, where overflow costs a line of stderr. Sharing a value would
     * couple an availability threshold to a memory one.
     */
    MAX_TRACKED_KEYS: SESSION.MAX_SESSIONS * RATE_LIMIT_QUOTAS.MAX_PER_CLIENT_PER_MINUTE,
} as const;

export const THROTTLE = {
    /**
     * Ceiling on distinct keys in a log-throttle map, enforced at the write by
     * `security/bounded-throttle.ts::setBounded`.
     *
     * Sized for memory alone: overflow here drops a throttle memo, costing at
     * most one extra line of stderr. Entries are a <=128-char label and a
     * timestamp, so a map is capped near 300 KB against a 100 MB response pool.
     * Counters need {@link RATE_LIMIT.MAX_TRACKED_KEYS}, which is sized for
     * availability because overflow there refuses a request.
     */
    MAX_TRACKED_KEYS: 1024,
} as const;

export const TEMP_DIR = {
    /** Prefix for temp directories */
    PREFIX: "mcp-curl-",
    /** Minimum age before orphaned temp dirs are cleaned (1 hour) */
    ORPHAN_MIN_AGE_MS: 3_600_000,
    /** Backoff period before retrying temp directory creation after failure (1 second) */
    RETRY_BACKOFF_MS: 1_000,
} as const;
