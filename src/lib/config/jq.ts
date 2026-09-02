// src/lib/config/jq.ts
// JQ filter limits for DoS prevention

import { LIMITS } from "./limits.js";

export const JQ = {
    /** Maximum jq_filter string length */
    MAX_FILTER_LENGTH: 500,
    /** Maximum tokens in a single filter */
    MAX_TOKENS: 50,
    /** Maximum comma-separated filters */
    MAX_FILTERS: 20,
    /** Parsing timeout to prevent DoS from a pathologically long or complex filter (100ms) */
    MAX_PARSE_TIME_MS: 100,
    /** Maximum file size for jq_query tool (same as response limit) */
    MAX_QUERY_FILE_SIZE: LIMITS.MAX_RESPONSE_SIZE,
    /** TTL for allowed directories cache in file validation (1 minute) */
    ALLOWED_DIRS_CACHE_TTL_MS: 60_000,
} as const;

/**
 * Characters that are jq expression syntax and therefore cannot appear in a
 * bare key path segment.
 *
 * This engine implements *path extraction only*, not the jq expression
 * language. Without this guard the bare-key scanner in `parseJqFilter()`
 * absorbs these characters into a key name, so a real jq expression like
 * `.data | {id}` silently becomes a lookup for the key `data | {id}`,
 * misses, and yields `null` rather than reporting unsupported syntax. The
 * guard turns a silent wrong answer into a clear error.
 *
 * Deliberately NOT rejected:
 *   - `-` and `_`, which are ordinary characters in real-world JSON keys
 *     (`.content-type`, `.assignee_user_ids`). A hyphen is never silently
 *     misread: the lookup does exactly what the caller intended. jq's binary
 *     minus is still caught, because `.a - .b` contains spaces.
 *   - Anything inside bracket notation (`.["any: char|here"]`), which is
 *     parsed by `parseQuotedKey()` and never reaches the bare-key scanner.
 */
export const UNSUPPORTED_KEY_CHARS: ReadonlySet<string> = new Set([
    // Pipes, comparison, and arithmetic operators
    "|", "=", "<", ">", "!", "+", "*", "/", "%",
    // Optional operator
    "?",
    // Object construction, grouping, and function calls
    "{", "}", "(", ")", ":", ";",
    // Variables and format strings
    "$", "@",
    // String literals belong inside bracket notation
    '"', "'", "`", "\\",
    // Whitespace: a bare key containing spaces must use bracket notation
    " ", "\t", "\n", "\r", "\f", "\v",
]);
