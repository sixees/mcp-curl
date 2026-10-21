// src/lib/extensible/instance-utilities.ts
// Config-aware utility methods for direct tool execution

import type { McpCurlConfig, CurlExecuteInput, JqQueryInput } from "../types/public.js";
import { executeCurlRequest, type CurlExecuteResult } from "../tools/curl-execute.js";
import { executeJqQuery, type JqQueryResult } from "../tools/jq-query.js";
import { LIMITS, applyDefaultHeaders } from "../config/index.js";
import { resolveRequestUrl } from "../utils/index.js";

/**
 * Partial curl_execute input with optional path for baseUrl resolution.
 */
export interface ExecuteRequestParams extends Partial<CurlExecuteInput> {
    /**
     * Path to append to `baseUrl` (alternative to `url`). A missing leading `/`
     * is added; after that it must start with a single `/` and contain no
     * control characters, or the call returns an error result. A leading `//`,
     * `\` or `/\` is refused, never joined.
     */
    path?: string;
}

/**
 * Instance utilities interface returned by McpCurlServer.utilities().
 */
export interface InstanceUtilities {
    /**
     * Execute a cURL request with config defaults applied.
     * Takes an absolute `url`; with `baseUrl` configured, also a `url` starting
     * with `/` or a `path`, both resolved by `resolveRequestUrl`. A relative
     * value that starts `//`, `\` or `/\`, or holds a control character, is
     * refused with an error result rather than requested.
     *
     * NOTE: This method calls executeCurlRequest directly and bypasses the hook
     * system (beforeRequest, afterResponse, onError). Use MCP tool invocation
     * if you need hooks to execute.
     */
    executeRequest(params: ExecuteRequestParams): Promise<CurlExecuteResult>;

    /**
     * Query a JSON file with config defaults applied.
     *
     * NOTE: This method calls executeJqQuery directly and bypasses the hook
     * system. Use MCP tool invocation if you need hooks to execute.
     */
    queryFile(filepath: string, jqFilter: string): Promise<JqQueryResult>;
}

/**
 * Create instance utilities that apply config defaults.
 *
 * @param config - Frozen server configuration
 * @returns Object with config-aware utility methods
 */
export function createInstanceUtilities(config: Readonly<McpCurlConfig>): InstanceUtilities {
    return {
        async executeRequest(params: ExecuteRequestParams): Promise<CurlExecuteResult> {
            // `url` wins over `path`. `path` tolerates a missing leading slash
            // ("users" reaches <baseUrl>/users), so it gains one here; both then
            // take the one resolver the tool path uses.
            let url = params.url;
            if (!url && params.path && config.baseUrl) {
                url = params.path.startsWith("/") ? params.path : `/${params.path}`;
            }
            if (!url) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: Must provide url or path (with baseUrl configured)",
                        },
                    ],
                    isError: true,
                };
            }

            const resolved = resolveRequestUrl(config.baseUrl, url);
            if (!resolved.ok) {
                return { content: [{ type: "text", text: resolved.error }], isError: true };
            }

            // Merge headers and apply UA/Referer defaults
            const mergedHeaders: Record<string, string> = { ...config.defaultHeaders, ...params.headers };
            const defaults = applyDefaultHeaders(mergedHeaders, params.user_agent, config);

            // Build full params with config defaults
            const fullParams: CurlExecuteInput = {
                url: resolved.url,
                method: params.method,
                headers: defaults.headers,
                data: params.data,
                form: params.form,
                follow_redirects: params.follow_redirects ?? true,
                max_redirects: params.max_redirects,
                insecure: params.insecure ?? false,
                timeout: params.timeout ?? config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1000,
                user_agent: defaults.userAgent,
                basic_auth: params.basic_auth,
                bearer_token: params.bearer_token,
                verbose: params.verbose ?? false,
                include_headers: params.include_headers ?? false,
                compressed: params.compressed ?? true,
                include_metadata: params.include_metadata ?? false,
                jq_filter: params.jq_filter,
                max_result_size: params.max_result_size ?? config.maxResultSize,
                save_to_file: params.save_to_file,
                output_dir: params.output_dir ?? config.outputDir,
            };

            return executeCurlRequest(fullParams, { allowLocalhost: config.allowLocalhost });
        },

        async queryFile(filepath: string, jqFilter: string): Promise<JqQueryResult> {
            const params: JqQueryInput = {
                filepath,
                jq_filter: jqFilter,
                max_result_size: config.maxResultSize,
                output_dir: config.outputDir,
            };

            return executeJqQuery(params, {});
        },
    };
}
