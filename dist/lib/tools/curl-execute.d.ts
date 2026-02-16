import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CurlExecuteInput } from "../server/schemas.js";
/** Tool result type returned by executeCurlRequest */
export interface CurlExecuteResult {
    [key: string]: unknown;
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
}
/** Extra context passed to tool handler */
export interface CurlExecuteExtra {
    sessionId?: string;
    /** Override env var for allowing localhost requests (from McpCurlConfig) */
    allowLocalhost?: boolean;
}
/**
 * Tool metadata for curl_execute.
 * Exported for use by McpCurlServer to register with hooks.
 */
export declare const CURL_EXECUTE_TOOL_META: {
    title: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        url: import("zod").ZodEffects<import("zod").ZodString, string, string>;
        method: import("zod").ZodOptional<import("zod").ZodEnum<["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]>>;
        headers: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>>;
        data: import("zod").ZodOptional<import("zod").ZodString>;
        form: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>>;
        follow_redirects: import("zod").ZodDefault<import("zod").ZodBoolean>;
        max_redirects: import("zod").ZodOptional<import("zod").ZodNumber>;
        insecure: import("zod").ZodDefault<import("zod").ZodBoolean>;
        timeout: import("zod").ZodOptional<import("zod").ZodNumber>;
        user_agent: import("zod").ZodOptional<import("zod").ZodString>;
        basic_auth: import("zod").ZodOptional<import("zod").ZodString>;
        bearer_token: import("zod").ZodOptional<import("zod").ZodString>;
        verbose: import("zod").ZodDefault<import("zod").ZodBoolean>;
        include_headers: import("zod").ZodDefault<import("zod").ZodBoolean>;
        compressed: import("zod").ZodDefault<import("zod").ZodBoolean>;
        include_metadata: import("zod").ZodDefault<import("zod").ZodBoolean>;
        jq_filter: import("zod").ZodOptional<import("zod").ZodString>;
        max_result_size: import("zod").ZodOptional<import("zod").ZodNumber>;
        save_to_file: import("zod").ZodOptional<import("zod").ZodBoolean>;
        output_dir: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        url: string;
        follow_redirects: boolean;
        insecure: boolean;
        verbose: boolean;
        include_headers: boolean;
        compressed: boolean;
        include_metadata: boolean;
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
        headers?: Record<string, string> | undefined;
        data?: string | undefined;
        form?: Record<string, string> | undefined;
        max_redirects?: number | undefined;
        timeout?: number | undefined;
        user_agent?: string | undefined;
        basic_auth?: string | undefined;
        bearer_token?: string | undefined;
        jq_filter?: string | undefined;
        max_result_size?: number | undefined;
        save_to_file?: boolean | undefined;
        output_dir?: string | undefined;
    }, {
        url: string;
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
        headers?: Record<string, string> | undefined;
        data?: string | undefined;
        form?: Record<string, string> | undefined;
        follow_redirects?: boolean | undefined;
        max_redirects?: number | undefined;
        insecure?: boolean | undefined;
        timeout?: number | undefined;
        user_agent?: string | undefined;
        basic_auth?: string | undefined;
        bearer_token?: string | undefined;
        verbose?: boolean | undefined;
        include_headers?: boolean | undefined;
        compressed?: boolean | undefined;
        include_metadata?: boolean | undefined;
        jq_filter?: string | undefined;
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
 * Execute a cURL request with the given parameters.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated curl_execute parameters
 * @param extra - Additional context (sessionId for rate limiting)
 * @returns Tool result with response content
 */
export declare function executeCurlRequest(params: CurlExecuteInput, extra?: CurlExecuteExtra): Promise<CurlExecuteResult>;
/**
 * Registers the curl_execute tool on the MCP server.
 * This tool provides safe, structured HTTP request execution.
 */
export declare function registerCurlExecuteTool(server: McpServer): void;
