// src/lib/response/header-channel.ts
// Defend and bound the `include_headers` text channel.

import { LIMITS } from "../config/limits.js";
import { MARKDOWN_MIME, safeHostname } from "../utils/index.js";
import { defendText } from "./processor.js";

/** Result of preparing the header channel for return to the model. */
export interface HeaderChannel {
    /** Defended, bounded header text — absent when there is none to report. */
    responseHeaders?: string;
    /** True when `include_headers` was asked for and no header bytes arrived. */
    undetermined: boolean;
    /** Whether the reported header text was cut. */
    truncated: boolean;
    /** Total header bytes cURL wrote, when any arrived. */
    bytesReceived?: number;
}

/**
 * Make a cURL header block safe to return to the model.
 *
 * Takes the header octets as their own value because that is what the executor
 * now hands back: cURL writes them to a dedicated descriptor, so nothing here
 * separates headers from body. Three attempts to do that separation
 * arithmetically each failed in a new way — `LESSONS.md` RC-1, RC-2 and RC-17 —
 * and the boundary is structural now.
 *
 * What remains is a composition, and this function exists because the
 * composition is where the defects were: `defendText` and the cap were each
 * correct and the wiring between them was not. Giving the wiring one home is
 * what lets the ordering constraints below be stated once.
 *
 * @param headerBytes - header octets from cURL, or undefined when none arrived
 * @param url - request URL, for the injection-detection log label
 * @param maxResultSize - the caller's inline budget, which header text honours
 */
export function extractHeaderChannel(
    headerBytes: Buffer | undefined,
    url: string,
    maxResultSize: number | undefined
): HeaderChannel {
    // No bytes and no capture collapse to the same answer, deliberately: both
    // mean nothing here is provably a header, and invariant 13 requires
    // "undetermined" and "absent" to resolve the same way rather than the
    // permissive one.
    if (!headerBytes || headerBytes.length === 0) {
        return { undetermined: true, truncated: false };
    }

    const bytesReceived = headerBytes.length;

    // Cap BEFORE defending so the pipeline never runs over more bytes than can
    // be returned, and re-cap after — see below.
    const capped = bytesReceived > LIMITS.MAX_HEADER_TEXT_BYTES;
    const raw = headerBytes
        .subarray(0, capped ? LIMITS.MAX_HEADER_TEXT_BYTES : bytesReceived)
        .toString("utf8")
        .replace(/\r?\n\r?\n$/, "");

    if (!raw) {
        return { undetermined: true, truncated: false };
    }

    // The SAME pipeline as the body, never a shorter one (ARCHITECTURE.md
    // invariant 1a). Markdown is the strictest grammar, so every strip stage
    // runs. `decodeEntities: false` because that stage is ADDITIVE and its
    // result is what gets returned — decoding would hand the model a live
    // instruction the origin only ever sent as inert text (LESSONS.md RC-3).
    const defended = defendText(raw, {
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
        responseHeaders: overCeiling
            ? Buffer.from(defended, "utf8").subarray(0, inlineCeiling).toString("utf8")
            : defended,
        undetermined: false,
        truncated: capped || overCeiling,
        bytesReceived,
    };
}
