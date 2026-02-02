import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Registers all capabilities (tools, resources, and prompts) on the MCP server.
 * This is the main orchestration function that delegates to individual modules.
 */
export declare function registerAllCapabilities(server: McpServer): void;
