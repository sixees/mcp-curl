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
import { SESSION, ENV } from "../config/index.js";
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
     *
     * @returns Readonly configuration object
     */
    getConfig(): Readonly<McpCurlConfig> {
        return this._frozenConfig ?? Object.freeze({ ...this._config });
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
        this._frozenConfig = Object.freeze({ ...this._config });

        // Clean up orphaned temp directories from previous runs
        await cleanupOrphanedTempDirs();

        // Start rate limit cleanup
        this._rateLimitInterval = startRateLimitCleanup();

        // Create and configure MCP server
        this._server = createServer();

        // Register resources and prompts (not affected by hooks)
        registerAllResources(this._server);
        registerAllPrompts(this._server);

        // Register tools with hooks
        this.registerToolsWithHooks();

        // Start appropriate transport
        if (transport === "http") {
            await this.startHttp();
        } else {
            await this.startStdio();
        }
    }

    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     */
    async shutdown(): Promise<void> {
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
     * Register tools with hooks applied.
     */
    private registerToolsWithHooks(): void {
        const config = this._frozenConfig!;

        // Register curl_execute
        registerCurlToolWithHooks(this._server!, {
            executor: executeCurlRequest,
            enabled: this._tools.curl_execute,
            config,
            hooks: this._hooks,
        });

        // Register jq_query
        registerJqToolWithHooks(this._server!, {
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

                // Create new session with a new server instance
                const sessionServer = createServer();
                registerAllResources(sessionServer);
                registerAllPrompts(sessionServer);

                // Register tools with hooks for this session
                registerCurlToolWithHooks(sessionServer, {
                    executor: executeCurlRequest,
                    enabled: this._tools.curl_execute,
                    config: this._frozenConfig!,
                    hooks: this._hooks,
                });
                registerJqToolWithHooks(sessionServer, {
                    executor: executeJqQuery,
                    enabled: this._tools.jq_query,
                    config: this._frozenConfig!,
                    hooks: this._hooks,
                });

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
                    } as Session);
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
                    res.status(400).json({ error: "Invalid or missing session ID" });
                    return;
                }
                if (!this._sessionManager!.has(sessionId)) {
                    res.status(400).json({ error: "Session not found" });
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

        const port = this._frozenConfig!.port ?? parseInt(process.env.PORT || "3000", 10);

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
