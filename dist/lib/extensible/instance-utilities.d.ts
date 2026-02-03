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
export declare function createInstanceUtilities(config: Readonly<McpCurlConfig>): InstanceUtilities;
