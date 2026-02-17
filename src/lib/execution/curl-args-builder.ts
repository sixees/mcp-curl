// src/lib/execution/curl-args-builder.ts
// Build cURL CLI arguments from structured parameters

import { validateNoCRLF } from "../security/index.js";
import { LIMITS } from "../config/index.js";

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
    dnsResolve?: { hostname: string; port: number; resolvedIp: string };
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
export function buildCurlArgs(params: CurlArgsParams): string[] {
    const args: string[] = [];

    // Restrict initial request to http/https only (defense-in-depth alongside URL validation in ssrf.ts)
    args.push("--proto", "=http,https");

    // Method
    if (params.method) {
        args.push("-X", params.method.toUpperCase());
    }

    // Headers - validate against CRLF injection
    if (params.headers) {
        for (const [key, value] of Object.entries(params.headers)) {
            validateNoCRLF(key, "header name");
            validateNoCRLF(value, `header value for "${key}"`);
            args.push("-H", `${key}: ${value}`);
        }
    }

    // Data/body - use --data-raw to prevent @/< file reading (security: prevents local file exfiltration)
    if (params.data) {
        args.push("--data-raw", params.data);
    }

    // Form data - use --form-string to prevent @/< file reading (security: prevents local file exfiltration)
    // Also validate against CRLF injection like headers
    if (params.form) {
        for (const [key, value] of Object.entries(params.form)) {
            validateNoCRLF(key, "form field name");
            validateNoCRLF(value, `form field value for "${key}"`);
            args.push("--form-string", `${key}=${value}`);
        }
    }

    // Follow redirects with default max redirects
    if (params.follow_redirects !== false) {
        args.push("-L");
        args.push("--max-redirs", String(params.max_redirects ?? LIMITS.MAX_REDIRECTS));
        // Restrict redirect protocols to http/https only (prevents file://, ftp://, etc. via redirects)
        args.push("--proto-redir", "=http,https");
    }

    // Insecure (skip SSL verification)
    if (params.insecure) {
        args.push("-k");
    }

    // Timeout
    if (params.timeout) {
        args.push("--max-time", params.timeout.toString());
    }

    // User agent - validate against CRLF injection
    if (params.user_agent) {
        validateNoCRLF(params.user_agent, "user_agent");
        args.push("-A", params.user_agent);
    }

    // Basic auth - validate against CRLF injection
    if (params.basic_auth) {
        validateNoCRLF(params.basic_auth, "basic_auth");
        args.push("-u", params.basic_auth);
    }

    // Bearer token - validate against CRLF injection
    if (params.bearer_token) {
        validateNoCRLF(params.bearer_token, "bearer_token");
        args.push("-H", `Authorization: Bearer ${params.bearer_token}`);
    }

    // Verbose mode
    if (params.verbose) {
        args.push("-v");
    }

    // Include response headers
    if (params.include_headers) {
        args.push("-i");
    }

    // Compressed response
    if (params.compressed) {
        args.push("--compressed");
    }

    // Silent mode (no progress)
    if (params.silent !== false) {
        args.push("-s");
    }

    // Output format for response info (custom format + metadata separator for content-type)
    // The separator is unique per-request to prevent response injection attacks
    const metadataSuffix = params.metadataSeparator.replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "%{content_type}";
    if (params.output_format) {
        args.push("-w", params.output_format + metadataSuffix);
    } else {
        args.push("-w", metadataSuffix);
    }

    // DNS pinning with --resolve to prevent DNS rebinding attacks
    // Format: --resolve hostname:port:ip
    // This forces cURL to use our pre-validated IP instead of doing its own DNS lookup
    if (params.dnsResolve) {
        const { hostname, port, resolvedIp } = params.dnsResolve;
        args.push("--resolve", `${hostname}:${port}:${resolvedIp}`);
    }

    // Abort early if Content-Length exceeds limit (cURL exit code 63)
    // For chunked/streaming responses, the Node-level kill in command-executor.ts is the backstop
    args.push("--max-filesize", String(LIMITS.MAX_RESPONSE_SIZE));

    // URL must be last
    args.push(params.url);

    return args;
}
