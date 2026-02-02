import type { McpCurlConfig, CurlExecuteInput } from "../types/public.js";
import { type CurlExecuteResult } from "../tools/curl-execute.js";
import { type JqQueryResult } from "../tools/jq-query.js";
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
     */
    executeRequest(params: ExecuteRequestParams): Promise<CurlExecuteResult>;
    /**
     * Query a JSON file with config defaults applied.
     */
    queryFile(filepath: string, jqFilter: string): Promise<JqQueryResult>;
}
/**
 * Create instance utilities that apply config defaults.
 *
 * @param config - Frozen server configuration
 * @returns Object with config-aware utility methods
 */
export declare function createInstanceUtilities(config: Readonly<McpCurlConfig>): InstanceUtilities;
