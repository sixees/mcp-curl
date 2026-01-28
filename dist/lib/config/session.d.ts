export declare const SESSION: {
    /** Maximum concurrent HTTP sessions */
    readonly MAX_SESSIONS: 100;
    /** Session idle timeout (1 hour) */
    readonly IDLE_TIMEOUT_MS: 3600000;
    /** Interval for cleaning up idle sessions (5 minutes) */
    readonly CLEANUP_INTERVAL_MS: 300000;
};
export declare const RATE_LIMIT: {
    /** Maximum requests per host per minute */
    readonly MAX_PER_HOST_PER_MINUTE: 60;
    /** Maximum requests per client per minute */
    readonly MAX_PER_CLIENT_PER_MINUTE: 300;
    /** Rate limit window duration (1 minute) */
    readonly WINDOW_MS: 60000;
    /** Interval for cleaning up expired rate limit entries (10 seconds) */
    readonly CLEANUP_INTERVAL_MS: 10000;
    /** Client ID used for stdio transport */
    readonly STDIO_CLIENT_ID: "__stdio_client__";
};
export declare const TEMP_DIR: {
    /** Prefix for temp directories */
    readonly PREFIX: "mcp-curl-";
    /** Minimum age before orphaned temp dirs are cleaned (1 hour) */
    readonly ORPHAN_MIN_AGE_MS: 3600000;
};
