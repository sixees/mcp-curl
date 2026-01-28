export declare const JQ: {
    /** Maximum jq_filter string length */
    readonly MAX_FILTER_LENGTH: 500;
    /** Maximum tokens in a single filter */
    readonly MAX_TOKENS: 50;
    /** Maximum comma-separated filters */
    readonly MAX_FILTERS: 20;
    /** Parsing timeout to prevent ReDoS (100ms) */
    readonly MAX_PARSE_TIME_MS: 100;
    /** Maximum file size for jq_query tool (same as response limit) */
    readonly MAX_QUERY_FILE_SIZE: 10000000;
};
