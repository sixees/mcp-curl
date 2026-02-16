// src/lib/extensible/instance-utilities.ts
// Config-aware utility methods for direct tool execution
import { executeCurlRequest } from "../tools/curl-execute.js";
import { executeJqQuery } from "../tools/jq-query.js";
import { LIMITS } from "../config/index.js";
/**
 * Create instance utilities that apply config defaults.
 *
 * @param config - Frozen server configuration
 * @returns Object with config-aware utility methods
 */
export function createInstanceUtilities(config) {
    return {
        async executeRequest(params) {
            // Build URL from baseUrl + path if url not provided
            let url = params.url;
            if (!url && params.path && config.baseUrl) {
                const base = config.baseUrl.replace(/\/$/, "");
                const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
                url = `${base}${path}`;
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
            const fullParams = {
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
        async queryFile(filepath, jqFilter) {
            const params = {
                filepath,
                jq_filter: jqFilter,
                max_result_size: config.maxResultSize,
                output_dir: config.outputDir,
            };
            return executeJqQuery(params, {});
        },
    };
}
