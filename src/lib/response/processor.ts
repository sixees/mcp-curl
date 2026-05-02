// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
import {
    isBinaryContentType,
    isMarkdownContentType,
    safeHostname,
    supportsMarkupComments,
} from "../utils/index.js";
import { sanitizeAndDetect } from "../security/index.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

// NOT exported — g flag makes it stateful; used only with .replace() here (safe)
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// 256 KB cap for the HTML-block-strip path. Above the cap, the strip step is
// skipped entirely (sanitizeAndDetect still runs after). The cap bounds
// pathological cost on adversarial bodies; the regex bodies below are
// linear-time, but the fixed-point loop and entity decode together can hit
// O(n × iterations) on contrived input, and skipping above 256 KB is a clean
// circuit-breaker. Most real HTML responses are well under it.
const STRIP_PATH_MAX_BYTES = 256 * 1024;

// Fixed-point iteration cap. Self-healing payloads like
// "<scr<script>ipt>alert(1)</scr</script>ipt>" require ≥2 passes to fully
// neutralise after the inner match removes; cap at 4 to guarantee termination
// even on contrived nesting.
const STRIP_FIXED_POINT_MAX_ITERATIONS = 4;

// Negative-lookahead body — refuses to match if a nested `<script` appears
// before the closing tag, defeating the simplest self-healing bypass and
// breaking the catastrophic-backtracking shape of the textbook
// `<script>[\s\S]*?</script>` ReDoS pattern (Snyk, 2024). Anchored on `\b`
// to avoid `<scriptlike>` matches.
//
// Trade-off — best-effort textual sanitisation: this is a regex stripper
// against prompt-injection bytes, NOT a full HTML sandbox. We considered
// `parse5` (zero false positives, no ReDoS class) but rejected it:
// 60 KB minified, 2× slower on small bodies, adds a runtime dep. Acceptable
// for our threat model — content reaches an LLM, not a renderer.
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>(?:(?!<\/?script\b)[\s\S])*?<\/script\s*>/gi;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>(?:(?!<\/?style\b)[\s\S])*?<\/style\s*>/gi;

// Orphan-tag patterns. Self-healing payloads like
// `<scr<script>ipt>alert(1)</scr</script>ipt>` collapse under the balanced
// strip to a fragment like `<script>` (open tag, no closer) or `</script>`
// (closer alone) which the balanced pattern will not match. Run a single
// orphan pass AFTER the balanced fixed-point loop to neutralise these
// residues — defence in depth so no `<script` / `<style` token reaches the
// LLM regardless of nesting shape. Linear-time on input length; no nested
// quantifiers so ReDoS-safe.
const ORPHAN_SCRIPT_OPEN_PATTERN = /<script\b[^>]*>/gi;
const ORPHAN_SCRIPT_CLOSE_PATTERN = /<\/script\s*>/gi;
const ORPHAN_STYLE_OPEN_PATTERN = /<style\b[^>]*>/gi;
const ORPHAN_STYLE_CLOSE_PATTERN = /<\/style\s*>/gi;

// Markdown image / link beacon patterns. Both:
//  - Cap the alt/label length at 256 chars — defeats catastrophic backtracking
//    on adversarial mismatched-bracket input.
//  - Cap the URL length at 2048 chars (well above legitimate URL distribution).
//  - Require an http(s) scheme — explicit blocklist of dangerous schemes
//    (S5: javascript:, vbscript:, file:, data:) is enforced separately below
//    so the LLM sees `[link removed]` rather than the original. Same-origin
//    or relative URLs (no scheme) are deliberately preserved.
//  - The link pattern uses `(?<!!)` to avoid matching the `[…](…)` half of an
//    image syntax `![alt](url)`; without this the link strip would double-
//    process every image.
const MARKDOWN_EXTERNAL_IMAGE_PATTERN = /!\[[^\]\n]{0,256}\]\(https?:\/\/[^\s)]{1,2048}\)/g;
const MARKDOWN_EXTERNAL_LINK_PATTERN = /(?<!!)\[[^\]\n]{0,256}\]\(https?:\/\/[^\s)]{1,2048}\)/g;

// S5 — dangerous-scheme blocklist for markdown URLs. The http(s) external
// patterns above only strip explicit external URLs; this pattern strips
// links and images whose href uses a scheme known to carry script payloads
// or local-file disclosure (`javascript:`, `vbscript:`, `file:`, `data:`).
// Order matters: dangerous-scheme strip runs BEFORE the external strip so
// the http(s) pattern doesn't have to know about non-http schemes.
const MARKDOWN_DANGEROUS_SCHEME_PATTERN =
    /!?\[[^\]\n]{0,256}\]\((?:javascript|vbscript|file|data):[^\s)]{0,4096}\)/gi;

// Numeric HTML entities that decode to ASCII bytes used by `<script` /
// `<style` (and their closers). Decoded once per fixed-point pass so payloads
// like `&#x3c;script&#x3e;…&#x3c;/script&#x3e;` cannot smuggle through the
// strip patterns. Named entities (`&amp;`, `&lt;`, `&gt;`) are intentionally
// left alone — they don't directly carry a `<script` shape, and decoding them
// would risk re-introducing characters the upstream caller may want preserved.
function decodeNumericHtmlEntities(input: string): string {
    return input
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
            const cp = Number.parseInt(hex, 16);
            return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
                ? String.fromCodePoint(cp)
                : "";
        })
        .replace(/&#(\d+);?/g, (_, dec: string) => {
            const cp = Number.parseInt(dec, 10);
            return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
                ? String.fromCodePoint(cp)
                : "";
        });
}

