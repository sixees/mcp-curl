// src/lib/extensible/mcp-curl-server.ts
// Extensible MCP server class with fluent builder API
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";
import { createInstanceUtilities } from "./instance-utilities.js";
import { registerCurlToolWithHooks, registerJqToolWithHooks } from "./tool-wrapper.js";
import { createServer } from "../server/server-factory.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { executeCurlRequest } from "../tools/curl-execute.js";
import { executeJqQuery } from "../tools/jq-query.js";
import { cleanupOrphanedTempDirs, cleanupTempDir } from "../files/index.js";
import { startRateLimitCleanup, stopRateLimitCleanup, isValidSessionId } from "../security/index.js";
import { SessionManager } from "../session/index.js";
import { SESSION, ENV, LIMITS } from "../config/index.js";
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
     * Get the current (frozen after start) configuration.
     *
     * @returns Readonly configuration object
     */
    getConfig() {
        return this._frozenConfig ?? Object.freeze({ ...this._config });
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
            throw new Error("Server already started. Create a new McpCurlServer instance for a new server.");
        }
        this._started = true;
        this._frozenConfig = Object.freeze({ ...this._config });
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
    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     */
    async shutdown() {
        console.error("Shutting down McpCurlServer...");
        // Close HTTP server if running
        if (this._httpServer) {
            await new Promise((resolve, reject) => {
                this._httpServer.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            }).catch((error) => {
                console.error("Warning: Error closing HTTP server:", error);
            });
        }
        // Close all active sessions
        if (this._sessionManager) {
            this._sessionManager.stopCleanup();
            await this._sessionManager.closeAll();
        }
        // Stop rate limit cleanup
        if (this._rateLimitInterval) {
            stopRateLimitCleanup(this._rateLimitInterval);
        }
        // Clean up temp directory
        await cleanupTempDir();
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
     */
    async startHttp() {
        this._sessionManager = new SessionManager();
        this._sessionManager.startCleanup();
        const app = express();
        app.use(express.json({ limit: "1mb" }));
        // Apply authentication middleware
        const authMiddleware = this.createAuthMiddleware();
        app.use("/mcp", authMiddleware);
        // POST /mcp - Handle MCP requests
        app.post("/mcp", async (req, res) => {
            try {
                const rawSessionId = req.headers["mcp-session-id"];
                const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
                if (sessionId && !isValidSessionId(sessionId)) {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: { code: -32600, message: "Invalid session ID format" },
                    });
                    return;
                }
                if (sessionId && this._sessionManager.has(sessionId)) {
                    const session = this._sessionManager.get(sessionId);
                    session.lastActivity = Date.now();
                    await session.transport.handleRequest(req, res, req.body);
                    return;
                }
                if (this._sessionManager.size >= SESSION.MAX_SESSIONS) {
                    res.status(503).json({
                        jsonrpc: "2.0",
                        error: { code: -32603, message: "Server at capacity. Try again later." },
                    });
                    return;
                }
                // Create new session with a configured server instance
                const sessionServer = this.createConfiguredServer();
                const sessionTransport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: true,
                });
                sessionTransport.onclose = () => {
                    const sid = sessionTransport.sessionId;
                    if (sid && this._sessionManager.has(sid)) {
                        this._sessionManager.delete(sid);
                    }
                };
                await sessionServer.connect(sessionTransport);
                if (sessionTransport.sessionId) {
                    this._sessionManager.set(sessionTransport.sessionId, {
                        server: sessionServer,
                        transport: sessionTransport,
                        lastActivity: Date.now(),
                    });
                }
                await sessionTransport.handleRequest(req, res, req.body);
            }
            catch (error) {
                console.error("MCP request error:", error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        error: { code: -32603, message: "Internal server error" },
                    });
                }
            }
        });
        // GET /mcp - Handle SSE streams
        app.get("/mcp", async (req, res, next) => {
            try {
                const rawSessionId = req.headers["mcp-session-id"];
                const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
                if (!isValidSessionId(sessionId)) {
                    res.status(400).json({ error: "Invalid or missing session ID" });
                    return;
                }
                if (!this._sessionManager.has(sessionId)) {
                    res.status(400).json({ error: "Session not found" });
                    return;
                }
                const session = this._sessionManager.get(sessionId);
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res);
            }
            catch (error) {
                next(error);
            }
        });
        // DELETE /mcp - Terminate session
        app.delete("/mcp", async (req, res, next) => {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid session ID format" },
                });
                return;
            }
            if (sessionId && this._sessionManager.has(sessionId)) {
                const session = this._sessionManager.get(sessionId);
                try {
                    session.transport.close();
                    await session.server.close();
                }
                catch (error) {
                    next(error);
                    return;
                }
                finally {
                    this._sessionManager.delete(sessionId);
                }
            }
            res.status(200).end();
        });
        // Global error handler
        app.use((err, _req, res, _next) => {
            console.error("Unhandled error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                });
            }
        });
        const port = this._frozenConfig.port ?? parseInt(process.env.PORT || String(LIMITS.DEFAULT_HTTP_PORT), 10);
        return new Promise((resolve, reject) => {
            this._httpServer = app.listen(port);
            this._httpServer.on("listening", () => {
                console.error(`cURL MCP server running on http://localhost:${port}/mcp`);
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
     * Create authentication middleware for HTTP transport.
     */
    createAuthMiddleware() {
        const authToken = this._frozenConfig.authToken ?? process.env[ENV.AUTH_TOKEN];
        return (req, res, next) => {
            if (!authToken) {
                next();
                return;
            }
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${authToken}`) {
                res.status(401).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32600,
                        message: "Unauthorized: Invalid or missing authentication token",
                    },
                });
                return;
            }
            next();
        };
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
