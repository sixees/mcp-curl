// src/lib/resources/index.ts
// Resources barrel export - provides individual resource registration and combined helper

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentationResource } from "./documentation.js";

export { registerDocumentationResource } from "./documentation.js";

/**
 * Registers all resources on the MCP server.
 */
export function registerAllResources(server: McpServer): void {
    registerDocumentationResource(server);
}
