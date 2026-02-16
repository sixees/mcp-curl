// src/lib/tools/jq-query.ts
// Registers the jq_query tool for querying JSON files

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "fs/promises";
import { join, basename } from "path";
import { JqQuerySchema, type JqQueryInput } from "../server/schemas.js";
import { LIMITS } from "../config/index.js";
import { getOrCreateTempDir, resolveOutputDir, validateOutputDir } from "../files/index.js";
import { validateFilePath } from "../security/index.js";
import { applyJqFilter } from "../jq/index.js";
import { getErrorMessage } from "../utils/index.js";
import { createSafeFilenameBase } from "../response/index.js";

/** Tool result type returned by executeJqQuery */
export interface JqQueryResult {
    [key: string]: unknown;
    content: [{ type: "text"; text: string }];
    isError?: boolean;
}

/** Extra context passed to tool handler */
export interface JqQueryExtra {
    sessionId?: string;
}

/**
 * Tool metadata for jq_query.
 * Exported for use by McpCurlServer to register with hooks.
 */
export const JQ_QUERY_TOOL_META = {
    title: "Query JSON File",
    description: `Query an existing JSON file with a jq-like filter expression.

This tool allows you to extract data from saved JSON files without making new HTTP requests.
Useful for:
- Extracting different fields from a large saved response
- Applying multiple queries to the same data
- Processing any local JSON file within allowed directories

Args:
  - filepath (string, required): Path to a JSON file to query
  - jq_filter (string, required): JSON path filter expression
  - max_result_size (number): Max bytes inline (default: 500KB, max: 1MB)
  - save_to_file (boolean): Force save result to file
  - output_dir (string): Custom directory to save result files

Filter Syntax:
  - .key - Get object property
  - .[n] - Get array element at index n (non-negative only, also .n with dot notation)
  - .[n:m] - Array slice from n to m
  - .["key"] - Bracket notation for keys with special chars
  - .name,.email - Multiple comma-separated paths (returns array of values, max 20)
  - Note: Negative indices not supported (unlike real jq)

Security:
  - Only files in these directories can be read:
    1. Our temp directory (files saved by curl_execute)
    2. MCP_CURL_OUTPUT_DIR environment variable path
    3. Current working directory and ALL subdirectories (broad - ensure cwd is safe)
  - Maximum file size: 10MB

Examples:
  - Extract name: { "filepath": "/path/to/response.txt", "jq_filter": ".name" }
  - Multiple fields: { "filepath": "/path/to/data.json", "jq_filter": ".name,.email,.id" }
  - Array slice: { "filepath": "/path/to/list.json", "jq_filter": ".items[0:5]" }`,
    inputSchema: JqQuerySchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
};

/**
 * Execute a jq query on a JSON file.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated jq_query parameters
 * @param _extra - Additional context (sessionId, unused but kept for consistency)
 * @returns Tool result with query result content
 */
export async function executeJqQuery(
    params: JqQueryInput,
    _extra: JqQueryExtra
): Promise<JqQueryResult> {
    try {
        // Validate file path and get the real path (prevents TOCTOU attacks)
        const validatedFilePath = await validateFilePath(params.filepath);

        // Resolve and validate output directory if saving (returns real path with symlinks resolved)
        const resolvedOutputDir = resolveOutputDir(params.output_dir);
        const validatedOutputDir = resolvedOutputDir
            ? await validateOutputDir(resolvedOutputDir)
            : undefined;

        // Read the file using the validated real path
        const content = await readFile(validatedFilePath, { encoding: "utf-8" });

        // Apply jq filter
        const filtered = applyJqFilter(content, params.jq_filter);

        // Handle result size and file saving
        const maxSize = params.max_result_size ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
        const contentBytes = Buffer.byteLength(filtered, "utf8");
        const shouldSave = params.save_to_file || contentBytes > maxSize;

        if (shouldSave) {
            // Generate a filename based on the source file (use validated path)
            const sourceBasename = basename(validatedFilePath) || "query_result";
            const safeName = createSafeFilenameBase(sourceBasename, "query_result");
            const filename = `${safeName}_${Date.now()}.txt`;
            const targetDir = validatedOutputDir ?? await getOrCreateTempDir();
            const filepath = join(targetDir, filename);

            await writeFile(filepath, filtered, { encoding: "utf-8", mode: 0o600 });

            return {
                content: [
                    {
                        type: "text",
                        text: `Result (${contentBytes} bytes) saved to: ${filepath}`,
                    },
                ],
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: filtered,
                },
            ],
        };
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        const errorClass = error instanceof Error ? error.constructor.name : "Error";
        console.error(`jq_query error: [${basename(params.filepath)}] ${errorClass}`);
        return {
            content: [
                {
                    type: "text",
                    text: `Error querying JSON file: ${errorMessage}`,
                },
            ],
            isError: true,
        };
    }
}

/**
 * Registers the jq_query tool on the MCP server.
 * This tool allows querying JSON files without making new HTTP requests.
 */
export function registerJqQueryTool(server: McpServer): void {
    server.registerTool(
        "jq_query",
        JQ_QUERY_TOOL_META,
        async (params: JqQueryInput, extra: JqQueryExtra) => executeJqQuery(params, extra)
    );
}
