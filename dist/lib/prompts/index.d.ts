import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApiTestPrompt } from "./api-test.js";
import { registerApiDiscoveryPrompt } from "./api-discovery.js";
export { registerApiTestPrompt, registerApiDiscoveryPrompt };
/**
 * Registers all prompts on the MCP server.
 */
export declare function registerAllPrompts(server: McpServer): void;
