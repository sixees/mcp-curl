// src/lib/server/server-factory.ts
// Factory function for creating MCP server instances

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER } from "../config/index.js";

/**
 * Creates a new MCP server instance with the configured name and version.
 */
export function createServer(): McpServer {
    return new McpServer({
        name: SERVER.NAME,
        version: SERVER.VERSION,
    });
}
