// src/lib/config/session.ts
// Session management, rate limiting, and temp directory constants

export const SESSION = {
    /** Maximum concurrent HTTP sessions */
    MAX_SESSIONS: 100,
    /** Session idle timeout (1 hour) */
    IDLE_TIMEOUT_MS: 3_600_000,
    /** Interval for cleaning up idle sessions (5 minutes) */
    CLEANUP_INTERVAL_MS: 300_000,
} as const;

export const RATE_LIMIT = {
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

export const TEMP_DIR = {
    /** Prefix for temp directories */
    PREFIX: "mcp-curl-",
    /** Minimum age before orphaned temp dirs are cleaned (1 hour) */
    ORPHAN_MIN_AGE_MS: 3_600_000,
    /** Backoff period before retrying temp directory creation after failure (1 second) */
    RETRY_BACKOFF_MS: 1_000,
} as const;
