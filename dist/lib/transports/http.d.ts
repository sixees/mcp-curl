import { Request, Response, NextFunction } from "express";
/**
 * Authentication middleware for HTTP transport.
 *
 * When MCP_AUTH_TOKEN is set, all HTTP requests must include a matching
 * Bearer token in the Authorization header. This prevents unauthorized
 * clients from accessing the MCP server when running in HTTP mode.
 *
 * Usage: Set MCP_AUTH_TOKEN=your-secret-token in the environment.
 */
export declare function createAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Run the MCP server with HTTP transport.
 * Enables web-based clients to connect via HTTP/SSE.
 */
export declare function runHTTP(): Promise<void>;
