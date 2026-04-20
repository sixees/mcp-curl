// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
import { sanitizeResponse, detectInjectionPattern } from "../utils/index.js";
import { logInjectionDetected } from "../security/index.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

// NOT exported — g flag makes it stateful; used only with .replace() here (safe)
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * Sanitize text and log any detected injection patterns.
 * Extracts the repeated sanitizeResponse + detectInjectionPattern + logInjectionDetected
 * call sequence that appears both before and after jq filtering.
 */
function sanitizeAndDetect(text: string, hostname: string): string {
    const sanitized = sanitizeResponse(text);
    if (detectInjectionPattern(sanitized) !== null) {
        logInjectionDetected(hostname);
    }
    return sanitized;
}

/**
 * Returns true for MIME types that are binary (not text).
 * Binary responses are returned as-is without Unicode sanitization.
 */
function isBinaryContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const mime = contentType.split(";")[0].trim().toLowerCase();
    return (
        mime.startsWith("image/") ||
        mime.startsWith("audio/") ||
        mime.startsWith("video/") ||
        mime.startsWith("font/") ||
        mime.startsWith("multipart/") ||
        mime === "application/octet-stream" ||
        mime === "application/pdf" ||
        mime === "application/wasm" ||
        mime === "application/zip" ||
        mime === "application/gzip" ||
        mime === "application/x-gzip" ||
        mime === "application/x-tar"
    );
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
    let hostname = "unknown";
    try {
        hostname = new URL(options.url).hostname;
    } catch {
        // URL parsing failed — keep "unknown"
    }

    // Steps 2-3: Sanitize and detect injection patterns (text responses only)
    if (!isBinaryContentType(options.contentType)) {
        // Strip HTML comments before Unicode sanitization to prevent hiding injections in markup.
        // Normalize MIME before comparison to handle parameters like "text/html; charset=utf-8".
        const normalizedMime = options.contentType?.split(";")[0].trim().toLowerCase() ?? "";
        if (normalizedMime === "text/html") {
            content = content.replace(HTML_COMMENT_PATTERN, "");
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
        if (!isBinaryContentType(options.contentType)) {
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
