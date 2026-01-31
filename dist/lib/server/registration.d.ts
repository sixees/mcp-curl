import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Registers all tools, resources, and prompts on the MCP server.
 * This is the main orchestration function that delegates to individual modules.
 */
export declare function registerToolsAndResources(server: McpServer): void;
