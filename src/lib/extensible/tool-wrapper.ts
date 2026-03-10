// src/lib/extensible/tool-wrapper.ts
// Wraps tool handlers with hooks and config transforms

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpCurlConfig, CurlExecuteInput, JqQueryInput } from "../types/public.js";
import type { CurlRegisterToolOptions, JqRegisterToolOptions } from "./types.js";
import { executeWithHooks } from "./hook-executor.js";
import { CurlExecuteSchema, JqQuerySchema } from "../server/schemas.js";
import {
    CURL_EXECUTE_TOOL_META,
} from "../tools/curl-execute.js";
import {
    JQ_QUERY_TOOL_META,
} from "../tools/jq-query.js";
import { LIMITS, applyDefaultHeaders } from "../config/index.js";
import { resolveBaseUrl } from "../utils/index.js";

interface ConfigDefaultableParams {
    output_dir?: string;
    max_result_size?: number;
}

function applySharedConfigDefaults<T extends ConfigDefaultableParams>(
    params: T,
    config: Readonly<McpCurlConfig>
): void {
    if (config.outputDir && !params.output_dir) {
        params.output_dir = config.outputDir;
    }
    if (config.maxResultSize && !params.max_result_size) {
        params.max_result_size = config.maxResultSize;
    }
}

/**
 * Apply configuration transforms to curl_execute parameters.
 * - Prepend baseUrl to relative URLs
 * - Merge defaultHeaders with request headers
 * - Apply default User-Agent and Referer
 * - Apply defaultTimeout if using default
 * - Apply outputDir if not specified
 * - Apply maxResultSize if not specified
 */
export function applyConfigTransformsCurl(
    params: CurlExecuteInput,
    config: Readonly<McpCurlConfig>
): CurlExecuteInput {
    const transformed = { ...params };

    // Prepend baseUrl to relative URLs (URLs not starting with http:// or https://)
    if (config.baseUrl && !params.url.match(/^https?:\/\//i)) {
        transformed.url = resolveBaseUrl(config.baseUrl, params.url);
    }

    // Merge defaultHeaders (request headers take precedence) then apply UA/Referer defaults
    const mergedHeaders: Record<string, string> = { ...config.defaultHeaders, ...params.headers };
    const defaults = applyDefaultHeaders(mergedHeaders, transformed.user_agent, config);
    transformed.headers = defaults.headers;
    if (defaults.userAgent !== undefined) transformed.user_agent = defaults.userAgent;

    // Apply timeout defaults if the user didn't provide a timeout explicitly.
    // Since timeout is optional (no schema default), undefined means no explicit value.
    // Fallback chain: config.defaultTimeout -> system default (30s)
    if (params.timeout === undefined) {
        transformed.timeout = config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1000;
    }

    applySharedConfigDefaults(transformed, config);

    return transformed;
}

/**
 * Apply configuration transforms to jq_query parameters.
 * - Apply outputDir if not specified
 * - Apply maxResultSize if not specified
 */
function applyConfigTransformsJq(
    params: JqQueryInput,
    config: Readonly<McpCurlConfig>
): JqQueryInput {
    const transformed = { ...params };

    applySharedConfigDefaults(transformed, config);

    return transformed;
}

/**
 * Register curl_execute tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export function registerCurlToolWithHooks(
    server: McpServer,
    options: CurlRegisterToolOptions
): void {
    const { executor, enabled, config, hooks } = options;

    // Register using the canonical meta object to preserve type inference
    server.registerTool(
        "curl_execute",
        CURL_EXECUTE_TOOL_META,
        ((params: CurlExecuteInput, extra?: { sessionId?: string }) => {
            // Check if tool is enabled
            if (!enabled) {
                return Promise.resolve({
                    content: [
                        {
                            type: "text" as const,
                            text: "Error: curl_execute tool is disabled",
                        },
                    ],
                    isError: true,
                });
            }

            // Apply config transforms
            const transformedParams = applyConfigTransformsCurl(params, config);

            // Execute with hooks
            return executeWithHooks(
                "curl_execute",
                transformedParams,
                config,
                hooks,
                extra?.sessionId,
                executor
            );
        }) as ToolCallback<typeof CurlExecuteSchema>
    );
}

/**
 * Register jq_query tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export function registerJqToolWithHooks(
    server: McpServer,
    options: JqRegisterToolOptions
): void {
    const { executor, enabled, config, hooks } = options;

    // Register using the canonical meta object to preserve type inference
    server.registerTool(
        "jq_query",
        JQ_QUERY_TOOL_META,
        ((params: JqQueryInput, extra?: { sessionId?: string }) => {
            // Check if tool is enabled
            if (!enabled) {
                return Promise.resolve({
                    content: [
                        {
                            type: "text" as const,
                            text: "Error: jq_query tool is disabled",
                        },
                    ],
                    isError: true,
                });
            }

            // Apply config transforms
            const transformedParams = applyConfigTransformsJq(params, config);

            // Execute with hooks
            return executeWithHooks(
                "jq_query",
                transformedParams,
                config,
                hooks,
                extra?.sessionId,
                executor
            );
        }) as ToolCallback<typeof JqQuerySchema>
    );
}

