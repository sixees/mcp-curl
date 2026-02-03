/** Bytes per megabyte (for human-readable size formatting) */
export declare const BYTES_PER_MB = 1000000;
export declare const LIMITS: {
    /** Maximum response size for processing (10MB) */
    readonly MAX_RESPONSE_SIZE: 10000000;
    /** Default max result size for AI agent responses (500KB) */
    readonly DEFAULT_MAX_RESULT_SIZE: 500000;
    /** Maximum total memory across all concurrent requests (100MB) */
    readonly MAX_TOTAL_RESPONSE_MEMORY: 100000000;
    /** Characters to show in error previews */
    readonly ERROR_PREVIEW_LENGTH: 200;
    /** Max distance from end to search for metadata separator */
    readonly MAX_METADATA_TAIL_LENGTH: 200;
    /** Default request timeout in milliseconds (30 seconds) */
    readonly DEFAULT_TIMEOUT_MS: 30000;
    /** Maximum filename length for saved files */
    readonly FILENAME_MAX_LENGTH: 50;
    /** Default HTTP transport port */
    readonly DEFAULT_HTTP_PORT: 3000;
};
/**
 * Parse and validate a port number from string input.
 *
 * @param value - Port string to parse (e.g., from process.env.PORT)
 * @param defaultPort - Default port if value is undefined or empty
 * @returns Validated port number
 * @throws Error if port is not a valid integer in range 1-65535
 */
export declare function parsePort(value: string | undefined, defaultPort: number): number;
