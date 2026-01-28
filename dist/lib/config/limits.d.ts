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
};
