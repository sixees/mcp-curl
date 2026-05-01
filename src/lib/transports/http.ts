// src/lib/transports/http.ts
// HTTP transport with session management, Origin validation, and auth middleware

import express, { Request, Response, NextFunction } from "express";
import type { Express } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { cleanupOrphanedTempDirs } from "../files/index.js";
import {
    startRateLimitCleanup,
    startInjectionCleanup,
    isValidSessionId,
    safeStringCompare,
} from "../security/index.js";
import { SessionManager } from "../session/index.js";
import { SESSION, ENV, LIMITS, parsePort, PRINTABLE_ASCII } from "../config/index.js";
import {
    createServer,
    registerAllCapabilities,
    initializeLifecycle,
    setHttpServer,
} from "../server/index.js";
import { createConfigError } from "../utils/index.js";

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
 * Validate an operator-supplied HTTP transport auth token at startup.
 *
 * Rejects tokens that are not printable ASCII (0x20–0x7E) or that exceed
 * `LIMITS.MAX_AUTH_TOKEN_LENGTH`. The intent is to fail loudly during boot
 * so a misconfigured operator sees the error before the server starts
 * accepting connections — never silently letting a CRLF, NUL, or
 * accidentally-pasted blob flow into the `Bearer ${token}` header check.
 *
 * Undefined or empty tokens are accepted (auth is optional — see
 * `createAuthMiddleware`); callers that require a token should enforce that
 * separately.
 *
 * The token value is **never** echoed in error messages. Length and a
 * `[redacted]` marker are surfaced to operators instead, so the rejection
 * is debuggable without leaking entropy into logs.
 *
 * @throws Error from `createConfigError("MCP_AUTH_TOKEN", …)` if the token
 *   is too long or contains a non-printable byte.
 */
export function validateAuthToken(token: string | undefined): void {
    if (token === undefined || token === "") return;
    if (token.length > LIMITS.MAX_AUTH_TOKEN_LENGTH) {
        throw createConfigError(
            ENV.AUTH_TOKEN,
            `[length=${token.length}]`,
            `exceeds maximum ${LIMITS.MAX_AUTH_TOKEN_LENGTH} characters`,
        );
    }
    if (!PRINTABLE_ASCII.test(token)) {
        throw createConfigError(
            ENV.AUTH_TOKEN,
            "[redacted]",
            "must contain only printable ASCII characters (0x20–0x7E)",
        );
    }
}

/**
 * Authentication middleware for HTTP transport.
 *
 * When an auth token is provided, all HTTP requests must include a matching
 * Bearer token in the Authorization header.
 *
 * The expected `Bearer <token>` string is built once at middleware
 * construction (closure capture) so the per-request hot path does no
 * string allocation. A length pre-check rejects oversized headers before
 * `safeStringCompare` allocates padded buffers, bounding the per-request
 * allocation to `expectedHeader.length` regardless of attacker input.
 */
