// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling
import { LIMITS } from "../config/limits.js";
import { applyJqFilter } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
/**
 * Process response with filtering and size handling.
 *
 * Processing stages:
 * 1. Apply jq_filter if provided AND response is JSON (or looks like JSON)
 * 2. Check content size against maxResultSize
 * 3. Auto-save to file if size exceeds limit OR saveToFile=true
 *
 * @param response - The response content to process
 * @param options - Processing options (url, jqFilter, maxResultSize, etc.)
 * @returns ProcessedResponse with content and file save status
 * @throws Error if jq_filter is used on non-JSON content
 */
export async function processResponse(response, options) {
    let content = response;
    // Step 1: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const trimmed = content.trim();
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(`Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"}).\n` +
                    `Preview: ${content.slice(0, LIMITS.ERROR_PREVIEW_LENGTH)}${content.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`);
            }
            // Actually try to parse it to verify it's valid JSON
            try {
                JSON.parse(trimmed);
            }
            catch (error) {
                // SyntaxError indicates invalid JSON
                if (error instanceof SyntaxError) {
                    throw new Error(`Cannot apply jq_filter: Response does not appear to be valid JSON.\n` +
                        `Preview: ${content.slice(0, LIMITS.ERROR_PREVIEW_LENGTH)}${content.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`);
                }
                throw error; // Re-throw unexpected errors
            }
        }
        content = applyJqFilter(content, options.jqFilter);
    }
    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");
    // Step 3: Check if we need to save to file
    const shouldSave = options.saveToFile || contentBytes > maxSize;
    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url, options.outputDir);
        // Keep content as actual response data, capped to maxSize for preview
        // Use byte-aware truncation to handle multi-byte UTF-8 characters correctly
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
