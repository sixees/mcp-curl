// src/lib/response/parser.ts
// Parse cURL output into the body and the `-w` metadata fields

import { LIMITS } from "../config/limits.js";
import { URL_CONTROL_CHARACTER } from "../utils/index.js";
import { metadataDirectives, type MetadataBlock } from "../types/common.js";

/**
 * Parsed response with body and optional content type.
 */
export interface ParsedResponse {
    /**
     * The body's octets — the origin's, **on the arm where the boundary was
     * found**.
     *
     * On `metadataFound: true` this is stdout up to the block's first
     * separator: the origin's body bytes and nothing else. On
     * `metadataFound: false` it is the whole of cURL's stdout, which is normally
     * all body — but is also what remote fields longer in total than
     * `LIMITS.MAX_METADATA_TAIL_LENGTH` produce, because they evict a separator
     * from the search window. So on that arm
     * the buffer may hold this server's own separator and remote header text
     * that was never body, and the field cannot tell you which case you have:
     * "not found" and "not present" are one value here.
     *
     * **That is why the distinction is on the field rather than left to the
     * caller.** Byte-exactness is only available on the `metadataFound: true`
     * arm, so a fidelity claim built on this field has to read the flag —
     * `processResponse` does, and never calls a file saved on the other arm
     * the origin's exact bytes.
     *
     * Octets rather than a decoded string because `processResponse` must be able
     * to quote a byte count the origin can be held to, and because one
     * representation cannot disagree with itself. `CommandResult.stdoutBytes`
     * owns the general form of that argument.
     *
     * A subarray, so it costs no copy — except on the not-found arm, which
     * returns `raw` itself.
     */
    bodyBytes: Buffer;
    /**
     * `%{content_type}` as the origin sent it, trimmed — **a reported fact, never
     * a decision.** Nothing in this tree selects a behaviour on it; it reaches
     * the model only as `declared_content_type` in the `include_metadata` JSON
     * envelope, where the serialiser escapes it and it sits beside the body
     * rather than inside a sentence this server authors (`docs/todos/018`).
     *
     * Absent where the origin sent none, and where the field is over
     * `LIMITS.MAX_CONTENT_TYPE_FIELD_LENGTH` — an over-bound field is absent,
     * never partial (invariant 13).
     */
    contentType?: string;
    /**
     * `%{http_code}`: the status of the response cURL received, or `0` where it
     * received none (cURL writes `000`). Absent when the block was not located
     * or the field is not exactly three digits — **undetermined**, which must
     * never be read as "not a redirect, so return it".
     */
    httpStatus?: number;
    /**
     * `%{redirect_url}`: the absolute URL cURL would have followed, unvalidated.
     *
     * Three values, kept apart because each selects a different outcome:
     * `""` means cURL named no target — **terminal**; a string is a target still
     * to be parsed and gated like any request URL; `undefined` means the block
     * was not located, or the field was over `LIMITS.MAX_REDIRECT_URL_LENGTH`
     * or held a control byte — an **unusable** target, never the same as `""`.
     */
    redirectUrl?: string;
    /**
     * The `%header{…}` sync field as a count: digits only, optionally padded
     * with spaces or tabs, at most 2^31. Present only when the block names a
     * `syncHeaderName` and the origin sent such a value. Absent — no header,
     * empty, malformed, too large — means no information and the local count
     * stands, **never 0**, which would fill the window on the remote's say-so.
     */
    syncHeaderCount?: number;
    /**
     * Whether the `-w` metadata block was located at all.
     *
     * **Distinct from `contentType === undefined`**, and the distinction is
     * load-bearing: "the origin sent no Content-Type" is a fact about the
     * origin, while "we could not find our own metadata" means every
     * cURL-authored field is missing and the body's end is unknown — see
     * `ProcessResponseOptions.bodyBoundaryUndetermined`.
     */
    metadataFound: boolean;
}

/** A sync count: decimal digits, with the optional whitespace HTTP allows around a value. */
const SYNC_COUNT = /^[ \t]*(\d{1,10})[ \t]*$/;
const MAX_SYNC_COUNT = 2 ** 31;

