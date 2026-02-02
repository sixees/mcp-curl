import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Registers the jq_query tool on the MCP server.
 * This tool allows querying JSON files without making new HTTP requests.
 */
export declare function registerJqQueryTool(server: McpServer): void;
