// src/lib/tools/index.ts
// Tools barrel export - provides individual tool registration and combined helper

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCurlExecuteTool } from "./curl-execute.js";
import { registerJqQueryTool } from "./jq-query.js";

// Registration functions
export { registerCurlExecuteTool } from "./curl-execute.js";
export { registerJqQueryTool } from "./jq-query.js";

// Executor functions and metadata (for McpCurlServer extensible class)
export {
    executeCurlRequest,
    CURL_EXECUTE_TOOL_META,
    type CurlExecuteResult,
    type CurlExecuteExtra,
} from "./curl-execute.js";
export {
    executeJqQuery,
    JQ_QUERY_TOOL_META,
    type JqQueryResult,
    type JqQueryExtra,
} from "./jq-query.js";

/**
 * Registers all tools on the MCP server.
 */
export function registerAllTools(server: McpServer): void {
    registerCurlExecuteTool(server);
    registerJqQueryTool(server);
}
