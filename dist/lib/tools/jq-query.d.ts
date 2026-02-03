import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type JqQueryInput } from "../server/schemas.js";
/** Tool result type returned by executeJqQuery */
export interface JqQueryResult {
    [key: string]: unknown;
    content: [{
        type: "text";
        text: string;
    }];
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
export declare const JQ_QUERY_TOOL_META: {
    title: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        filepath: import("zod").ZodString;
        jq_filter: import("zod").ZodString;
        max_result_size: import("zod").ZodOptional<import("zod").ZodNumber>;
        save_to_file: import("zod").ZodOptional<import("zod").ZodBoolean>;
        output_dir: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        jq_filter: string;
        filepath: string;
        max_result_size?: number | undefined;
        save_to_file?: boolean | undefined;
        output_dir?: string | undefined;
    }, {
        jq_filter: string;
        filepath: string;
        max_result_size?: number | undefined;
        save_to_file?: boolean | undefined;
        output_dir?: string | undefined;
    }>;
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
};
/**
 * Execute a jq query on a JSON file.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated jq_query parameters
 * @param _extra - Additional context (sessionId, unused but kept for consistency)
 * @returns Tool result with query result content
 */
export declare function executeJqQuery(params: JqQueryInput, _extra: JqQueryExtra): Promise<JqQueryResult>;
/**
 * Registers the jq_query tool on the MCP server.
 * This tool allows querying JSON files without making new HTTP requests.
 */
export declare function registerJqQueryTool(server: McpServer): void;
