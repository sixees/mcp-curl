// src/lib/transports/http.ts
// HTTP transport with session management, Origin validation, and auth middleware

import express, { Request, Response, NextFunction } from "express";
import type { Express } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { cleanupOrphanedTempDirs } from "../files/index.js";
import { startRateLimitCleanup, isValidSessionId, safeStringCompare } from "../security/index.js";
import { SessionManager } from "../session/index.js";
import { SESSION, ENV, LIMITS, parsePort } from "../config/index.js";
import {
    createServer,
    registerAllCapabilities,
    initializeLifecycle,
    setHttpServer,
} from "../server/index.js";

/** Default localhost origins allowed when no explicit allowlist is configured */
const DEFAULT_ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https?:\/\/\[::1\](:\d+)?$/,
];

/** Default bind address for HTTP transport (localhost only, per MCP spec) */
const DEFAULT_HOST = "127.0.0.1";

/**
 * Options for creating an HTTP transport Express app.
 * Used by both the standalone runHTTP() and McpCurlServer.startHttp().
 */
export interface HttpAppOptions {
    /** Factory function to create a configured MCP server for each session */
    createMcpServer: () => McpServer;
    /** Session manager instance */
    sessionManager: SessionManager;
    /** Bearer token for authentication (undefined = no auth required) */
    authToken?: string;
    /** Allowed origins for Origin header validation (undefined = localhost only) */
    allowedOrigins?: readonly string[];
}

/**
 * Create Origin header validation middleware.
 *
 * Per the MCP specification (2025-03-26), servers MUST validate the Origin header
 * on all incoming HTTP connections to prevent DNS rebinding and CSRF attacks.
 *
 * Behavior:
 * - Requests without an Origin header are allowed (non-browser clients like curl, SDKs)
 * - Requests with an Origin header must match the allowed origins list
 * - Default allowed origins: localhost, 127.0.0.1, [::1] on any port
 * - Override via MCP_CURL_ALLOWED_ORIGINS env var or config.allowedOrigins
 */
export function createOriginMiddleware(
    allowedOrigins?: readonly string[]
): (req: Request, res: Response, next: NextFunction) => void {
    // Clone + precompute: explicit list or default localhost patterns
    const explicitOrigins = allowedOrigins ? [...allowedOrigins] : parseAllowedOriginsEnv();
    const useExplicitList = explicitOrigins !== null;
    // Precompute lowercased Set for O(1) lookups
    const allowedOriginSet = useExplicitList
        ? new Set(explicitOrigins!.map((o) => o.toLowerCase()))
        : null;

    return (req: Request, res: Response, next: NextFunction): void => {
        const rawOrigin = req.headers.origin;

        // No Origin header = non-browser client (curl, SDK, etc.) — allow
        if (!rawOrigin) {
            next();
            return;
        }

        // Normalize: if duplicate Origin headers arrive as array, use first value
        const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
        if (!origin) {
            next();
            return;
        }

        if (useExplicitList) {
            // Check against explicit allowlist (case-insensitive, O(1) Set lookup)
            if (allowedOriginSet!.has(origin.toLowerCase())) {
                next();
                return;
            }
        } else {
            // Check against default localhost patterns
            if (DEFAULT_ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
                next();
                return;
            }
        }

        res.status(403).json({
            jsonrpc: "2.0",
            error: {
                code: -32600,
                message: "Forbidden: Origin not allowed",
            },
        });
    };
}

/**
 * Parse MCP_CURL_ALLOWED_ORIGINS env var into an array of origins.
 * Returns null if the env var is not set.
 */