/**
 * Parse cURL output into the body and the `-w` metadata fields.
 *
 * The block is `<sep>http_code<sep>redirect_url[<sep>sync header]<sep>content_type`,
 * the layout `metadataDirectives` states for both this function and
 * `buildCurlArgs`, which must be handed the same `block`. The separator is the
 * same unique per-request value, which the remote cannot guess, so every
 * occurrence of it on stdout is cURL's. Every field after `%{http_code}` is
 * remote-echoed and may contain anything else; `ARCHITECTURE.md` invariant 13
 * states the rules that keep them apart:
 *
 * - fields are split only by the separator;
 * - each field has its own bound, and an over-bound field is absent, never
 *   partial;
 * - a block with the wrong separator count is undetermined
 *   (`metadataFound: false`), so nothing downstream treats the body's end
 *   as known.
 *
 * As a defence-in-depth measure the search covers only the tail of stdout —
 * one separator length per field plus `MAX_METADATA_TAIL_LENGTH` for the
 * fields, never a flat budget the two share (see the window below).
 *
 * **Returns the body as octets and never as a string.** The decode belongs to
 * whoever needs text — `processResponse`, for the defence pipeline and the
 * inline body — so doing it here as well would decode a body up to 10 MB twice
 * per request. The metadata fields ARE decoded here, because they are bounded
 * fields this function parses itself.
 *
 * One representation also cannot disagree with itself about where the body ends.
 * `LESSONS.md` RC-33.
 *
 * @param rawResponse - The raw response from cURL including metadata suffix
 * @param block - The request's metadata block, as handed to `buildCurlArgs`
 * @returns ParsedResponse carrying the body's octets and the metadata fields
 */
export function parseResponseWithMetadata(
    rawResponse: Buffer,
    block: MetadataBlock
): ParsedResponse {
    // Buffer only, deliberately. A `string | Buffer` union would leave the
    // lossy arm — the one RC-2 is about — one character away at every call
    // site, with no compiler objection. Tests convert at the call site instead.
    const raw = rawResponse;
    const sep = Buffer.from(block.separator, "utf8");
    const fieldCount = metadataDirectives(block).length;

    // The window is one separator per field PLUS the field allowance, not a
    // flat constant they share. One shared budget lets a long, entirely legal,
    // remote-chosen field push a separator out of the window, and a perfectly
    // ordinary reply loses every metadata field. The measured case is
    // in LIMITS.MAX_METADATA_TAIL_LENGTH, which owns the sizing.
    const windowBytes = fieldCount * sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH;
    const searchStart = Math.max(0, raw.length - windowBytes);
    // Search only the window, so the scan stays bounded rather than walking a
    // 10MB body to find something that can only ever be at the end.
    const window = raw.subarray(searchStart);
    const separatorIndexes: number[] = [];
    for (let i = window.indexOf(sep); i !== -1; i = window.indexOf(sep, i + sep.length)) {
        separatorIndexes.push(searchStart + i);
    }

    if (separatorIndexes.length !== fieldCount) {
        // No block, a block partly outside the window, or one a field was added
        // to or lost from — indistinguishable here, which is why `bodyBytes` on
        // this arm is not attributable to the origin. See `ParsedResponse.bodyBytes`.
        return {
            bodyBytes: raw,
            metadataFound: false,
        };
    }

    const fields = separatorIndexes.map((start, i) =>
        raw.subarray(start + sep.length, separatorIndexes[i + 1] ?? raw.length)
    );
    const [httpCodeField, redirectField] = fields;
    const syncField = block.syncHeaderName !== undefined ? fields[2] : undefined;
    const contentTypeField = fields[fieldCount - 1]!;

    const httpCode = httpCodeField!.toString("utf8");
    const redirect = redirectField!.length <= LIMITS.MAX_REDIRECT_URL_LENGTH
        ? redirectField!.toString("utf8")
        : undefined;
    const syncDigits = syncField && syncField.length <= LIMITS.MAX_SYNC_HEADER_VALUE_LENGTH
        ? SYNC_COUNT.exec(syncField.toString("utf8"))?.[1]
        : undefined;
    const syncCount = syncDigits !== undefined && Number(syncDigits) <= MAX_SYNC_COUNT
        ? Number(syncDigits)
        : undefined;

    const contentType = contentTypeField.length <= LIMITS.MAX_CONTENT_TYPE_FIELD_LENGTH
        ? contentTypeField.toString("utf8").trim()
        : "";

    return {
        bodyBytes: raw.subarray(0, separatorIndexes[0]),
        contentType: contentType || undefined,
        httpStatus: /^\d{3}$/.test(httpCode) ? Number(httpCode) : undefined,
        redirectUrl: redirect !== undefined && !URL_CONTROL_CHARACTER.test(redirect) ? redirect : undefined,
        syncHeaderCount: syncCount,
        metadataFound: true,
    };
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