/**
 * Strip `<script>` and `<style>` blocks (tag + content) with fixed-point
 * iteration so self-healing payloads cannot reconstruct around an inner
 * removal. Bodies above {@link STRIP_PATH_MAX_BYTES} skip the strip path
 * entirely — `sanitizeAndDetect` still runs downstream.
 *
 * Pre-decode of numeric HTML entities runs first so payloads like
 * `&#x3c;script&#x3e;…&#x3c;/script&#x3e;` cannot smuggle the strip pattern.
 *
 * Returns the input unchanged when no further reductions are possible.
 */
function stripBlocksFixedPoint(input: string): string {
    if (Buffer.byteLength(input, "utf8") > STRIP_PATH_MAX_BYTES) return input;
    let curr = decodeNumericHtmlEntities(input);
    for (let i = 0; i < STRIP_FIXED_POINT_MAX_ITERATIONS; i++) {
        const next = curr.replace(SCRIPT_BLOCK_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
        if (next === curr) break;
        curr = next;
    }
    // Orphan-tag cleanup: any `<script>` / `</script>` (and style) left
    // behind by self-healing residue gets neutralised. See orphan-pattern
    // doc comment for rationale.
    return curr
        .replace(ORPHAN_SCRIPT_OPEN_PATTERN, "")
        .replace(ORPHAN_SCRIPT_CLOSE_PATTERN, "")
        .replace(ORPHAN_STYLE_OPEN_PATTERN, "")
        .replace(ORPHAN_STYLE_CLOSE_PATTERN, "");
}

/**
 * Strip dangerous-scheme markdown links/images and external markdown
 * image / link beacons. Replaces the surface form with `[image removed]` /
 * `[link removed]` so the LLM still sees the surrounding label text but
 * cannot follow the URL.
 *
 * Order:
 *   1. Dangerous-scheme links/images (S5).
 *   2. External http(s) image beacons (replace with `[image removed]`).
 *   3. External http(s) links (replace with `[link removed]`).
 *
 * Step 3 must run AFTER step 2 because the link pattern's `(?<!!)` lookbehind
 * relies on the image being either matched (and removed) or untouched — never
 * partially consumed.
 */
function stripMarkdownBeacons(input: string): string {
    return input
        .replace(MARKDOWN_DANGEROUS_SCHEME_PATTERN, (match) =>
            match.startsWith("!") ? "[image removed]" : "[link removed]"
        )
        .replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, "[image removed]")
        .replace(MARKDOWN_EXTERNAL_LINK_PATTERN, "[link removed]");
}

/**
 * Process response with filtering and size handling.
 *
 * Processing pipeline:
 * 1. Early size guard: reject responses exceeding absolute limit
 * 2. Sanitize: strip Unicode attack vectors and whitespace padding (text only)
 * 3. Detect injection patterns and log (observability only — content unchanged)
 * 4. Apply jq_filter if provided AND response is JSON (or looks like JSON)
 * 5. Check content size against maxResultSize
 * 6. Auto-save to file if size exceeds limit OR saveToFile=true
 *
 * @param response - The response content to process
 * @param options - Processing options (url, jqFilter, maxResultSize, etc.)
 * @returns ProcessedResponse with content and file save status
 * @throws Error if jq_filter is used on non-JSON content
 */
export async function processResponse(
    response: string,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    // Step 1: Early size guard — runs BEFORE sanitization to avoid wasting CPU on oversized responses
    const rawBytes = Buffer.byteLength(response, "utf8");
    if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
        );
    }

    let content = response;

    // Resolve hostname once for injection detection logging (used in steps 2–4)
    const hostname = safeHostname(options.url);

    // Compute once — content-type classification is reused in steps 2–4 below.
    const isText = !isBinaryContentType(options.contentType);

    // Steps 2-3: Sanitize and detect injection patterns (text responses only)
    if (isText) {
        // Strip markup comments + script/style blocks (HTML, XHTML, generic
        // XML, SVG, *+xml) BEFORE Unicode sanitization. All these grammars
        // share the `<!-- -->` syntax. `<script>` blocks may contain prompt-
        // injection text indistinguishable from legitimate guidance; `<style>`
        // can hide content via CSS `content:` properties. The strip path is
        // ReDoS-hardened (negative-lookahead body, fixed-point iteration cap,
        // 256 KB length cap, numeric-entity decode).
        if (supportsMarkupComments(options.contentType)) {
            content = content.replace(HTML_COMMENT_PATTERN, "");
            content = stripBlocksFixedPoint(content);
        }

        // Markdown-specific: strip image beacons (exfil via image-load) and
        // external links (exfil via click-tracking URLs). Same-origin /
        // relative URLs and dangerous-scheme URLs get separate handling
        // inside `stripMarkdownBeacons`.
        if (isMarkdownContentType(options.contentType)) {
            content = stripMarkdownBeacons(content);
        }

        // Single-pass: remove Unicode attack chars + collapse whitespace padding; detect injections
        content = sanitizeAndDetect(content, hostname);
    }

    // Step 4: Apply jq filter if provided AND response is JSON
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
        // values (e.g. {"cmd":"Ig\u200Bnore..."} → zero-width space in jq output), so attack
        // chars that were invisible in the raw text become real characters in the filtered result.
        if (isText) {
            content = sanitizeAndDetect(content, hostname);
        }
    }

    // Step 5: Determine max size
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");

    // Step 6: Check if we need to save to file
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
