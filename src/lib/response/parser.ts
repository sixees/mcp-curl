// src/lib/response/parser.ts
// Parse cURL output and check content types

import { LIMITS } from "../config/limits.js";
import { parseMimeType } from "../utils/index.js";

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
    const mime = parseMimeType(contentType);
    return mime === "application/json" || mime.endsWith("+json");
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
 * A cURL `-i` response split into its header block(s) and body.
 */
export interface SplitResponse {
    /**
     * The raw header text, or `undefined` when no status line was found
     * (i.e. `include_headers` was not in effect, or cURL emitted no headers).
     * On a redirect chain this holds every header block, blank-line separated,
     * matching what `curl -i` prints.
     */
    headerText?: string;
    /** The response body with all header blocks removed. */
    body: string;
}

/**
 * Matches an HTTP status line at the very start of a string.
 *
 * Requiring the three-digit status code — rather than a bare `HTTP/` prefix —
 * keeps a body that happens to begin with the literal text `HTTP/1.1` from
 * being mistaken for another header block on the redirect-chain loop below.
 */
const STATUS_LINE_PATTERN = /^HTTP\/\d(?:\.\d)?[ \t]+\d{3}(?:[ \t][^\r\n]*)?\r?\n/;

/**
 * Split cURL `-i` output into header text and body.
 *
 * `-i` prepends the response header block to the body on stdout, which
 * corrupts every body-shaped operation downstream: the saved file is no
 * longer the JSON document it claims to be, and a jq filter cannot parse
 * what it is handed. Separating the two lets headers be reported as the
 * response *metadata* they are, leaving the body intact.
 *
 * With `follow_redirects` (cURL's default here) and with `1xx` informational
 * responses, cURL emits one header block per response in the chain. All of
 * them are returned, so a redirect chain stays visible.
 *
 * @param raw - stdout from cURL, with the `-w` metadata suffix already removed
 * @returns The header text (if any) and the remaining body
 */
export function splitResponseHeaders(raw: string): SplitResponse {
    const blocks: string[] = [];
    let rest = raw;

    while (STATUS_LINE_PATTERN.test(rest)) {
        const crlfEnd = rest.indexOf("\r\n\r\n");
        const lfEnd = rest.indexOf("\n\n");

        let end: number;
        let terminatorLength: number;
        if (crlfEnd !== -1 && (lfEnd === -1 || crlfEnd <= lfEnd)) {
            end = crlfEnd;
            terminatorLength = 4;
        } else if (lfEnd !== -1) {
            end = lfEnd;
            terminatorLength = 2;
        } else {
            // Unterminated block: a HEAD response or a truncated read. The
            // whole remainder is header text and there is no body.
            blocks.push(rest);
            rest = "";
            break;
        }

        blocks.push(rest.slice(0, end));
        rest = rest.slice(end + terminatorLength);
    }

    if (blocks.length === 0) {
        return { body: raw };
    }
    return { headerText: blocks.join("\n\n"), body: rest };
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
