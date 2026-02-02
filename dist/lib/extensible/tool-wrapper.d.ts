import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CurlRegisterToolOptions, JqRegisterToolOptions, ToolName } from "./types.js";
/**
 * Register curl_execute tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export declare function registerCurlToolWithHooks(server: McpServer, options: CurlRegisterToolOptions): void;
/**
 * Register jq_query tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param options - Tool registration options
 */
export declare function registerJqToolWithHooks(server: McpServer, options: JqRegisterToolOptions): void;
/**
 * Register a tool on the MCP server with hook support and config transforms.
 *
 * @param server - MCP server instance
 * @param toolName - Name of the tool to register
 * @param options - Tool registration options
 */
export declare function registerToolWithHooks(server: McpServer, toolName: ToolName, options: CurlRegisterToolOptions | JqRegisterToolOptions): void;
