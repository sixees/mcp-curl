// src/lib/config/limits.ts
// Response sizes, timeouts, and file handling limits

/** Bytes per megabyte (for human-readable size formatting) */
export const BYTES_PER_MB = 1_000_000;

/**
 * Shared cap for fixed-point sanitisation/strip loops on attacker-controlled
 * text. Used by:
 *   - `response/strip-blocks.ts → stripBlocksFixedPoint` (script/style strip
 *     against self-healing payloads like
 *     `<scr<script>ipt>alert(1)</scr</script>ipt>`).
 *   - `utils/sanitize.ts → sanitizeResponse` (whitespace-padding interleaving
 *     against `(49 spaces + ZWSP) × N` payloads).
 *
 * 4 iterations is a soft termination guarantee — both loops exit early when
 * the transform converges (`next === curr`). This shared constant makes the
 * relationship explicit so a future maintainer can see they are intended to
 * share a value, not drift independently.
 */
export const FIXED_POINT_MAX_ITERATIONS = 4;

export const LIMITS = {
    /** Maximum response size for processing (10MB) */
    MAX_RESPONSE_SIZE: 10_000_000,
    /** Default max result size for AI agent responses (500KB) */
    DEFAULT_MAX_RESULT_SIZE: 500_000,
    /** Maximum total memory across all concurrent requests (100MB) */
    MAX_TOTAL_RESPONSE_MEMORY: 100_000_000,
    /** Characters to show in error previews */
    ERROR_PREVIEW_LENGTH: 200,
    /**
     * Maximum bytes of response header text returned inline (64KB).
     *
     * Header text is server-controlled and is surfaced inline even when the
     * body was auto-saved to a file, so it is not covered by
     * `max_result_size`. Without its own ceiling the only bound is
     * `MAX_RESPONSE_SIZE` (10MB) — twenty times the default inline return.
     * cURL permits ~100KB per header line and caps neither header count nor
     * redirect-chain length, so "headers are small" is an assumption the
     * remote gets to falsify.
     */
    MAX_HEADER_TEXT_BYTES: 64_000,
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
    /**
     * Maximum length of operator-supplied HTTP transport auth tokens.
     * 4096 covers RSA-256 JWTs (~700–900 chars), OIDC ID tokens (1500–2500 chars),
     * and JWE tokens (up to ~4 KB) while staying well below the 8 KB HTTP
     * header line-limit. Above this length is almost certainly a paste error.
     */
    MAX_AUTH_TOKEN_LENGTH: 4096,
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
