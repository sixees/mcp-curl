// src/lib/config/limits.ts
// Response sizes, timeouts, and file handling limits

/** Bytes per megabyte (for human-readable size formatting) */
export const BYTES_PER_MB = 1_000_000;

export const LIMITS = {
    /** Maximum response size for processing (10MB) */
    MAX_RESPONSE_SIZE: 10_000_000,
    /** Default max result size for AI agent responses (500KB) */
    DEFAULT_MAX_RESULT_SIZE: 500_000,
    /** Maximum total memory across all concurrent requests (100MB) */
    MAX_TOTAL_RESPONSE_MEMORY: 100_000_000,
    /** Characters to show in error previews */
    ERROR_PREVIEW_LENGTH: 200,
    /** Max distance from end to search for metadata separator */
    MAX_METADATA_TAIL_LENGTH: 200,
    /** Default request timeout in milliseconds (30 seconds) */
    DEFAULT_TIMEOUT_MS: 30_000,
    /** Maximum filename length for saved files */
    FILENAME_MAX_LENGTH: 50,
    /** Default HTTP transport port */
    DEFAULT_HTTP_PORT: 3000,
    /** Default maximum number of redirects to follow */
    MAX_REDIRECTS: 10,
} as const;

/**
 * Parse and validate a port number from string input.
 *
 * @param value - Port string to parse (e.g., from process.env.PORT)
 * @param defaultPort - Default port if value is undefined or empty string
 * @returns Validated port number
 * @throws Error if port is not a valid integer in range 1-65535
 */
export function parsePort(value: string | undefined, defaultPort: number): number {
    // Empty strings are treated as undefined (falsy), falling back to default
    const raw = value || String(defaultPort);
    // Reject trailing garbage (e.g., "3000abc") that parseInt would silently accept
    if (!/^\d+$/.test(raw)) {
        throw new Error(`Invalid port value: ${value ?? "(empty)"}`);
    }
    const port = parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port value: ${value ?? "(empty)"}`);
    }
    return port;
}
