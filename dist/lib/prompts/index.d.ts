import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { registerApiTestPrompt } from "./api-test.js";
export { registerApiDiscoveryPrompt } from "./api-discovery.js";
/**
 * Registers all prompts on the MCP server.
 */
export declare function registerAllPrompts(server: McpServer): void;
