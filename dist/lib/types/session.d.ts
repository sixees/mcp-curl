import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
/**
 * HTTP transport session tracking.
 */
export interface Session {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    lastActivity: number;
}
