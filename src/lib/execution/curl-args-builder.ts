// src/lib/execution/curl-args-builder.ts
// Build cURL CLI arguments from structured parameters

import { validateNoCRLF } from "../security/index.js";
import { LIMITS } from "../config/index.js";
import { ALLOWED_URL_SCHEMES_CURL_FLAG } from "../config/security/url-schemes.js";
import { HEADER_DUMP_PATH, platformSupportsHeaderDump } from "./command-executor.js";

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
    /** Report response headers, dumped to their own descriptor */
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
     *
     * **Required, because optional it was a defence with no failure mode.**
     * Were it optional, an argument list that omitted it would still be valid
     * and still spawnable — cURL would do its own DNS and the pin would be
     * silently off, with nothing to fail. `metadataSeparator` below is required
     * for the same reason on invariant 13's behalf.
     *
     * **What that does and does not buy, stated because the difference is the
     * whole of invariant 2.** Required closes the *omission* route only. It
     * cannot check that the pin came from `validateUrlAndResolveDns`, nor that
     * `hostname`/`port` match `url` — a mismatched pin makes cURL resolve the
     * name itself, with no error. That the pin carries the validated address is
     * asserted at the producer, in `curl-execute.headers.test.ts`.
     *
     * And it covers **the first hop only.** With `-L` in the argument list,
     * hops 2..N are resolved and connected by cURL with no `--resolve` entry of
     * their own. See `docs/todos/007`; `ARCHITECTURE.md` owns invariant 2's
     * stated reach and this comment must not restate it.
     */
    dnsResolve: { hostname: string; port: number; resolvedIp: string };
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
 * - Response headers dumped to a separate descriptor, never multiplexed onto
 *   stdout, so the header/body boundary is structural (invariant 13)
 *
 * @param params - CurlArgsParams with request configuration
 * @returns Array of command-line arguments for cURL
 */
export function buildCurlArgs(params: CurlArgsParams): string[] {
    const args: string[] = [];

    // Restrict initial request to the shared scheme allowlist (defense-in-depth alongside URL validation in ssrf.ts)
    args.push("--proto", ALLOWED_URL_SCHEMES_CURL_FLAG);

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
        // Restrict redirect protocols to the shared scheme allowlist (prevents file://, ftp://, etc. via redirects)
        args.push("--proto-redir", ALLOWED_URL_SCHEMES_CURL_FLAG);
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

    // Response headers go to their own descriptor, never onto stdout.
    //
    // `-i` would multiplex both onto one stream and leave a boundary to be
    // recovered from the bytes; `--dump-header` makes the split structural, so
    // there is none to infer. ARCHITECTURE.md invariant 13 owns that rule and
    // the three failed attempts at the alternative. `command-executor.ts` opens
    // the descriptor this path names.
    //
    // The platform guard is `platformSupportsHeaderDump`, whose doc-block owns
    // why an unsupported host must lose the header channel rather than the
    // request. It belongs on THIS side of the decision because `executeCommand`
    // opens the pipe iff this flag is present: skipping the flag here degrades
    // the whole path coherently instead of opening a descriptor nothing writes
    // to.
    if (params.include_headers && platformSupportsHeaderDump()) {
        args.push("--dump-header", HEADER_DUMP_PATH);
    }

    // Compressed response
    if (params.compressed) {
        args.push("--compressed");
    }

    // Silent mode (no progress)
    if (params.silent !== false) {
        args.push("-s");
    }

    // Output format: unique per-request separator, then the metadata fields.
    //
    // `%{content_type}` is the only field, and it is remote-echoed. That is
    // safe here precisely because it is last with nothing after it: there is no
    // delimiter for a crafted Content-Type to spoof, and the separator ahead of
    // it is unguessable per request. A second field here would end that: it
    // would give a crafted Content-Type a delimiter to spoof, so any addition
    // goes BEFORE the content type (ARCHITECTURE.md invariant 13).
    const metadataSuffix =
        params.metadataSeparator.replace(/\r/g, "\\r").replace(/\n/g, "\\n") +
        "%{content_type}";
    args.push("-w", metadataSuffix);

    // DNS pinning with --resolve to prevent DNS rebinding attacks
    // Format: --resolve hostname:port:ip
    // This forces cURL to use our pre-validated IP instead of doing its own DNS lookup
    const { hostname, port, resolvedIp } = params.dnsResolve;
    args.push("--resolve", `${hostname}:${port}:${resolvedIp}`);

    // Abort early if Content-Length exceeds limit (cURL exit code 63)
    // For chunked/streaming responses, the Node-level kill in command-executor.ts is the backstop
    args.push("--max-filesize", String(LIMITS.MAX_RESPONSE_SIZE));

    // URL must be last
    args.push(params.url);

    return args;
}
