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
    /**
     * Total bytes of response headers cURL received, from `%{size_header}`.
     *
     * Cumulative across a redirect chain, so it covers every header block
     * `-i` printed. Undefined when the metadata suffix was absent or
     * unparseable — callers must treat that as "boundary undetermined" and
     * must not fall back to guessing where the headers end.
     */
    headerBytes?: number;
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
 * The metadata block is `<separator><size_header> <content_type>`, and the
 * **field order is load-bearing**: `%{size_header}` is cURL-authored and
 * always a bare integer, while `%{content_type}` is echoed from the remote
 * and may contain anything including spaces and digits. Putting the
 * server-controlled field last means a crafted `Content-Type` cannot shift
 * or forge the byte count — there is no delimiter after it to spoof.
 *
 * @param rawResponse - The raw response from cURL including metadata suffix
 * @param separator - The unique per-request separator used in -w format
 * @returns ParsedResponse with body, optional contentType and headerBytes
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
    const metadata = rawResponse.slice(separatorIndex + separator.length);

    // Leading integer is %{size_header}; everything after the first space is
    // %{content_type}. A missing or malformed count leaves headerBytes
    // undefined rather than defaulting to a number — "undetermined" and
    // "zero headers" are different answers and must not be conflated.
    const sizeMatch = /^(\d+) ?/.exec(metadata);
    const headerBytes = sizeMatch ? Number(sizeMatch[1]) : undefined;
    const contentType = (sizeMatch ? metadata.slice(sizeMatch[0].length) : metadata).trim();

    return {
        body,
        contentType: contentType || undefined,
        headerBytes: Number.isSafeInteger(headerBytes) ? headerBytes : undefined,
    };
}

/**
 * A cURL `-i` response split into its header block(s) and body.
 */
export interface SplitResponse {
    /**
     * The raw header text, or `undefined` when there is none to report —
     * `include_headers` was not in effect, cURL emitted no headers, or the
     * boundary could not be determined. Those cases are deliberately
     * indistinguishable to the caller: all three mean "no bytes here are
     * provably headers", and only a determined boundary yields a value.
     * On a redirect chain this holds every header block, matching what
     * `curl -i` prints.
     */
    headerText?: string;
    /** The response body with all header blocks removed. */
    body: string;
}

/**
 * Split cURL `-i` output into header text and body, at the byte offset cURL
 * itself reported.
 *
 * `-i` prepends the response header block to the body on stdout, which
 * corrupts every body-shaped operation downstream: the saved file is no
 * longer the JSON document it claims to be, and a jq filter cannot parse
 * what it is handed. Separating the two lets headers be reported as the
 * response *metadata* they are, leaving the body intact.
 *
 * **The boundary is taken from `%{size_header}`, never inferred from the
 * bytes.** An earlier revision scanned for status lines and consumed blocks
 * while the remainder still looked like one. That could not work, and the
 * reason is worth keeping: a body that genuinely *is* an HTTP transcript —
 * a proxy dump, an RFC example, a cached-response API, or anything a hostile
 * origin chooses to send — is byte-identical to a real header block. The
 * scan therefore had two failure modes with one cause. It silently ate body
 * bytes and wrote the truncated remainder to disk; and it let a remote
 * launder its own content into the header channel, presenting attacker text
 * to the model as server-asserted metadata. No pattern could separate them,
 * because there was nothing to separate — the bytes are the same.
 *
 * `%{size_header}` arrives on the `-w` metadata channel behind an
 * unguessable per-request separator, so the origin cannot influence it. It
 * is cumulative across a redirect chain, so every block `-i` printed is
 * still covered.
 *
 * Scanning also made the cost quadratic: each pass searched the whole
 * remaining string for a terminator and re-sliced the remainder, with the
 * trip count set by the remote. Measured at 2MB of crafted stdout: 2.9s of
 * blocked event loop, growing four-fold per doubling. Indexing at a known
 * offset is a single slice.
 *
 * @param raw - stdout from cURL, with the `-w` metadata suffix already removed
 * @param headerBytes - `%{size_header}` from the metadata block; when
 *   undefined the boundary is undetermined and the whole input is returned
 *   as body, because labelling remote bytes as headers on a guess is the
 *   failure this function exists to prevent
 * @returns The header text (if any) and the remaining body
 */
export function splitResponseHeaders(
    raw: string,
    headerBytes: number | undefined
): SplitResponse {
    // Fail closed on an undetermined boundary: never claim header provenance
    // for bytes we cannot prove are headers.
    if (headerBytes === undefined || !Number.isSafeInteger(headerBytes) || headerBytes <= 0) {
        return { body: raw };
    }

    const buf = Buffer.from(raw, "utf8");
    if (headerBytes > buf.length) {
        // cURL reported more header bytes than we hold. The read was
        // truncated, or the decode shifted offsets. Undetermined again.
        return { body: raw };
    }

    // The body always begins at the full reported offset. The cap below
    // truncates only what is REPORTED as header text — it must never move the
    // body boundary, or capping would start eating the body.
    const body = buf.subarray(headerBytes).toString("utf8");

    // Cap here, where the string is produced, rather than at each of the four
    // branches that emit it. Header text is surfaced inline even when the body
    // was auto-saved to a file, so `max_result_size` does not bound it; without
    // this its only ceiling is MAX_RESPONSE_SIZE (10MB), twenty times the
    // default inline return. cURL allows ~100KB per header line and caps
    // neither header count nor chain length, so the remote picks the size.
    const capped = headerBytes > LIMITS.MAX_HEADER_TEXT_BYTES;
    const headerSlice = buf.subarray(0, capped ? LIMITS.MAX_HEADER_TEXT_BYTES : headerBytes);
    let headerText = headerSlice.toString("utf8").replace(/\r?\n\r?\n$/, "");
    if (capped) {
        headerText += `\n\n[headers truncated: ${headerBytes} bytes received, ${LIMITS.MAX_HEADER_TEXT_BYTES} shown]`;
    }

    return headerText ? { headerText, body } : { body };
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
