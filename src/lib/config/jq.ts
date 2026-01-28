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
    /** Parsing timeout to prevent ReDoS (100ms) */
    MAX_PARSE_TIME_MS: 100,
    /** Maximum file size for jq_query tool (same as response limit) */
    MAX_QUERY_FILE_SIZE: LIMITS.MAX_RESPONSE_SIZE,
    /** TTL for allowed directories cache in file validation (1 minute) */
    ALLOWED_DIRS_CACHE_TTL_MS: 60_000,
} as const;
