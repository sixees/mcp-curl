// src/lib/extensible/tool-wrapper.ts
// Wraps tool handlers with hooks and config transforms
import { executeWithHooks } from "./hook-executor.js";
import { CURL_EXECUTE_TOOL_META, } from "../tools/curl-execute.js";
import { JQ_QUERY_TOOL_META, } from "../tools/jq-query.js";
import { LIMITS } from "../config/index.js";
/**
 * Apply configuration transforms to curl_execute parameters.
 * - Prepend baseUrl to relative URLs
 * - Merge defaultHeaders with request headers
 * - Apply defaultTimeout if using default
 * - Apply outputDir if not specified
 * - Apply maxResultSize if not specified
 */
function applyConfigTransformsCurl(params, config) {
    const transformed = { ...params };
    // Prepend baseUrl to relative URLs (URLs not starting with http:// or https://)
    if (config.baseUrl && !params.url.match(/^https?:\/\//i)) {
        const base = config.baseUrl.replace(/\/$/, "");
        const path = params.url.startsWith("/") ? params.url : `/${params.url}`;
        transformed.url = `${base}${path}`;
    }
    // Merge defaultHeaders (request headers take precedence)
    if (config.defaultHeaders) {
        transformed.headers = { ...config.defaultHeaders, ...params.headers };
    }
    // Apply timeout defaults if the user didn't provide a timeout explicitly.
    // Since timeout is optional (no schema default), undefined means no explicit value.
    // Fallback chain: config.defaultTimeout -> system default (30s)
    if (params.timeout === undefined) {
        transformed.timeout = config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1000;
    }
    // Apply outputDir if not specified
    if (config.outputDir && !params.output_dir) {
        transformed.output_dir = config.outputDir;
    }
    // Apply maxResultSize if not specified
    if (config.maxResultSize && !params.max_result_size) {
        transformed.max_result_size = config.maxResultSize;
    }
    return transformed;
}
/**
 * Apply configuration transforms to jq_query parameters.
 * - Apply outputDir if not specified
 * - Apply maxResultSize if not specified
 */
function applyConfigTransformsJq(params, config) {
    const transformed = { ...params };
    // Apply outputDir if not specified
    if (config.outputDir && !params.output_dir) {
        transformed.output_dir = config.outputDir;
    }
    // Apply maxResultSize if not specified
    if (config.maxResultSize && !params.max_result_size) {
        transformed.max_result_size = config.maxResultSize;
    }
    return transformed;
}
/**
 * Register curl_execute tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export function registerCurlToolWithHooks(server, options) {
    const { executor, enabled, config, hooks } = options;
    // Register using the canonical meta object to preserve type inference
    server.registerTool("curl_execute", CURL_EXECUTE_TOOL_META, ((params, extra) => {
        // Check if tool is enabled
        if (!enabled) {
            return Promise.resolve({
                content: [
                    {
                        type: "text",
                        text: "Error: curl_execute tool is disabled",
                    },
                ],
                isError: true,
            });
        }
        // Apply config transforms
        const transformedParams = applyConfigTransformsCurl(params, config);
        // Execute with hooks
        return executeWithHooks("curl_execute", transformedParams, config, hooks, extra.sessionId, executor);
    }));
}
/**
 * Register jq_query tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export function registerJqToolWithHooks(server, options) {
    const { executor, enabled, config, hooks } = options;
    // Register using the canonical meta object to preserve type inference
    server.registerTool("jq_query", JQ_QUERY_TOOL_META, ((params, extra) => {
        // Check if tool is enabled
        if (!enabled) {
            return Promise.resolve({
                content: [
                    {
                        type: "text",
                        text: "Error: jq_query tool is disabled",
                    },
                ],
                isError: true,
            });
        }
        // Apply config transforms
        const transformedParams = applyConfigTransformsJq(params, config);
        // Execute with hooks
        return executeWithHooks("jq_query", transformedParams, config, hooks, extra.sessionId, executor);
    }));
}
/**
 * Register a tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param toolName - Name of the tool to register
 * @param options - Tool registration options
 */
export function registerToolWithHooks(server, toolName, options) {
    switch (toolName) {
        case "curl_execute":
            registerCurlToolWithHooks(server, options);
            break;
        case "jq_query":
            registerJqToolWithHooks(server, options);
            break;
        default: {
            // Exhaustive check - TypeScript will error if a ToolName case is missed
            const _exhaustive = toolName;
            throw new Error(`Unknown tool: ${_exhaustive}`);
        }
    }
}
