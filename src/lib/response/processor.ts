// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
import {
    STRIP_PATH_MAX_BYTES,
    looksLikeMarkupShape,
    stripBlocksFixedPoint,
    stripHtmlComments,
    stripMarkdownBeacons,
} from "./strip-blocks.js";
import {
    isMarkdownContentType,
    isSniffableContentType,
    safeHostname,
    supportsMarkupComments,
} from "../utils/index.js";
import { sanitizeAndDetect } from "../security/index.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

/**
 * Options for {@link defendText}.
 */
export interface DefendTextOptions {
    /** Content-Type of the text, used to select the strip stages. */
    contentType?: string;
    /** Hostname label for injection-detection logging. */
    hostname: string;
    /**
     * True when the content type could not be DETERMINED, as distinct from the
     * origin simply not sending one.
     *
     * Losing our own metadata must never be a way to switch a defence off. When
     * the content type is unknown the strictest grammar applies, so every strip
     * stage runs — the opposite of the permissive default, which let a remote
     * disable beacon stripping by making the metadata unreadable.
     */
    contentTypeUndetermined?: boolean;
    /**
     * Whether to decode numeric HTML entities during the block strip.
     *
     * **Defaults true, and must be false for any channel whose consumer does
     * not itself decode.** The decode is not a scratch copy: its result is what
     * gets returned. On a body bound for a renderer that would decode anyway,
     * that is correct and is what lets Step 5 catch `&#x69;gnore previous
     * instructions`. On a channel like response headers it is additive — it
     * turns inert text the origin sent into live markup we authored.
     */
    decodeEntities?: boolean;
}

/**
 * Run the full defensive pipeline over one piece of remote-origin text.
 *
 * **This is the single defence path for anything returned to the LLM, and it
 * exists as a shared function so that no caller can assemble a shorter one.**
 * It was extracted after `include_headers` split header text out of the body:
 * the header path kept only `sanitizeAndDetect` (Step 2) and silently lost
 * Steps 3-5, so markdown beacons, `<script>`/`<style>` blocks and
 * numeric-entity-masked injections reached the model through the header
 * channel after being stripped from the body for years.
 *
 * The stages, in order, and the order is load-bearing:
 *
 * - **Step 2** — sanitise + detect, ALWAYS, on the ORIGINAL text. Detection
 *   runs before the sanitiser strips anything, so the log signals on what the
 *   attacker actually sent.
 * - **Steps 3-4** — markup comments, `<script>`/`<style>` fixed-point strip,
 *   and (for declared markdown) beacon removal. Gated on the strip-path cap so
 *   the cost stays bounded on adversarial input.
 * - **Step 5** — re-sanitise + detect, because the strip path's numeric-entity
 *   decoder unmasks `&#x69;gnore previous instructions` into a real injection
 *   phrase that Step 2 could not see.
 *
 * Callers that need size capping or file-saving want {@link processResponse},
 * which wraps this. Call `defendText` directly only for a text channel that
 * genuinely is not the body — response headers being the one such channel.
 *
 * @param text - Remote-origin text to defend
 * @param options - Content-type (selects strip stages) and hostname (logging)
 * @returns The defended text; never suppressed, only rewritten
 */
