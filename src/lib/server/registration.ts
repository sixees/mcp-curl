// src/lib/server/registration.ts
// Orchestrates registration of all tools, resources, and prompts

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/index.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";

/**
 * Registers all capabilities (tools, resources, and prompts) on the MCP server.
 * This is the main orchestration function that delegates to individual modules.
 */
export function registerAllCapabilities(server: McpServer): void {
    registerAllTools(server);
    registerAllResources(server);
    registerAllPrompts(server);
}
