// src/lib/response/header-channel.ts
// Extract, defend and bound the `include_headers` text channel.

import { LIMITS } from "../config/limits.js";
import { MARKDOWN_MIME, safeHostname } from "../utils/index.js";
import { splitResponseHeaders } from "./parser.js";
import { defendText } from "./processor.js";

/** Result of taking the header channel out of a cURL `-i` response. */
export interface HeaderChannel {
    /** The body with the header block removed, or the whole input when the boundary was undetermined. */
    body: string;
    /** Defended, bounded header text — absent when there is none to report. */
    responseHeaders?: string;
    /** True when `include_headers` was asked for and the boundary could not be established. */
    undetermined: boolean;
    /** Whether the reported header text was cut. */
    truncated: boolean;
    /** Total header bytes cURL reported, when a boundary was determined. */
    bytesReceived?: number;
}

/**
 * Take the header block out of a cURL `-i` response and make it safe to return.
 *
 * Lives beside the two functions it composes rather than inline in the request
 * handler. That placement is the point: every defect this channel has produced
 * — three of them, recorded as RC-1 through RC-3 — was a *composition* defect,
 * where `splitResponseHeaders` and `defendText` were each correct and the wiring
 * between them was not. Giving the wiring a name and one home is what lets the
 * ordering constraints below be stated once instead of living as inline comments
 * in the middle of a 300-line handler.
 *
 * @param bodyBytes - response octets with the `-w` metadata suffix removed
 * @param headerBytes - `%{size_header}`; undefined means undetermined
 * @param url - request URL, for the injection-detection log label
 * @param maxResultSize - the caller's inline budget, which header text honours
 */
export function extractHeaderChannel(
    bodyBytes: Buffer,
    headerBytes: number | undefined,
    url: string,
    maxResultSize: number | undefined
): HeaderChannel {
    const split = splitResponseHeaders(bodyBytes, headerBytes);

    if (!split.headerText) {
        // Undetermined and "the origin sent none" are deliberately the same
        // answer here: both mean no bytes are provably headers.
        return { body: split.body, undetermined: true, truncated: false };
    }

    // The SAME pipeline as the body, never a shorter one (ARCHITECTURE.md
    // invariant 1a). Markdown is the strictest grammar, so every strip stage
    // runs. `decodeEntities: false` because that stage is ADDITIVE and its
    // result is what gets returned — decoding would hand the model a live
    // instruction the origin only ever sent as inert text (LESSONS.md RC-3).
    const defended = defendText(split.headerText, {
        contentType: MARKDOWN_MIME,
        contentTypeUndetermined: false,
        hostname: safeHostname(url),
        decodeEntities: false,
    });

    // Re-cap AFTER defence as well as before it: `[link removed]` is longer than
    // some of the forms it replaces, so a cap applied only upstream lets the
    // documented ceiling be exceeded. The ceiling honours the caller's inline
    // budget too, because this text is returned inline even when the body went
    // to a file — so `max_result_size` never bounded it otherwise.
    const inlineCeiling = Math.min(
        LIMITS.MAX_HEADER_TEXT_BYTES,
        maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE
    );
    const defendedBytes = Buffer.byteLength(defended, "utf8");
    const overCeiling = defendedBytes > inlineCeiling;

    return {
        body: split.body,
        responseHeaders: overCeiling
            ? Buffer.from(defended, "utf8").subarray(0, inlineCeiling).toString("utf8")
            : defended,
        undetermined: false,
        truncated: split.truncated === true || overCeiling,
        bytesReceived: split.headerBytesReceived,
    };
}
