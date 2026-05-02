// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
import {
    stripBlocksFixedPoint,
    stripHtmlComments,
    stripMarkdownBeacons,
} from "./strip-blocks.js";
import {
    isBinaryContentType,
    isMarkdownContentType,
    isPlainTextLikeContentType,
    looksLikeMarkupShape,
    safeHostname,
    supportsMarkupComments,
} from "../utils/index.js";
import { sanitizeAndDetect } from "../security/index.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

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

    let content = response;

    // Resolve hostname once for injection detection logging.
    const hostname = safeHostname(options.url);

    // Compute content-type classification once.
    const isText = !isBinaryContentType(options.contentType);
    const isMarkup = supportsMarkupComments(options.contentType);
    const isMarkdown = isMarkdownContentType(options.contentType);

    if (isText) {
        // Step 2 — sanitise + detect FIRST so the strip path's 256 KB cap
        // is checked against post-sanitise size. An attacker padding the
        // body with U+200B (3 UTF-8 bytes each) to inflate a small payload
        // above the cap would otherwise bypass the strip and feed the LLM
        // an intact `<script>` block; sanitising first collapses the
        // padding so the strip target is the real (small) payload.
        // sanitizeAndDetect itself runs detection on the **original** input
        // (PR-6b S4) before the sanitiser strips anything, so injection
        // log signals on whatever the attacker sent — not on the
        // post-strip surface.
        content = sanitizeAndDetect(content, hostname);

        // Content-type sniffing: an attacker controlling the response
        // server can serve HTML body with `Content-Type: text/plain` (or
        // empty / undefined) to bypass the markup-strip path. Sniff the
        // post-sanitise body's first ~1 KB for markup shape and treat it
        // as markup if the declared type is plain-text-ish AND the body
        // looks like HTML/SVG/XML. Structured types (JSON, CSV, …) are
        // NOT sniffed — sniffing JSON would risk breaking valid JSON
        // bodies that legitimately contain `<script>` in a string field.
        const sniffedAsMarkup =
            isPlainTextLikeContentType(options.contentType) &&
            looksLikeMarkupShape(content);
        const needsStripPath = isMarkup || isMarkdown || sniffedAsMarkup;

        // Steps 3-5 — strip + re-sanitise (only when the body needs it).
        // The single nested branch keeps the strip-path predicate as one
        // source of truth — Steps 3, 4, and 5 share the gate.
        if (needsStripPath) {
            // Step 3 — markup comments + script/style blocks. Fires on
            // any markup-shaped body (declared OR sniffed).
            content = stripHtmlComments(content);
            content = stripBlocksFixedPoint(content);

            // Step 4 — markdown beacons. Image / link / dangerous-scheme +
            // residual cleanup. Only fires for declared markdown — sniffed-
            // markup bodies (probably HTML mis-typed as text/plain) don't
            // need the markdown-specific patterns.
            if (isMarkdown) {
                content = stripMarkdownBeacons(content);
            }

            // Step 5 — re-sanitise + detect. The strip path's numeric-
            // entity decoder unmasks `&#x69;gnore previous instructions`
            // into a real injection phrase AFTER the original-text Step 2
            // detection passed (it saw the entity-encoded form and missed).
            // Using sanitizeAndDetect here (not bare sanitizeResponse)
            // closes the silenced-log gap; per-host throttling (60 s
            // window) prevents double-counting.
            content = sanitizeAndDetect(content, hostname);
        }
    }

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
        if (isText) {
            content = sanitizeAndDetect(content, hostname);
        }
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
