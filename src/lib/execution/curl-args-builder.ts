// src/lib/execution/curl-args-builder.ts
// Build cURL CLI arguments from structured parameters

import { validateNoCRLF } from "../security/index.js";
import { LIMITS } from "../config/index.js";
import { ALLOWED_URL_SCHEMES_CURL_FLAG } from "../config/security/url-schemes.js";
import { HEADER_DUMP_PATH, platformSupportsHeaderDump } from "./command-executor.js";
import { metadataDirectives, type MetadataBlock } from "../types/common.js";

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
    /** Request compressed response and automatically decompress */
    compressed?: boolean;
    /** Silent mode - no progress output */
    silent?: boolean;
    /**
     * DNS pinning: `--resolve hostname:port:ip` holds cURL to the address the
     * SSRF check already validated.
     *
     * **Required, because an optional defence has no failure mode.** An
     * argument list omitting it would be valid and spawnable, cURL would do its
     * own DNS, and the pin would be off with nothing to fail. `metadataBlock`
     * below is required for the same reason, on invariant 13's behalf.
     *
     * Required closes the *omission* route and nothing more. It cannot check
     * that the pin came from `validateUrlAndResolveDns`, nor that
     * `hostname`/`port` match `url` — a mismatched pin has cURL resolve the name
     * itself with no error, which is why provenance is asserted at the producer
     * in `curl-execute.headers.test.ts`. One spawn is one hop: no `-L` is ever
     * emitted and `-q` stops a `.curlrc` adding one, so cURL never connects
     * anywhere this pin does not cover, and
     * `executeCurlRequest` validates and pins each redirect hop itself
     * (`ARCHITECTURE.md` invariant 2).
     */
    dnsResolve: { hostname: string; port: number; resolvedIp: string };
    /**
     * This request's `-w` metadata block. Its unique separator prevents
     * response injection; the same value goes to `parseResponseWithMetadata`.
     */
    metadataBlock: MetadataBlock;
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
    // `-q` first, and only first counts: cURL reads no config file. A `.curlrc`
    // is the one input that can change cURL's behaviour without appearing here,
    // and `location` in one would follow redirects inside this spawn, past the
    // per-hop gate (ARCHITECTURE.md invariant 2). It also stops a config-file
    // `proxy`, `resolve` or `insecure` overriding the argv below.
    const args: string[] = ["-q"];

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

    // Insecure (skip SSL verification)
    if (params.insecure) {
        args.push("-k");
    }

    // Timeout, in seconds; may be fractional (a redirect hop gets what is left
    // of the chain's deadline). Never 0: cURL reads `--max-time 0` as no limit.
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

    // Output format: the per-request separator ahead of EVERY field.
    //
    // Every field after `%{http_code}` is remote-echoed, and that is safe because
    // nothing the remote writes can split them: the separator is unguessable per
    // request, so every occurrence on stdout is cURL's, and the parser rejects
    // a block whose separator count is wrong. `metadataDirectives` is the
    // layout both sides read (ARCHITECTURE.md invariant 13).
    const sep = params.metadataBlock.separator.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    const fields = metadataDirectives(params.metadataBlock);
    args.push("-w", fields.map((field) => sep + field).join(""));

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
