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
     * The body as exact octets, with the metadata suffix removed.
     *
     * Byte offsets from cURL (`%{size_header}`) index THIS, never `body` —
     * `body` is a lossy UTF-8 view in which an invalid byte becomes U+FFFD and
     * re-encodes to three bytes where the wire had one.
     */
    bodyBytes: Buffer;
    /**
     * Total bytes of response headers cURL received, from `%{size_header}`.
     *
     * Cumulative across a redirect chain, so it covers every header block
     * `-i` printed. Undefined when the metadata suffix was absent or
     * unparseable — callers must treat that as "boundary undetermined" and
     * must not fall back to guessing where the headers end.
     */
    headerBytes?: number;
    /**
     * Whether the `-w` metadata block was located at all.
     *
     * **Distinct from `contentType === undefined`**, and the distinction is
     * load-bearing: "the origin sent no Content-Type" and "we could not find
     * our own metadata" must not select the same defences. The second means
     * every cURL-authored field is missing, so the strictest grammar applies —
     * see `defendText`'s `contentTypeUndetermined`.
     */
    metadataFound: boolean;
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
    rawResponse: Buffer,
    separator: string
): ParsedResponse {
    // Buffer only, deliberately. A `string | Buffer` union left the lossy arm —
    // the one RC-2 was about — one character away at every call site, with no
    // compiler objection. Tests convert at the call site instead.
    const raw = rawResponse;
    const sep = Buffer.from(separator, "utf8");

    // The window is the separator's own length PLUS the field allowance, not a
    // flat constant the two share. Sharing one budget let a long, entirely
    // legal, remote-chosen Content-Type push the separator out of the window —
    // at which point every cURL-authored field read as absent and the caller
    // silently lost the header/body split. See LIMITS.MAX_METADATA_TAIL_LENGTH.
    const windowBytes = sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH;
    const searchStart = Math.max(0, raw.length - windowBytes);
    // Search only the window, so the scan stays bounded rather than walking a
    // 10MB body to find something that can only ever be at the end.
    const indexInWindow = raw.subarray(searchStart).lastIndexOf(sep);
    const separatorIndex = indexInWindow === -1 ? -1 : searchStart + indexInWindow;

    if (separatorIndex === -1) {
        return {
            body: raw.toString("utf8"),
            bodyBytes: raw,
            metadataFound: false,
        };
    }

    const bodyBytes = raw.subarray(0, separatorIndex);
    const metadata = raw.subarray(separatorIndex + sep.length).toString("utf8");

    // Leading integer is %{size_header}; everything after the first space is
    // %{content_type}. A missing or malformed count leaves headerBytes
    // undefined rather than defaulting to a number — "undetermined" and
    // "zero headers" are different answers and must not be conflated.
    const sizeMatch = /^(\d+) ?/.exec(metadata);
    const parsedBytes = sizeMatch ? Number(sizeMatch[1]) : undefined;
    const contentType = (sizeMatch ? metadata.slice(sizeMatch[0].length) : metadata).trim();

    return {
        body: bodyBytes.toString("utf8"),
        bodyBytes,
        contentType: contentType || undefined,
        headerBytes: Number.isSafeInteger(parsedBytes) ? parsedBytes : undefined,
        metadataFound: true,
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
    /**
     * Total header bytes cURL reported, when a boundary was determined.
     *
     * Carried out of band rather than written into `headerText`, because a
     * truncation notice inside remote-authored text is a control-plane fact in
     * a data-plane string: an origin can simply send the same words in a header
     * value and the reader cannot tell which one the system wrote. The same
     * reasoning already produced `generateMetadataSeparator` elsewhere in this
     * codebase.
     */
    headerBytesReceived?: number;
    /** Whether `headerText` was cut at LIMITS.MAX_HEADER_TEXT_BYTES. */
    truncated?: boolean;
}

/**
 * Split cURL `-i` output into header text and body, at the byte offset cURL
 * itself reported.
 *
 * **The boundary comes from `%{size_header}`, never from the bytes** —
 * `ARCHITECTURE.md` invariant 13, and `LESSONS.md` RC-1 for what it cost to
 * learn. In short: a body may legitimately *be* an HTTP transcript, so a real
 * header block and a forged one are the same bytes and no pattern can separate
 * them. `%{size_header}` rides the `-w` channel behind an unguessable
 * per-request separator, so the origin cannot influence it, and it is
 * cumulative across a redirect chain.
 *
 * Takes the exact octets rather than a decoded string: the offset is measured
 * on the wire, and a lossy decode moves it (invariant 13's second half).
 *
 * @param bodyBytes - stdout octets with the `-w` metadata suffix already removed
 * @param headerBytes - `%{size_header}`; undefined means the boundary is
 *   undetermined, and the whole input is returned as body rather than guessed at
 * @returns The header text (if any), the body, and out-of-band truncation facts
 */
export function splitResponseHeaders(
    bodyBytes: Buffer,
    headerBytes: number | undefined
): SplitResponse {
    // Fail closed on an undetermined boundary: never claim header provenance
    // for bytes we cannot prove are headers.
    if (headerBytes === undefined || !Number.isSafeInteger(headerBytes) || headerBytes <= 0) {
        return { body: bodyBytes.toString("utf8") };
    }
    if (headerBytes > bodyBytes.length) {
        // cURL reported more header bytes than we hold: a truncated read.
        // Undetermined again.
        return { body: bodyBytes.toString("utf8") };
    }

    // The reported region must actually END at a header terminator. cURL's
    // count and the stream's layout are two different sources, and this is the
    // cheap check that they agree — an assumption asserted in a comment is not
    // evidence about the bytes. On disagreement, fail closed rather than
    // reporting a region we cannot vouch for.
    const terminator = bodyBytes.subarray(Math.max(0, headerBytes - 4), headerBytes).toString("latin1");
    if (!terminator.endsWith("\r\n\r\n") && !terminator.endsWith("\n\n")) {
        return { body: bodyBytes.toString("utf8") };
    }

    // The body always begins at the full reported offset. The cap below
    // truncates only what is REPORTED as header text — it must never move the
    // body boundary, or capping would start eating the body.
    const body = bodyBytes.subarray(headerBytes).toString("utf8");

    const capped = headerBytes > LIMITS.MAX_HEADER_TEXT_BYTES;
    const sliceEnd = capped ? LIMITS.MAX_HEADER_TEXT_BYTES : headerBytes;
    const headerText = bodyBytes.subarray(0, sliceEnd).toString("utf8").replace(/\r?\n\r?\n$/, "");

    if (!headerText) return { body };
    return { headerText, body, headerBytesReceived: headerBytes, truncated: capped };
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
    // Requires at least two path segments, so a bare "/users" is left alone — a
    // two-segment path such as "/v1/users" still matches and is replaced.
    sanitized = sanitized.replace(/(?:\/(?:[^\s/:]+\/)+[^\s/:]+|[A-Za-z]:\\[^\s:]+)/g, "[PATH]");
    // Add hint about getting more details
    if (sanitized !== message) {
        sanitized += " (use include_metadata: true for details)";
    }
    return sanitized;
}
