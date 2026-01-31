import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { registerCurlExecuteTool } from "./curl-execute.js";
export { registerJqQueryTool } from "./jq-query.js";
/**
 * Registers all tools on the MCP server.
 */
export declare function registerAllTools(server: McpServer): void;
