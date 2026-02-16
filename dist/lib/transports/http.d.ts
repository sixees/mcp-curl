import { Request, Response, NextFunction } from "express";
import type { Express } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from "../session/index.js";
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
    allowedOrigins?: string[];
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
export declare function createOriginMiddleware(allowedOrigins?: string[]): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Authentication middleware for HTTP transport.
 *
 * When an auth token is provided, all HTTP requests must include a matching
 * Bearer token in the Authorization header.
 */
export declare function createAuthMiddleware(authToken?: string): (req: Request, res: Response, next: NextFunction) => void;
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
export declare function createHttpApp(options: HttpAppOptions): Express;
/**
 * Resolve the HTTP bind host from environment or default.
 */
export declare function resolveHost(configHost?: string): string;
/**
 * Run the MCP server with HTTP transport.
 * Enables web-based clients to connect via HTTP/SSE.
 */
export declare function runHTTP(): Promise<void>;
