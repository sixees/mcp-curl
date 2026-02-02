// src/lib/tools/index.ts
// Tools barrel export - provides individual tool registration and combined helper
import { registerCurlExecuteTool } from "./curl-execute.js";
import { registerJqQueryTool } from "./jq-query.js";
export { registerCurlExecuteTool } from "./curl-execute.js";
export { registerJqQueryTool } from "./jq-query.js";
/**
 * Registers all tools on the MCP server.
 */
export function registerAllTools(server) {
    registerCurlExecuteTool(server);
    registerJqQueryTool(server);
}
