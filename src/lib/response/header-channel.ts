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
    /**
     * How many of `bytesReceived`'s octets were used, when the text was cut —
     * and **`undefined` when that cannot be stated**.
     *
     * Both numbers are origin octets or there is no pair. Reporting the ceiling
     * constant gave `truncated at 64000 of 5000 bytes`; reporting the returned
     * *text* length gave `1000 of 722`, because `defendText` is not
     * length-preserving — `![](data:)` is 10 bytes and `[image removed]` is 15,
     * so defended text can exceed the octets it came from. Both pairs are
     * arithmetically impossible and both read as "nothing was cut".
     *
     * So the input is capped first, which makes the consumed count knowable in
     * origin units. When the defence then grows the text past the ceiling and a
     * second cut is needed, the surviving octet count is genuinely unknown —
     * and this is `undefined` rather than a guess. `truncated` still says the
     * text was cut; only the ratio is withheld.
     */
    bytesReturned?: number;
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
 * @param headerBytes - header octets from cURL, bounded by the executor's
 *   retention cap; undefined when none arrived
 * @param bytesReceived - total bytes cURL wrote, including any the executor
 *   dropped past that cap. Passed rather than derived from `headerBytes.length`
 *   so the reported total describes the origin rather than our own bound
 * @param url - request URL, for the injection-detection log label
 * @param maxResultSize - the caller's inline budget, which header text honours
 */
export function extractHeaderChannel(
    headerBytes: Buffer | undefined,
    bytesReceived: number | undefined,
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

    // What cURL wrote, which may exceed what the executor kept.
    const totalReceived = bytesReceived ?? headerBytes.length;
    const droppedByExecutor = totalReceived > headerBytes.length;

    // The ceiling honours the caller's inline budget as well as this channel's
    // own, because header text is returned inline even when the body went to a
    // file — so `max_result_size` never bounded it otherwise.
    const inlineCeiling = Math.min(
        LIMITS.MAX_HEADER_TEXT_BYTES,
        maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE
    );

    // Cap the INPUT first. That is what makes the consumed count knowable in
    // the same units as `bytesReceived`, and it also stops the defence
    // pipeline running over more bytes than could ever be returned.
    const inputConsumed = Math.min(headerBytes.length, inlineCeiling);
    const raw = headerBytes
        .subarray(0, inputConsumed)
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
    // documented ceiling be exceeded (invariant 14 — the gate weighs the
    // DEFENDED bytes). This second cut is also the one case where the surviving
    // octet count stops being knowable, which is why it is tracked separately
    // rather than folded into `truncated`.
    const defendedBytes = Buffer.byteLength(defended, "utf8");
    const grewPastCeiling = defendedBytes > inlineCeiling;
    const responseHeaders = grewPastCeiling
        ? Buffer.from(defended, "utf8").subarray(0, inlineCeiling).toString("utf8")
        : defended;

    const inputWasCut = inputConsumed < headerBytes.length;
    const truncated = droppedByExecutor || inputWasCut || grewPastCeiling;

    return {
        responseHeaders,
        undetermined: false,
        truncated,
        bytesReceived: totalReceived,
        // Origin octets, or nothing. Never the returned text's own length.
        bytesReturned: truncated && !grewPastCeiling ? inputConsumed : undefined,
    };
}
