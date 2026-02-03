// src/lib/extensible/mcp-curl-server.ts
// Extensible MCP server class with fluent builder API

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

import type {
    McpCurlConfig,
    TransportMode,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,
} from "../types/public.js";
import type { Hooks } from "./types.js";
import { createInstanceUtilities, type InstanceUtilities } from "./instance-utilities.js";
import { registerCurlToolWithHooks, registerJqToolWithHooks } from "./tool-wrapper.js";

import { createServer } from "../server/server-factory.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { executeCurlRequest } from "../tools/curl-execute.js";
import { executeJqQuery } from "../tools/jq-query.js";
import { cleanupOrphanedTempDirs, cleanupTempDir } from "../files/index.js";
import { startRateLimitCleanup, stopRateLimitCleanup, isValidSessionId } from "../security/index.js";
import { SessionManager } from "../session/index.js";
import { SESSION, ENV, LIMITS, parsePort } from "../config/index.js";
import type { Session } from "../types/session.js";

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
    private _config: McpCurlConfig = {};
    private _frozenConfig: Readonly<McpCurlConfig> | null = null;
    private _hooks: Hooks = {
        beforeRequest: [],
        afterResponse: [],
        onError: [],
    };
    private _tools = {
        curl_execute: true,
        jq_query: true,
    };
    private _started = false;
    private _server: McpServer | null = null;
    private _httpServer: Server | null = null;
    private _sessionManager: SessionManager | null = null;
    private _rateLimitInterval: NodeJS.Timeout | null = null;

    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start()
     */
    configure(config: Partial<McpCurlConfig>): this {
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
    disableCurlExecute(): this {
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
    disableJqQuery(): this {
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
    beforeRequest(hook: BeforeRequestHook): this {
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
    afterResponse(hook: AfterResponseHook): this {
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
    onError(hook: OnErrorHook): this {
        this.ensureNotStarted("onError()");
        this._hooks.onError.push(hook);
        return this;
    }

    /**
     * Get the current (frozen after start) configuration.
     * Returns a deep-frozen snapshot to prevent mutation of nested objects.
     *
     * @returns Readonly configuration object
     */
    getConfig(): Readonly<McpCurlConfig> {
        if (this._frozenConfig) return this._frozenConfig;
        // Deep freeze to prevent mutation of nested objects like defaultHeaders
        const snapshot: McpCurlConfig = {
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
    utilities(): InstanceUtilities {
        return createInstanceUtilities(this.getConfig());
    }

    /**
     * Get the underlying MCP server instance.
     * Returns null if not yet started.
     *
     * @returns MCP server or null
     */
    getMcpServer(): McpServer | null {
        return this._server;
    }

    /**
     * Check if the server has been started.
     *
     * @returns true if started
     */
    isStarted(): boolean {
        return this._started;
    }

    /**
     * Start the server with the specified transport.
     * Configuration is frozen after this call.
     *
     * @param transport - Transport mode: "stdio" (default) or "http"
     * @throws Error if already started
     */
    async start(transport: TransportMode = "stdio"): Promise<void> {
        if (this._started) {
            throw new Error("Server already started. Create a new McpCurlServer instance for a new server.");
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
            } else {
                await this.startStdio();
            }
        } catch (error) {
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
    async shutdown(): Promise<void> {
        if (!this._started) {
            return; // Nothing to shut down
        }
        console.error("Shutting down McpCurlServer...");

        // Close HTTP server if running
        if (this._httpServer) {
            await new Promise<void>((resolve, reject) => {
                this._httpServer!.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            }).catch((error) => {
                console.error("Warning: Error closing HTTP server:", error);
            });
        }

        // Close all active sessions (with error handling)
        if (this._sessionManager) {
            this._sessionManager.stopCleanup();
            try {
                await this._sessionManager.closeAll();
            } catch (error) {
                console.error("Warning: Error closing sessions:", error);
            }
        }

        // Close main MCP server
        if (this._server) {
            try {
                await this._server.close();
            } catch (error) {
                console.error("Warning: Error closing MCP server:", error);
            } finally {
                this._server = null;
            }
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
    private createConfiguredServer(): McpServer {
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
    private registerToolsOnServer(server: McpServer): void {
        const config = this._frozenConfig!;

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
    private async startStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this._server!.connect(transport);
        console.error("cURL MCP server running on stdio");
    }

    /**
     * Start HTTP transport with session management.
     */
    private async startHttp(): Promise<void> {
        this._sessionManager = new SessionManager();
        this._sessionManager.startCleanup();

        const app = express();
        app.use(express.json({ limit: "1mb" }));

        // Apply authentication middleware
        const authMiddleware = this.createAuthMiddleware();
        app.use("/mcp", authMiddleware);

        // POST /mcp - Handle MCP requests
        app.post("/mcp", async (req: Request, res: Response) => {
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

                if (sessionId && this._sessionManager!.has(sessionId)) {
                    const session = this._sessionManager!.get(sessionId)!;
                    session.lastActivity = Date.now();
                    await session.transport.handleRequest(req, res, req.body);
                    return;
                }

                if (this._sessionManager!.size >= SESSION.MAX_SESSIONS) {
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
                    if (sid && this._sessionManager!.has(sid)) {
                        this._sessionManager!.delete(sid);
                    }
                };

                await sessionServer.connect(sessionTransport);

                if (sessionTransport.sessionId) {
                    this._sessionManager!.set(sessionTransport.sessionId, {
                        server: sessionServer,
                        transport: sessionTransport,
                        lastActivity: Date.now(),
                    });
                }

                await sessionTransport.handleRequest(req, res, req.body);
            } catch (error) {
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
        app.get("/mcp", async (req: Request, res: Response, next: NextFunction) => {
            try {
                const rawSessionId = req.headers["mcp-session-id"];
                const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
                if (!isValidSessionId(sessionId)) {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: { code: -32600, message: "Invalid or missing session ID" },
                    });
                    return;
                }
                if (!this._sessionManager!.has(sessionId)) {
                    res.status(400).json({
                        jsonrpc: "2.0",
                        error: { code: -32600, message: "Session not found" },
                    });
                    return;
                }
                const session = this._sessionManager!.get(sessionId)!;
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res);
            } catch (error) {
                next(error);
            }
        });

        // DELETE /mcp - Terminate session
        app.delete("/mcp", async (req: Request, res: Response, next: NextFunction) => {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid session ID format" },
                });
                return;
            }

            if (sessionId && this._sessionManager!.has(sessionId)) {
                const session = this._sessionManager!.get(sessionId)!;
                try {
                    session.transport.close();
                    await session.server.close();
                } catch (error) {
                    next(error);
                    return;
                } finally {
                    this._sessionManager!.delete(sessionId);
                }
            }
            res.status(200).end();
        });

        // Global error handler
        app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
            console.error("Unhandled error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                });
            }
        });

        const port = this._frozenConfig!.port ?? parsePort(process.env.PORT, LIMITS.DEFAULT_HTTP_PORT);

        return new Promise((resolve, reject) => {
            this._httpServer = app.listen(port);

            this._httpServer.on("listening", () => {
                console.error(`cURL MCP server running on http://localhost:${port}/mcp`);
                resolve();
            });

            this._httpServer.on("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE") {
                    reject(new Error(`Port ${port} is already in use`));
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Create authentication middleware for HTTP transport.
     */
    private createAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
        const authToken = this._frozenConfig!.authToken ?? process.env[ENV.AUTH_TOKEN];

        return (req: Request, res: Response, next: NextFunction): void => {
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
    private ensureNotStarted(method: string): void {
        if (this._started) {
            throw new Error(`Cannot call ${method} after server has started`);
        }
    }
}