function parseAllowedOriginsEnv(): string[] | null {
    const envValue = process.env[ENV.ALLOWED_ORIGINS];
    if (!envValue) return null;
    return envValue.split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Authentication middleware for HTTP transport.
 *
 * When an auth token is provided, all HTTP requests must include a matching
 * Bearer token in the Authorization header.
 */
export function createAuthMiddleware(
    authToken?: string
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        // If no token configured, allow all requests (backward compatible)
        if (!authToken) {
            next();
            return;
        }

        const authHeader = req.headers.authorization;
        const expectedHeader = `Bearer ${authToken}`;
        if (!authHeader || !safeStringCompare(authHeader, expectedHeader)) {
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
 * Create a configured Express app with MCP HTTP transport routes.
 *
 * This is the shared implementation used by both the standalone runHTTP()
 * function and McpCurlServer.startHttp(). It sets up:
 * - Request body size limit (1MB)
 * - Origin header validation (MCP spec requirement)
 * - Optional bearer token authentication
 * - POST /mcp (create/resume sessions, handle requests)
 * - GET /mcp (SSE streams for existing sessions)
 * - DELETE /mcp (terminate sessions)
 * - Global error handler
 */
export function createHttpApp(options: HttpAppOptions): Express {
    const { createMcpServer, sessionManager, authToken, allowedOrigins } = options;

    const app = express();
    // Limit request body size to prevent DoS
    app.use(express.json({ limit: "1mb" }));

    // Origin header validation (MCP spec MUST requirement)
    const originMiddleware = createOriginMiddleware(allowedOrigins);
    app.use("/mcp", originMiddleware);

    // Apply authentication middleware when token is configured
    const authMiddleware = createAuthMiddleware(authToken);
    app.use("/mcp", authMiddleware);

    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req: Request, res: Response) => {
        try {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

            // Validate session ID format if provided
            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid session ID format" },
                });
                return;
            }

            // Check for existing session
            if (sessionId && sessionManager.has(sessionId)) {
                const session = sessionManager.get(sessionId)!;
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res, req.body);
                return;
            }

            // Check session limit before creating new session
            if (sessionManager.size >= SESSION.MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Server at capacity. Try again later." },
                });
                return;
            }

            // Create new session
            const server = createMcpServer();

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
            });

            // Track session when initialized
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && sessionManager.has(sid)) {
                    sessionManager.delete(sid);
                }
            };

            await server.connect(transport);

            // Store session after connection
            if (transport.sessionId) {
                sessionManager.set(transport.sessionId, {
                    server,
                    transport,
                    lastActivity: Date.now(),
                });
            }

            await transport.handleRequest(req, res, req.body);
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

    // GET /mcp - Handle SSE streams for existing sessions
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
            if (!sessionManager.has(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Session not found" },
                });
                return;
            }
            const session = sessionManager.get(sessionId)!;
            session.lastActivity = Date.now();
            await session.transport.handleRequest(req, res);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req: Request, res: Response, next: NextFunction) => {
        const rawSessionId = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

        // Validate session ID format if provided
        if (sessionId && !isValidSessionId(sessionId)) {
            res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32600, message: "Invalid session ID format" },
            });
            return;
        }

        if (sessionId && sessionManager.has(sessionId)) {
            const session = sessionManager.get(sessionId)!;
            try {
                session.transport.close();
                await session.server.close();
            } catch (error) {
                next(error);
                return;
            } finally {
                sessionManager.delete(sessionId);
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

    return app;
}

/**
 * Format a host for use in a URL. Wraps IPv6 addresses in brackets per RFC 3986.
 */
export function formatHostForUrl(host: string): string {
    if (host.includes(":") && !host.startsWith("[")) {
        return `[${host}]`;
    }
    return host;
}

/**
 * Resolve the HTTP bind host from environment or default.
 */
export function resolveHost(configHost?: string): string {
    return configHost ?? process.env[ENV.HOST] ?? DEFAULT_HOST;
}

/**
 * Run the MCP server with HTTP transport.
 * Enables web-based clients to connect via HTTP/SSE.
 */
export async function runHTTP(): Promise<void> {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();

    // Initialize session manager
    const sessionManager = new SessionManager();
    sessionManager.startCleanup();

    // Start rate limit cleanup and initialize lifecycle
    const rateLimitInterval = startRateLimitCleanup();
    initializeLifecycle(sessionManager, rateLimitInterval);

    const app = createHttpApp({
        createMcpServer: () => {
            const server = createServer();
            registerAllCapabilities(server);
            return server;
        },
        sessionManager,
        authToken: process.env[ENV.AUTH_TOKEN],
    });

    const port = parsePort(process.env.PORT, LIMITS.DEFAULT_HTTP_PORT);
    const host = resolveHost();
    const httpServer = app.listen(port, host);

    httpServer.on("listening", () => {
        console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
    });

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            console.error(`Error: Port ${port} is already in use`);
        } else {
            console.error("Server error:", err);
        }
        process.exit(1);
    });

    // Register for graceful shutdown
    setHttpServer(httpServer);
}
