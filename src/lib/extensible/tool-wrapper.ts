// src/lib/extensible/tool-wrapper.ts
// Wraps tool handlers with hooks and config transforms

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpCurlConfig, CurlExecuteInput, JqQueryInput } from "../types/public.js";
import type { CurlRegisterToolOptions, JqRegisterToolOptions, ToolResult } from "./types.js";
import { executeWithHooks } from "./hook-executor.js";
import { CurlExecuteBaseUrlSchema, CurlExecuteSchema, JqQuerySchema } from "../server/schemas.js";
import {
    CURL_EXECUTE_TOOL_META,
} from "../tools/curl-execute.js";
import {
    JQ_QUERY_TOOL_META,
} from "../tools/jq-query.js";
import { LIMITS, applyDefaultHeaders, JQ_QUERY_HOSTNAME_LABEL } from "../config/index.js";
import { resolveRequestUrl, safeHostname } from "../utils/index.js";
import { createWrapper, markServerAuthored } from "../response/post-processor.js";

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
 * `params.url` arrives already resolved — `resolveRequestUrl` is the one join
 * against `baseUrl`, and the handler calls it first.
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
    const wrap = createWrapper({ enableSpotlighting: config.enableSpotlighting });

    const handler: ToolCallback<typeof CurlExecuteSchema> = async (params, extra) => {
        if (!enabled) {
            return {
                content: [{ type: "text" as const, text: "Error: curl_execute tool is disabled" }],
                isError: true,
            };
        }
        const resolved = resolveRequestUrl(config.baseUrl, params.url);
        if (!resolved.ok) {
            return wrap(
                markServerAuthored({ content: [{ type: "text" as const, text: resolved.error }], isError: true }),
                safeHostname(params.url)
            );
        }
        const transformedParams = applyConfigTransformsCurl({ ...params, url: resolved.url }, config);
        // hostnameOf reads the final params at the wrap boundary inside the
        // hook-executor — `safeHostname` runs once with the post-hook URL,
        // never the stale pre-hook URL. The wrap itself is idempotent so a
        // downstream caller can still re-wrap without double-processing.
        return await executeWithHooks(
            "curl_execute",
            transformedParams,
            config,
            hooks,
            extra.sessionId,
            executor,
            wrap,
            (p) => safeHostname(p.url)
        );
    };

    // A relative `url` is advertised only where something resolves it, and the
    // embedder's append (already sanitised by configure()) only where one is
    // set and the tool can run: a disabled tool is still listed, so an append
    // on it would cost every turn and describe calls that are refused. Every
    // other server keeps the canonical meta object byte for byte.
    const append = enabled ? config.curlExecuteDescriptionAppend : undefined;
    const meta =
        config.baseUrl || append
            ? {
                  ...CURL_EXECUTE_TOOL_META,
                  ...(config.baseUrl && { inputSchema: CurlExecuteBaseUrlSchema }),
                  ...(append && { description: `${CURL_EXECUTE_TOOL_META.description}\n\n${append}` }),
              }
            : CURL_EXECUTE_TOOL_META;
    server.registerTool("curl_execute", meta, handler);
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
    const wrap = createWrapper({ enableSpotlighting: config.enableSpotlighting });

    const handler: ToolCallback<typeof JqQuerySchema> = async (params, extra) => {
        if (!enabled) {
            return {
                content: [{ type: "text" as const, text: "Error: jq_query tool is disabled" }],
                isError: true,
            };
        }
        // jq_query has no tool-specific transforms — only the shared
        // output_dir / max_result_size defaults, applied in place.
        const transformedParams: JqQueryInput = { ...params };
        applySharedConfigDefaults(transformedParams, config);
        return await executeWithHooks(
            "jq_query",
            transformedParams,
            config,
            hooks,
            extra.sessionId,
            executor,
            wrap,
            () => JQ_QUERY_HOSTNAME_LABEL
        );
    };

    // Register using the canonical meta object to preserve type inference
    server.registerTool("jq_query", JQ_QUERY_TOOL_META, handler);
}

