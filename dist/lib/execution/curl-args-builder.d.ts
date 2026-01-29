/**
 * Parameters for building cURL command arguments.
 */
export interface CurlArgsParams {
    /** The URL to request */
    url: string;
    /** HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) */
    method?: string;
    /** HTTP headers as key-value pairs */
    headers?: Record<string, string>;
    /** Request body data (for POST/PUT/PATCH) */
    data?: string;
    /** Form data as key-value pairs (multipart/form-data) */
    form?: Record<string, string>;
    /** Custom output format string for cURL -w flag */
    output_format?: string;
    /** Follow HTTP redirects (default: true) */
    follow_redirects?: boolean;
    /** Skip SSL certificate verification */
    insecure?: boolean;
    /** Request timeout in seconds */
    timeout?: number;
    /** Custom User-Agent header */
    user_agent?: string;
    /** Basic authentication in format 'username:password' */
    basic_auth?: string;
    /** Bearer token for Authorization header */
    bearer_token?: string;
    /** Include verbose output with request/response details */
    verbose?: boolean;
    /** Include response headers in output */
    include_headers?: boolean;
    /** Maximum number of redirects to follow */
    max_redirects?: number;
    /** Request compressed response and automatically decompress */
    compressed?: boolean;
    /** Silent mode - no progress output */
    silent?: boolean;
    /**
     * DNS pinning to prevent rebinding attacks.
     * Format: --resolve hostname:port:ip forces cURL to use pre-validated IP
     */
    dnsResolve?: {
        hostname: string;
        port: number;
        resolvedIp: string;
    };
    /**
     * Unique per-request separator for extracting metadata.
     * Prevents response injection attacks by using unpredictable separator.
     */
    metadataSeparator: string;
}
/**
 * Build cURL CLI arguments from structured parameters.
 *
 * Security features:
 * - CRLF injection validation for headers, user_agent, basic_auth, bearer_token
 * - Uses --data-raw (not --data) to prevent file reading via @ prefix
 * - Uses --form-string (not --form) to prevent file reading
 * - DNS pinning with --resolve flag for rebinding prevention
 * - Per-request unique metadata separator for response parsing
 *
 * @param params - CurlArgsParams with request configuration
 * @returns Array of command-line arguments for cURL
 */
export declare function buildCurlArgs(params: CurlArgsParams): string[];