export function createAuthMiddleware(
    authToken?: string
): (req: Request, res: Response, next: NextFunction) => void {
    if (!authToken) {
        // No token configured — pass through (backward compatible).
        return (_req, _res, next): void => next();
    }
    const expectedHeader = `Bearer ${authToken}`;
    const expectedLength = expectedHeader.length;

    return (req: Request, res: Response, next: NextFunction): void => {
        // Express types the header as `string | string[] | undefined`. RFC 7230
        // forbids duplicate Authorization headers, but Node has historically
        // surfaced arrays in edge cases — collapse defensively.
        const rawAuth = req.headers.authorization;
        const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;

        // Length-bound the timing-safe compare. The compare itself is constant-
        // time over equal-length buffers, so a length-derived early reject does
        // not weaken the security property (it never reveals byte-equality).
        // The type-predicate `hasExpectedLength` narrows `authHeader` to
        // `string` for `safeStringCompare`, removing an unsafe cast.
        if (!hasExpectedLength(authHeader, expectedLength) || !safeStringCompare(authHeader, expectedHeader)) {
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
 * Type predicate: narrow `string | undefined` to `string` when the value's
 * length equals `expected`. Used by `createAuthMiddleware` to bound
 * `safeStringCompare` allocations and avoid `as string` casts.
 */
function hasExpectedLength(value: string | undefined, expected: number): value is string {
    return value !== undefined && value.length === expected;
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

    // Origin and auth run BEFORE the body parser so unauthenticated clients
    // cannot force the server to allocate / parse 1 MB of JSON per request.
    // Both middlewares only read headers, never the body.
    const originMiddleware = createOriginMiddleware(allowedOrigins);
    const authMiddleware = createAuthMiddleware(authToken);
    app.use("/mcp", originMiddleware, authMiddleware, express.json({ limit: "1mb" }));

    // POST /mcp - Handle MCP requests.
    //
    // Session lifecycle follows the MCP SDK reference pattern:
    //  - existing session-id → route to that transport
    //  - missing session-id + initialize body → create a new session
    //  - any other shape → 400/404
    //
    // The session is registered via the SDK's `onsessioninitialized` callback
    // (fires synchronously inside `transport.handleRequest` when an initialize
    // request is processed). Reading `transport.sessionId` *before*
    // `handleRequest` returns `undefined` because the SDK only assigns the id
    // when it sees the `initialize` JSON-RPC payload — so a post-`connect`
    // registration block would be dead code.
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

            // Existing session — route to its transport.
            if (sessionId && sessionManager.has(sessionId)) {
                const session = sessionManager.get(sessionId)!;
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res, req.body);
                return;
            }

            // Session-id supplied but not found — never silently create a
            // replacement (would let stale clients spawn fresh sessions).
            if (sessionId) {
                res.status(404).json({
                    jsonrpc: "2.0",
                    error: { code: -32001, message: "Session not found" },
                });
                return;
            }

            // No session-id — only an initialize request may create a session.
            if (!isInitializeRequest(req.body)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32600,
                        message: "Bad Request: Mcp-Session-Id header is required for non-initialize requests",
                    },
                });
                return;
            }

            // Capacity check before allocating a server + transport pair.
            if (sessionManager.size >= SESSION.MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Server at capacity. Try again later." },
                });
                return;
            }

            // Create a fresh per-session server + transport. Registration
            // happens inside `onsessioninitialized` — the SDK fires this
            // synchronously inside `handleRequest` once the initialize body
            // is parsed and a sessionId is generated.
            const server = createMcpServer();
            const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                onsessioninitialized: (sid: string) => {
                    sessionManager.set(sid, {
                        server,
                        transport,
                        lastActivity: Date.now(),
                    });
                },
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && sessionManager.has(sid)) {
                    sessionManager.delete(sid);
                }
            };

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            // Minimal error logging: shape only, never message contents — matches
            // the project-wide stderr convention (see CLAUDE.md "Error logging":
            // `tool_name error: [<context>] <ErrorClassName>`). The bracketed
            // context is the session id when one passed validation, otherwise
            // "no-session". An unvalidated header is treated as absent so a
            // malicious client cannot inject arbitrary bytes into stderr.
            const errorClass = error instanceof Error ? error.constructor.name : "unknown";
            const rawSid = req.headers["mcp-session-id"];
            const candidate = Array.isArray(rawSid) ? rawSid[0] : rawSid;
            const ctx = candidate && isValidSessionId(candidate) ? candidate : "no-session";
            console.error(`http_post error: [${ctx}] ${errorClass}`);
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
 * Build the operator-facing one-line summary of HTTP auth status.
 *
 * Logged at HTTP startup so an operator can confirm whether bearer-token
 * auth is active. A typoed env var name (e.g. `MCP_AUTH_TOKE=…`) would
 * otherwise boot a fully open server with no signal beyond silence.
 */
export function formatAuthStatus(authToken: string | undefined): string {
    if (authToken === undefined || authToken === "") {
        return "HTTP transport: bearer auth DISABLED (set MCP_AUTH_TOKEN to require auth)";
    }
    return "HTTP transport: bearer auth enabled";
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
    // Snapshot the env var once so validation and the auth middleware see
    // the same value. Validate first — `runHTTP` has no rollback handler,
    // so a thrown `validateAuthToken` MUST run before we register any timer,
    // session manager, or listening socket.
    const authToken = process.env[ENV.AUTH_TOKEN];
    validateAuthToken(authToken);

    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();

    // Initialize session manager
    const sessionManager = new SessionManager();
    sessionManager.startCleanup();

    // Start background cleanup intervals and initialize lifecycle
    const rateLimitInterval = startRateLimitCleanup();
    const injectionInterval = startInjectionCleanup();
    initializeLifecycle(sessionManager, rateLimitInterval, injectionInterval);

    const app = createHttpApp({
        createMcpServer: () => {
            const server = createServer();
            registerAllCapabilities(server);
            return server;
        },
        sessionManager,
        authToken,
    });

    const port = parsePort(process.env.PORT, LIMITS.DEFAULT_HTTP_PORT);
    const host = resolveHost();
    const httpServer = app.listen(port, host);

    httpServer.on("listening", () => {
        console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
        console.error(formatAuthStatus(authToken));
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
