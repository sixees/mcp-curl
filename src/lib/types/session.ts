// src/lib/types/session.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * HTTP transport session tracking.
 * Each HTTP client gets a unique session with its own MCP server instance.
 */
export interface Session {
    /** MCP server instance handling this client's requests */
    server: McpServer;
    /** HTTP transport connection for streaming responses */
    transport: StreamableHTTPServerTransport;
    /** Unix timestamp (ms) of last activity, used for idle timeout detection */
    lastActivity: number;
}
