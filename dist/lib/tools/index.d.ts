import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { registerCurlExecuteTool } from "./curl-execute.js";
export { registerJqQueryTool } from "./jq-query.js";
export { executeCurlRequest, CURL_EXECUTE_TOOL_META, type CurlExecuteResult, type CurlExecuteExtra, } from "./curl-execute.js";
export { executeJqQuery, JQ_QUERY_TOOL_META, type JqQueryResult, type JqQueryExtra, } from "./jq-query.js";
/**
 * Registers all tools on the MCP server.
 */
export declare function registerAllTools(server: McpServer): void;
