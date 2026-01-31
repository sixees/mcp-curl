/**
 * Parsed response with body and optional content type.
 */
export interface ParsedResponse {
    /** Response body content */
    body: string;
    /** Content-Type header value, if found */
    contentType?: string;
}
/**
 * Check if a content-type indicates JSON response.
 *
 * Matches:
 * - application/json
 * - Any content type ending with +json (e.g., application/vnd.api+json)
 *
 * @param contentType - The Content-Type header value
 * @returns true if the content type indicates JSON
 */
export declare function isJsonContentType(contentType: string | undefined): boolean;
/**
 * Parse cURL response to extract body and content-type.
 *
 * The separator must be the same unique value used in the -w format string.
 * As a defense-in-depth measure, we only search for the separator near the
 * end of the response (within MAX_METADATA_TAIL_LENGTH bytes). The unique
 * per-request separator is the primary protection against injection.
 *
 * @param rawResponse - The raw response from cURL including metadata suffix
 * @param separator - The unique per-request separator used in -w format
 * @returns ParsedResponse with body and optional contentType
 */
export declare function parseResponseWithMetadata(rawResponse: string, separator: string): ParsedResponse;
/**
 * Sanitize error messages to prevent information disclosure.
 *
 * When includeDetails is false:
 * - Removes response previews (could contain sensitive API data)
 * - Removes file paths (could leak system information)
 * - Adds hint about getting more details with include_metadata
 *
 * @param message - The raw error message
 * @param includeDetails - If true, return message unchanged
 * @returns Sanitized error message
 */
export declare function sanitizeErrorMessage(message: string, includeDetails: boolean): string;
