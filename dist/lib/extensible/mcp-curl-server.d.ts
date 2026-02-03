import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpCurlConfig, TransportMode, BeforeRequestHook, AfterResponseHook, OnErrorHook } from "../types/public.js";
import { type InstanceUtilities } from "./instance-utilities.js";
/**
 * Extensible MCP cURL server with fluent builder API.
 *
 * Provides hooks for request interception, configuration options,
 * and tool management while maintaining backward compatibility.
 *
 * @example
 * ```typescript
 * const server = new McpCurlServer()
 *   .configure({ baseUrl: "https://api.example.com" })
 *   .beforeRequest((ctx) => {
 *     console.log("Request:", ctx.tool, ctx.params);
 *   })
 *   .start("stdio");
 * ```
 */
export declare class McpCurlServer {
    private _config;
    private _frozenConfig;
    private _hooks;
    private _tools;
    private _started;
    private _server;
    private _httpServer;
    private _sessionManager;
    private _rateLimitInterval;
    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start()
     */
    configure(config: Partial<McpCurlConfig>): this;
    /**
     * Disable the curl_execute tool.
     * When disabled, calls to curl_execute return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableCurlExecute(): this;
    /**
     * Disable the jq_query tool.
     * When disabled, calls to jq_query return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableJqQuery(): this;
    /**
     * Register a beforeRequest hook.
     * Hooks run sequentially in registration order before tool execution.
     * Can modify params or short-circuit to return early.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    beforeRequest(hook: BeforeRequestHook): this;
    /**
     * Register an afterResponse hook.
     * Hooks run sequentially after successful tool execution.
     * Useful for logging, metrics, caching.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    afterResponse(hook: AfterResponseHook): this;
    /**
     * Register an onError hook.
     * Hooks run sequentially when tool execution throws.
     * Useful for error logging and reporting.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    onError(hook: OnErrorHook): this;
    /**
     * Get the current (frozen after start) configuration.
     *
     * @returns Readonly configuration object
     */
    getConfig(): Readonly<McpCurlConfig>;
    /**
     * Get config-aware utility methods for direct tool execution.
     * Utilities apply configuration defaults automatically.
     *
     * @returns Instance utilities object
     */
    utilities(): InstanceUtilities;
    /**
     * Get the underlying MCP server instance.
     * Returns null if not yet started.
     *
     * @returns MCP server or null
     */
    getMcpServer(): McpServer | null;
    /**
     * Check if the server has been started.
     *
     * @returns true if started
     */
    isStarted(): boolean;
    /**
     * Start the server with the specified transport.
     * Configuration is frozen after this call.
     *
     * @param transport - Transport mode: "stdio" (default) or "http"
     * @throws Error if already started
     */
    start(transport?: TransportMode): Promise<void>;
    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     */
    shutdown(): Promise<void>;
    /**
     * Create a fully configured MCP server instance.
     * Registers resources, prompts, and tools with hooks applied.
     * Used by both main server initialization and HTTP session creation.
     *
     * @returns Configured McpServer instance
     */
    private createConfiguredServer;
    /**
     * Register tools with hooks applied on a given server.
     *
     * @param server - MCP server to register tools on
     */
    private registerToolsOnServer;
    /**
     * Start stdio transport.
     */
    private startStdio;
    /**
     * Start HTTP transport with session management.
     */
    private startHttp;
    /**
     * Create authentication middleware for HTTP transport.
     */
    private createAuthMiddleware;
    /**
     * Ensure server has not been started.
     * @throws Error if started
     */
    private ensureNotStarted;
}