export function defendText(text: string, options: DefendTextOptions): string {
    let content = text;
    const { hostname, contentTypeUndetermined = false, decodeEntities = true } = options;

    // Compute content-type classification once. An UNDETERMINED content type
    // selects the strictest grammar rather than the loosest — see the option's
    // docs; a remote must not be able to disable a stage by making our metadata
    // unreadable.
    const isMarkup = contentTypeUndetermined || supportsMarkupComments(options.contentType);
    const isMarkdown = contentTypeUndetermined || isMarkdownContentType(options.contentType);

    // Step 2 — sanitise + detect, ALWAYS for any string body.
    //
    // Earlier revisions gated this on `isText = !isBinaryContentType(CT)` —
    // but the gate was attacker-controllable: setting `Content-Type:
    // image/png` on an HTML body disabled the entire pipeline. The body
    // arriving at `processResponse` is always a string (curl captured
    // stdout as UTF-8, with replacement chars where bytes don't decode);
    // sanitising it can only ever remove attack-class codepoints and
    // collapse padding, both of which are no-ops on legitimate binary
    // previews. Always running sanitise+detect closes the bypass.
    //
    // sanitizeAndDetect runs detection on the **original** input
    // (PR-6b S4) before the sanitiser strips anything, so injection
    // log signals on whatever the attacker sent — not on the post-
    // strip surface.
    content = sanitizeAndDetect(content, hostname);

    // Outer-level byte cap. Inside `stripBlocksFixedPoint` the same cap
    // returns the input unchanged on adversarial bodies, but
    // `stripMarkdownBeacons` runs four global replaces on the full body
    // and would otherwise scan multi-MB inputs after round-2 lifted the
    // label/URL caps inside the markdown patterns. Gating Steps 3-5 on
    // this single check keeps the cap a true upper bound for the entire
    // strip path's cost.
    const exceedsStripCap =
        Buffer.byteLength(content, "utf8") > STRIP_PATH_MAX_BYTES;

    // Content-type sniffing: an attacker controlling the response server
    // can serve HTML body with `Content-Type: text/plain`, `text/csv`,
    // `text/javascript`, `image/png`, `application/octet-stream`, or any
    // unrecognised value to bypass the markup-strip path.
    // `isSniffableContentType` covers any CT that doesn't already declare
    // a structured grammar we'd handle either way (markup/markdown
    // declared) or that we deliberately don't sniff (`application/json`,
    // where `<script>` legitimately appears inside string fields).
    //
    // The sniffer scans the FULL post-sanitise body — bounded by the
    // outer-level `exceedsStripCap` short-circuit so the regex never
    // touches bodies above `STRIP_PATH_MAX_BYTES` (256 KB). Earlier
    // revisions clipped to the first 1 KB; that was itself a bypass
    // (1025+ bytes of preamble + `<script>` past the window).
    const sniffedAsMarkup =
        !exceedsStripCap &&
        !contentTypeUndetermined &&
        isSniffableContentType(options.contentType) &&
        looksLikeMarkupShape(content);
    const needsStripPath = isMarkup || isMarkdown || sniffedAsMarkup;

    // Steps 3-5 — strip + re-sanitise (only when the body needs it AND
    // is below the strip-path cap). The single nested branch keeps the
    // strip-path predicate as one source of truth — Steps 3, 4, and 5
    // share the gate.
    if (needsStripPath && !exceedsStripCap) {
        // Step 3 — markup comments + script/style blocks. Fires on any
        // markup-shaped body (declared OR sniffed).
        content = stripHtmlComments(content);
        content = stripBlocksFixedPoint(content, { decodeEntities });

        // Step 4 — markdown beacons. Image / link / dangerous-scheme +
        // residual cleanup. Only fires for declared markdown — sniffed-
        // markup bodies (probably HTML mis-typed as text/plain) don't
        // need the markdown-specific patterns.
        if (isMarkdown) {
            content = stripMarkdownBeacons(content);
        }

        // Step 5 — re-sanitise + detect. The strip path's numeric-entity
        // decoder unmasks `&#x69;gnore previous instructions` into a real
        // injection phrase AFTER the original-text Step 2 detection
        // passed (it saw the entity-encoded form and missed). Using
        // sanitizeAndDetect here (not bare sanitizeResponse) closes the
        // silenced-log gap; per-host throttling (60 s window) prevents
        // double-counting.
        content = sanitizeAndDetect(content, hostname);
    }

    return content;
}

