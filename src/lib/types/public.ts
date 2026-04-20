// src/lib/types/public.ts
// Public API types for McpCurlServer extensible class

import type { CurlExecuteInput, JqQueryInput } from "../server/schemas.js";

/**
 * Configuration options for McpCurlServer.
 * These settings affect how all tool calls are processed.
 */
export interface McpCurlConfig {
    /** Base URL prepended to relative URLs in curl_execute */
    baseUrl?: string;
    /** Default headers added to all curl_execute requests */
    defaultHeaders?: Record<string, string>;
    /** Default timeout in seconds (1-300) for curl_execute */
    defaultTimeout?: number;
    /** Default output directory for saved responses */
    outputDir?: string;
    /** Default max result size in bytes before auto-saving to file */
    maxResultSize?: number;
    /** Allow localhost requests (overrides MCP_CURL_ALLOW_LOCALHOST env) */
    allowLocalhost?: boolean;
    /** HTTP transport port (default: 3000) */
    port?: number;
    /** HTTP transport bind address (default: "127.0.0.1") */
    host?: string;
    /** HTTP auth token (overrides MCP_AUTH_TOKEN env) */
    authToken?: string;
    /** Allowed origins for HTTP transport Origin header validation (default: localhost) */
    allowedOrigins?: readonly string[];
    /** Default User-Agent for all requests. Empty string disables. */
    defaultUserAgent?: string;
    /** Default Referer for all requests. Empty string disables. */
    defaultReferer?: string;
    /**
     * Wrap responses in per-request sentinel tags to resist prompt injection (spotlighting).
     * Note: does not apply to tools registered via `generateToolDefinitions()` — those tools
     * return filtered JSON directly without passing through the spotlighting wrapper.
     */
    enableSpotlighting?: boolean;
}

/**
 * Context provided to hooks during tool execution.
 * Contains tool name, parameters, session info, and current config.
 */
export interface HookContext<T = CurlExecuteInput | JqQueryInput> {
    /** Which tool is being executed */
    readonly tool: "curl_execute" | "jq_query";
    /** Tool parameters (may be modified by beforeRequest hooks) */
    params: T;
    /** Session ID for HTTP transport, undefined for stdio */
    readonly sessionId?: string;
    /** Current frozen configuration */
    readonly config: Readonly<McpCurlConfig>;
}

/**
 * Result type for beforeRequest hooks.
 * - void: continue with current params
 * - { params }: merge these params into current params
 * - { shortCircuit: true, response }: skip execution, return response immediately
 */
export type BeforeRequestResult<T> =
    | void
    | { params?: Partial<T> }
    | { shortCircuit: true; response: string; isError?: boolean };

/**
 * Hook called before tool execution.
 * Can modify params or short-circuit to return early.
 */
export type BeforeRequestHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T>
) => BeforeRequestResult<T> | Promise<BeforeRequestResult<T>>;

/**
 * Hook called after successful tool execution.
 * Receives the response for logging, metrics, caching, etc.
 */
export type AfterResponseHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T> & { response: string; isError: boolean }
) => void | Promise<void>;

/**
 * Hook called when tool execution throws an error.
 * Receives the error for logging or handling.
 */
export type OnErrorHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T> & { error: Error }
) => void | Promise<void>;

/**
 * Transport mode for the MCP server.
 * - stdio: Standard input/output (default, for CLI usage)
 * - http: HTTP/SSE transport (for web clients)
 */
export type TransportMode = "stdio" | "http";

// Re-export input types for convenience
export type { CurlExecuteInput, JqQueryInput } from "../server/schemas.js";
