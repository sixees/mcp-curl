// src/lib/response/parser.ts
// Parse cURL output and check content types

import { LIMITS } from "../config/limits.js";

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
export function isJsonContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const ct = contentType.toLowerCase();
    const mimeType = ct.split(";")[0].trim();
    return mimeType === "application/json" || mimeType.endsWith("+json");
}

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
export function parseResponseWithMetadata(
    rawResponse: string,
    separator: string
): ParsedResponse {
    // Only search for separator near the end as a defense-in-depth measure
    // The unique per-request separator is the primary protection against injection
    const searchStart = Math.max(0, rawResponse.length - LIMITS.MAX_METADATA_TAIL_LENGTH);
    const tailSection = rawResponse.slice(searchStart);
    const separatorIndexInTail = tailSection.lastIndexOf(separator);

    if (separatorIndexInTail === -1) {
        return { body: rawResponse };
    }

    const separatorIndex = searchStart + separatorIndexInTail;
    const body = rawResponse.slice(0, separatorIndex);
    const contentType = rawResponse.slice(separatorIndex + separator.length).trim();
    return { body, contentType: contentType || undefined };
}

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
export function sanitizeErrorMessage(message: string, includeDetails: boolean): string {
    if (includeDetails) {
        return message;
    }
    // Remove response previews (could contain sensitive API data)
    let sanitized = message.replace(/\nPreview:[\s\S]*$/, "");
    // Remove filesystem paths - handles both Unix (/path/to/file) and Windows (C:\path\to\file)
    // Requires at least two path segments to avoid matching URL paths like /v1/users
    sanitized = sanitized.replace(/(?:\/(?:[^\s/:]+\/)+[^\s/:]+|[A-Za-z]:\\[^\s:]+)/g, "[PATH]");
    // Add hint about getting more details
    if (sanitized !== message) {
        sanitized += " (use include_metadata: true for details)";
    }
    return sanitized;
}
