// src/lib/extensible/mcp-curl-server.ts
// Extensible MCP server class with fluent builder API
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createInstanceUtilities } from "./instance-utilities.js";
import { registerCurlToolWithHooks, registerJqToolWithHooks } from "./tool-wrapper.js";
import { createServer } from "../server/server-factory.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { executeCurlRequest } from "../tools/curl-execute.js";
import { executeJqQuery } from "../tools/jq-query.js";
import { cleanupOrphanedTempDirs, cleanupTempDir } from "../files/index.js";
import { startRateLimitCleanup, stopRateLimitCleanup } from "../security/index.js";
import { createHttpApp, resolveHost, formatHostForUrl } from "../transports/http.js";
import { SessionManager } from "../session/index.js";
import { ENV, LIMITS, parsePort } from "../config/index.js";
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
export class McpCurlServer {
    _config = {};
    _frozenConfig = null;
    _hooks = {
        beforeRequest: [],
        afterResponse: [],
        onError: [],
    };
    _tools = {
        curl_execute: true,
        jq_query: true,
    };
    _customTools = [];
    _started = false;
    _server = null;
    _httpServer = null;
    _sessionManager = null;
    _rateLimitInterval = null;
    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start()
     */
    configure(config) {
        this.ensureNotStarted("configure()");
        this._config = { ...this._config, ...config };
        return this;
    }
    /**
     * Disable the curl_execute tool.
     * When disabled, calls to curl_execute return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableCurlExecute() {
        this.ensureNotStarted("disableCurlExecute()");
        this._tools.curl_execute = false;
        return this;
    }
    /**
     * Disable the jq_query tool.
     * When disabled, calls to jq_query return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableJqQuery() {
        this.ensureNotStarted("disableJqQuery()");
        this._tools.jq_query = false;
        return this;
    }
    /**
     * Register a beforeRequest hook.
     * Hooks run sequentially in registration order before tool execution.
     * Can modify params or short-circuit to return early.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    beforeRequest(hook) {
        this.ensureNotStarted("beforeRequest()");
        this._hooks.beforeRequest.push(hook);
        return this;
    }
    /**
     * Register an afterResponse hook.
     * Hooks run sequentially after successful tool execution.
     * Useful for logging, metrics, caching.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    afterResponse(hook) {
        this.ensureNotStarted("afterResponse()");
        this._hooks.afterResponse.push(hook);
        return this;
    }
    /**
     * Register an onError hook.
     * Hooks run sequentially when tool execution throws.
     * Useful for error logging and reporting.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    onError(hook) {
        this.ensureNotStarted("onError()");
        this._hooks.onError.push(hook);
        return this;
    }
    /**
     * Register a custom tool.
     * Custom tools are registered on the MCP server during start().
     * Use this to add API-specific tools generated from schema definitions.
     *
     * @param name - Tool name (lowercase with underscores)
     * @param meta - Tool metadata (title, description, inputSchema)
     * @param handler - Tool handler function
     * @returns this for chaining
     * @throws Error if called after start()
     * @throws Error if tool name conflicts with built-in tools
     *
     * @example
     * ```typescript
     * server.registerCustomTool(
     *   "get_user",
     *   {
     *     title: "Get User",
     *     description: "Fetch user by ID",
     *     inputSchema: z.object({ id: z.string() }),
     *   },
     *   async (params) => {
     *     // Handle request
     *     return { content: [{ type: "text", text: "..." }] };
     *   }
     * );
     * ```
     */
    registerCustomTool(name, meta, handler) {
        this.ensureNotStarted("registerCustomTool()");
        // Check for conflicts with built-in tools
        if (name === "curl_execute" || name === "jq_query") {
            throw new Error(`Cannot register custom tool "${name}": conflicts with built-in tool. ` +
                `Use disable${name === "curl_execute" ? "CurlExecute" : "JqQuery"}() first.`);
        }
        // Check for duplicate custom tools
        if (this._customTools.some((t) => t.name === name)) {
            throw new Error(`Custom tool "${name}" is already registered`);
        }
        this._customTools.push({ name, meta, handler });
        return this;
    }
    /**
     * Get the current (frozen after start) configuration.
     * Returns a deep-frozen snapshot to prevent mutation of nested objects.
     *
     * @returns Readonly configuration object
     */
    getConfig() {
        if (this._frozenConfig)
            return this._frozenConfig;
        // Deep freeze to prevent mutation of nested objects like defaultHeaders
        const snapshot = {
            ...this._config,
            defaultHeaders: this._config.defaultHeaders
                ? Object.freeze({ ...this._config.defaultHeaders })
                : undefined,
        };
        return Object.freeze(snapshot);
    }
    /**
     * Get config-aware utility methods for direct tool execution.
     * Utilities apply configuration defaults automatically.
     *
     * @returns Instance utilities object
     */
    utilities() {
        return createInstanceUtilities(this.getConfig());
    }
    /**
     * Get the underlying MCP server instance.
     * Returns null if not yet started.
     *
     * @returns MCP server or null
     */
    getMcpServer() {
        return this._server;
    }
    /**
     * Check if the server has been started.
     *
     * @returns true if started
     */
    isStarted() {
        return this._started;
    }
    /**
     * Start the server with the specified transport.
     * Configuration is frozen after this call.
     *
     * @param transport - Transport mode: "stdio" (default) or "http"
     * @throws Error if already started
     */
    async start(transport = "stdio") {
        if (this._started) {
            throw new Error("Server is already running. Call shutdown() before starting again.");
        }
        this._started = true;
        // Deep freeze to prevent mutation of nested objects like defaultHeaders
        this._frozenConfig = Object.freeze({
            ...this._config,
            defaultHeaders: this._config.defaultHeaders
                ? Object.freeze({ ...this._config.defaultHeaders })
                : undefined,
        });
        try {
            // Clean up orphaned temp directories from previous runs
            await cleanupOrphanedTempDirs();
            // Start rate limit cleanup
            this._rateLimitInterval = startRateLimitCleanup();
            // Create and configure MCP server
            this._server = this.createConfiguredServer();
            // Start appropriate transport
            if (transport === "http") {
                await this.startHttp();
            }
            else {
                await this.startStdio();
            }
        }
        catch (error) {
            // Rollback state on failure to allow retry with new instance
            if (this._rateLimitInterval) {
                stopRateLimitCleanup(this._rateLimitInterval);
                this._rateLimitInterval = null;
            }
            this._server = null;
            this._started = false;
            this._frozenConfig = null;
            throw error;
        }
    }
    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     * Safe to call even if server was never started.
     */
    async shutdown() {
        if (!this._started) {
            return; // Nothing to shut down
        }
        console.error("Shutting down McpCurlServer...");
        // Close HTTP server if running with timeout
        if (this._httpServer) {
            const SHUTDOWN_TIMEOUT = 5000;
            let timeoutId;
            try {
                await Promise.race([
                    new Promise((resolve, reject) => {
                        this._httpServer.close((err) => {
                            if (err)
                                reject(err);
                            else
                                resolve();
                        });
                    }),
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error("HTTP server shutdown timeout")), SHUTDOWN_TIMEOUT);
                    }),
                ]);
            }
            catch (error) {
                console.error("Warning: Error closing HTTP server:", error);
            }
            finally {
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                this._httpServer = null;
            }
        }
        // Close all active sessions (with error handling)
        if (this._sessionManager) {
            this._sessionManager.stopCleanup();
            try {
                await this._sessionManager.closeAll();
            }
            catch (error) {
                console.error("Warning: Error closing sessions:", error);
            }
        }
        // Close main MCP server
        if (this._server) {
            try {
                await this._server.close();
            }
            catch (error) {
                console.error("Warning: Error closing MCP server:", error);
            }
            finally {
                this._server = null;
            }
        }
        // Stop rate limit cleanup
        if (this._rateLimitInterval) {
            stopRateLimitCleanup(this._rateLimitInterval);
        }
        // Clean up temp directory
        await cleanupTempDir();
        // Reset state to allow potential reuse
        this._started = false;
        this._frozenConfig = null;
        this._rateLimitInterval = null;
        this._sessionManager = null;
    }
    /**
     * Create a fully configured MCP server instance.
     * Registers resources, prompts, and tools with hooks applied.
     * Used by both main server initialization and HTTP session creation.
     *
     * @returns Configured McpServer instance
     */
    createConfiguredServer() {
        const server = createServer();
        registerAllResources(server);
        registerAllPrompts(server);
        this.registerToolsOnServer(server);
        return server;
    }
    /**
     * Register tools with hooks applied on a given server.
     *
     * @param server - MCP server to register tools on
     */
    registerToolsOnServer(server) {
        const config = this._frozenConfig;
        registerCurlToolWithHooks(server, {
            executor: executeCurlRequest,
            enabled: this._tools.curl_execute,
            config,
            hooks: this._hooks,
        });
        registerJqToolWithHooks(server, {
            executor: executeJqQuery,
            enabled: this._tools.jq_query,
            config,
            hooks: this._hooks,
        });
        // Register custom tools
        for (const { name, meta, handler } of this._customTools) {
            server.registerTool(name, meta, handler);
        }
    }
    /**
     * Start stdio transport.
     */
    async startStdio() {
        const transport = new StdioServerTransport();
        await this._server.connect(transport);
        console.error("cURL MCP server running on stdio");
    }
    /**
     * Start HTTP transport with session management.
     * Delegates to shared createHttpApp() for route setup, auth, and Origin validation.
     */
    async startHttp() {
        this._sessionManager = new SessionManager();
        this._sessionManager.startCleanup();
        const app = createHttpApp({
            createMcpServer: () => this.createConfiguredServer(),
            sessionManager: this._sessionManager,
            authToken: this._frozenConfig.authToken ?? process.env[ENV.AUTH_TOKEN],
            allowedOrigins: this._frozenConfig.allowedOrigins,
        });
        const port = this._frozenConfig.port ?? parsePort(process.env.PORT, LIMITS.DEFAULT_HTTP_PORT);
        const host = resolveHost(this._frozenConfig.host);
        return new Promise((resolve, reject) => {
            this._httpServer = app.listen(port, host);
            this._httpServer.on("listening", () => {
                console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
                resolve();
            });
            this._httpServer.on("error", (err) => {
                if (err.code === "EADDRINUSE") {
                    reject(new Error(`Port ${port} is already in use`));
                }
                else {
                    reject(err);
                }
            });
        });
    }
    /**
     * Ensure server has not been started.
     * @throws Error if started
     */
    ensureNotStarted(method) {
        if (this._started) {
            throw new Error(`Cannot call ${method} after server has started`);
        }
    }
}
