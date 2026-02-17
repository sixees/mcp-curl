// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

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
export async function processResponse(
    response: string,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    // Early size guard: reject responses exceeding absolute limit before processing
    const rawBytes = Buffer.byteLength(response, "utf8");
    if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
        );
    }

    let content = response;

    // Step 1: Apply jq filter if provided AND response is JSON
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
    }

    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");

    // Step 3: Check if we need to save to file
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