/**
 * Process response with filtering and size handling.
 *
 * Processing pipeline (text content only):
 * 1. Early size guard (against {@link LIMITS.MAX_RESPONSE_SIZE}).
 * 2. **Sanitise + detect** (Unicode attack chars stripped; visible-space
 *    + newline padding collapsed; injection patterns logged on the
 *    pre-sanitise text per the PR-6b S4 ordering). Runs FIRST so that
 *    the strip path's 256 KB cap can't be evaded by Unicode-padding
 *    inflation: an attacker can't pad with U+200B to push the body above
 *    the cap because sanitiser collapses padding before the strip path
 *    is gated on byte-length.
 * 3. **Strip HTML comments + script/style blocks** (markup content types,
 *    markdown content types, OR plain-text-shaped responses whose body
 *    sniffs as markup — closes the `Content-Type: text/plain` tampering
 *    bypass where an attacker serves HTML with the wrong header). The
 *    strip path is ReDoS-hardened: open-to-closer-or-EOF lazy-match
 *    patterns handle malformed and unclosed closers, fixed-point
 *    iteration cap of 4 handles self-healing payloads, numeric-entity
 *    decode unmasks `&#x3c;script&#x3e;` smuggling.
 * 4. **Strip markdown beacons** (image / link / dangerous-scheme +
 *    residual cleanup for nested image-inside-dangerous-link cases).
 * 5. **Re-sanitise + detect** post-strip (`sanitizeAndDetect`, NOT plain
 *    sanitiseResponse). The strip path's numeric-entity decoder unmasks
 *    `&#x69;gnore previous instructions` into a real injection phrase
 *    that the original-text Step 2 detection couldn't see (it saw the
 *    entity-encoded form). The re-detection here closes the silenced-
 *    log gap; throttling prevents same-hostname noise.
 * 6. Apply jq_filter if provided AND response is JSON. Re-sanitise after
 *    filter (JSON.parse may decode escapes into real attack chars).
 * 7. Check size against `maxResultSize`; auto-save to file if exceeded.
 *    NOTE: post-pipeline byte length is NOT guaranteed monotone-shrinking
 *    — markdown beacon replacement substitutes `[link removed]` (14
 *    bytes) which can be longer than a minimal source like `[a](http://x)`.
 *    The post-pipeline size check is therefore required, not redundant.
 *
 * @param response - Response content to process; runtime-checked to be a
 *                   string (the type system enforces this for TS callers,
 *                   but JS callers from custom-tool hooks could bypass).
 * @param options - Processing options (url, jqFilter, maxResultSize, etc.)
 * @returns ProcessedResponse with content and file save status
 * @throws TypeError if `response` is not a string
 * @throws Error if response exceeds the absolute size cap or jq_filter
 *   is used on non-JSON content
 */
export async function processResponse(
    response: string,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    if (typeof response !== "string") {
        throw new TypeError("processResponse: response must be a string");
    }

    // Step 1: Early size guard — runs BEFORE sanitization to avoid wasting CPU on oversized responses
    const rawBytes = Buffer.byteLength(response, "utf8");
    if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
        );
    }

    // Resolve hostname once for injection-detection logging; the defence
    // pipeline and the post-jq re-sanitise below both label with it.
    const hostname = safeHostname(options.url);

    // Steps 2-5 — the shared defence pipeline. Extracted so the header
    // channel takes the identical path; see `defendText`.
    let content = defendText(response, {
        contentType: options.contentType,
        contentTypeUndetermined: options.contentTypeUndetermined,
        hostname,
    });

    // Step 6: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        const trimmed = content.trim();

        // Parse JSON once and reuse for both validation and filtering
        let parsedData: unknown;
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(
                    `Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"})`
                );
            }
        }

        // Parse once - reuse for filter application
        try {
            parsedData = JSON.parse(trimmed);
        } catch (error) {
            // SyntaxError indicates invalid JSON
            if (error instanceof SyntaxError) {
                throw new Error(
                    `Cannot apply jq_filter: Response does not appear to be valid JSON`
                );
            }
            throw error; // Re-throw unexpected errors
        }

        // Apply filter to pre-parsed data (avoids double parse)
        content = applyJqFilterToParsed(parsedData, options.jqFilter);

        // Re-sanitize and re-detect after filter: JSON.parse decodes Unicode escapes in string
        // values (e.g. {"cmd":"Ig​nore..."} → zero-width space in jq output), so attack
        // chars that were invisible in the raw text become real characters in the filtered result.
        //
        // Runs UNCONDITIONALLY — the previous `if (isText)` gate let an
        // attacker bypass post-jq sanitisation by labelling JSON as
        // `application/octet-stream` (binary). If we got this far jq
        // produced a textual filter result; binary-labelled-but-actually-
        // JSON bodies must be sanitised on output.
        content = sanitizeAndDetect(content, hostname);
    }

    // Step 7: Determine max size and decide save-to-file
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");

    const shouldSave = options.saveToFile || contentBytes > maxSize;

    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url, options.outputDir);
        // Keep content as actual response data, capped to maxSize for preview
        // Use byte-aware truncation (best-effort: may produce replacement chars at boundary)
        let displayContent = content;
        if (contentBytes > maxSize) {
            displayContent = Buffer.from(content, "utf8").subarray(0, maxSize).toString("utf8");
        }
        return {
            content: displayContent,
            savedToFile: true,
            filepath,
            message: `Response (${contentBytes} bytes) saved to: ${filepath}`,
        };
    }

    return {
        content,
        savedToFile: false,
    };
}
