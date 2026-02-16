// src/lib/extensible/instance-utilities.ts
// Config-aware utility methods for direct tool execution

import type { McpCurlConfig, CurlExecuteInput, JqQueryInput } from "../types/public.js";
import { executeCurlRequest, type CurlExecuteResult } from "../tools/curl-execute.js";
import { executeJqQuery, type JqQueryResult } from "../tools/jq-query.js";
import { LIMITS } from "../config/index.js";
import { resolveBaseUrl } from "../utils/index.js";

/**
 * Partial curl_execute input with optional path for baseUrl resolution.
 */
export interface ExecuteRequestParams extends Partial<CurlExecuteInput> {
    /** Path to append to baseUrl (alternative to url) */
    path?: string;
}

/**
 * Instance utilities interface returned by McpCurlServer.utilities().
 */
export interface InstanceUtilities {
    /**
     * Execute a cURL request with config defaults applied.
     * Can use `path` with `baseUrl` or provide a full `url`.
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
            // Build URL from baseUrl + path if url not provided
            let url = params.url;
            if (!url && params.path && config.baseUrl) {
                url = resolveBaseUrl(config.baseUrl, params.path);
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

            // Build full params with config defaults
            const fullParams: CurlExecuteInput = {
                url,
                method: params.method,
                headers: { ...config.defaultHeaders, ...params.headers },
                data: params.data,
                form: params.form,
                follow_redirects: params.follow_redirects ?? true,
                max_redirects: params.max_redirects,
                insecure: params.insecure ?? false,
                timeout: params.timeout ?? config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1000,
                user_agent: params.user_agent,
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
