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
export declare function processResponse(response: string, options: ProcessResponseOptions): Promise<ProcessedResponse>;
