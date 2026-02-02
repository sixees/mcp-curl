// src/lib/transports/http.ts
// HTTP transport runner with session management
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { cleanupOrphanedTempDirs } from "../files/index.js";
import { startRateLimitCleanup, isValidSessionId } from "../security/index.js";
import { SessionManager } from "../session/index.js";
import { SESSION, ENV } from "../config/index.js";
import { createServer, registerAllCapabilities, initializeLifecycle, setHttpServer, } from "../server/index.js";
/**
 * Authentication middleware for HTTP transport.
 *
 * When MCP_AUTH_TOKEN is set, all HTTP requests must include a matching
 * Bearer token in the Authorization header. This prevents unauthorized
 * clients from accessing the MCP server when running in HTTP mode.
 *
 * Usage: Set MCP_AUTH_TOKEN=your-secret-token in the environment.
 */
export function createAuthMiddleware() {
    const authToken = process.env[ENV.AUTH_TOKEN];
    return (req, res, next) => {
        // If no token configured, allow all requests (backward compatible)
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
 * Run the MCP server with HTTP transport.
 * Enables web-based clients to connect via HTTP/SSE.
 */
export async function runHTTP() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    // Initialize session manager
    const sessionManager = new SessionManager();
    sessionManager.startCleanup();
    // Start rate limit cleanup and initialize lifecycle
    const rateLimitInterval = startRateLimitCleanup();
    initializeLifecycle(sessionManager, rateLimitInterval);
    const app = express();
    // Limit request body size to prevent DoS
    app.use(express.json({ limit: "1mb" }));
    // Apply authentication middleware to all /mcp routes when token is configured
    const authMiddleware = createAuthMiddleware();
    app.use("/mcp", authMiddleware);
    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req, res) => {
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
                const session = sessionManager.get(sessionId);
                session.lastActivity = Date.now(); // Update activity timestamp
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
            const server = createServer();
            registerAllCapabilities(server);
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
    // GET /mcp - Handle SSE streams for existing sessions
    app.get("/mcp", async (req, res, next) => {
        try {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
            if (!isValidSessionId(sessionId)) {
                res.status(400).json({ error: "Invalid or missing session ID" });
                return;
            }
            if (!sessionManager.has(sessionId)) {
                res.status(400).json({ error: "Session not found" });
                return;
            }
            const session = sessionManager.get(sessionId);
            session.lastActivity = Date.now(); // Update activity timestamp
            await session.transport.handleRequest(req, res);
        }
        catch (error) {
            next(error);
        }
    });
    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req, res, next) => {
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
            const session = sessionManager.get(sessionId);
            try {
                session.transport.close();
                await session.server.close();
            }
            catch (error) {
                next(error);
                return;
            }
            finally {
                sessionManager.delete(sessionId);
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
    const port = parseInt(process.env.PORT || "3000", 10);
    const httpServer = app.listen(port);
    httpServer.on("listening", () => {
        console.error(`cURL MCP server running on http://localhost:${port}/mcp`);
    });
    httpServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`Error: Port ${port} is already in use`);
        }
        else {
            console.error("Server error:", err);
        }
        process.exit(1);
    });
    // Register for graceful shutdown
    setHttpServer(httpServer);
}
