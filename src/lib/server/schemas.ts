// src/lib/server/schemas.ts
// Zod schemas for tool input validation

import { z } from "zod";
import { httpOnlyUrl } from "../utils/url.js";

/**
 * Schema for structured cURL execution.
 * Validates all parameters for the curl_execute tool.
 */
export const CurlExecuteSchema = z.object({
    url: httpOnlyUrl("The URL to request"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .describe("HTTP method (defaults to GET, or POST if data is provided)"),
    headers: z.record(z.string(), z.string())
        .optional()
        .describe("HTTP headers as key-value pairs (e.g., {\"Content-Type\": \"application/json\"})"),
    data: z.string()
        .optional()
        .describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
    form: z.record(z.string(), z.string())
        .optional()
        .describe("Form data as key-value pairs (uses multipart/form-data)"),
    follow_redirects: z.boolean()
        .default(true)
        .describe("Follow HTTP redirects (default: true)"),
    max_redirects: z.number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Maximum number of redirects to follow"),
    insecure: z.boolean()
        .default(false)
        .describe("Skip SSL certificate verification (default: false)"),
    /**
     * Request timeout in seconds.
     * Optional - if not provided, defaults are applied in this order:
     * 1. McpCurlConfig.defaultTimeout (if configured)
     * 2. LIMITS.DEFAULT_TIMEOUT_MS / 1000 (30 seconds)
     *
     * Note: This field intentionally has no .default() to distinguish between
     * "user explicitly passed 30" vs "user didn't provide a value".
     */
    timeout: z.number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .describe("Request timeout in seconds (default: 30, max: 300)"),
    user_agent: z.string()
        .optional()
        .describe("Custom User-Agent header. If not set, a browser-like User-Agent is sent automatically. Set to empty string to disable."),
    basic_auth: z.string()
        .optional()
        .describe("Basic authentication in format 'username:password'"),
    bearer_token: z.string()
        .optional()
        .describe("Bearer token for Authorization header"),
    verbose: z.boolean()
        .default(false)
        .describe("Include verbose output with request/response details"),
    include_headers: z.boolean()
        .default(false)
        .describe("Include response headers in output"),
    compressed: z.boolean()
        .default(true)
        .describe("Request compressed response and automatically decompress"),
    include_metadata: z.boolean()
        .default(false)
        .describe("Wrap response in JSON with metadata (exit code, success status)"),
    jq_filter: z.string()
        .optional()
        .describe("JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory."),
});

/** Inferred TypeScript type from CurlExecuteSchema */
export type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;

/**
 * Schema for jq_query tool (query JSON files without HTTP requests).
 */
export const JqQuerySchema = z.object({
    filepath: z.string()
        .describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
    jq_filter: z.string()
        .describe("JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save result to file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save result files (must exist and be writable)"),
});

/** Inferred TypeScript type from JqQuerySchema */
export type JqQueryInput = z.infer<typeof JqQuerySchema>;
