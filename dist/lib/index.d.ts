export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities, g as executeJqQuery } from '../api-server-BlwTMOjA.js';
export { C as CurlExecuteInput, l as CurlExecuteSchema, J as JqQueryInput, m as JqQuerySchema, n as executeCurlRequest } from '../generator-Ctr639v0.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import 'zod';

/**
 * Creates a new MCP server instance with the configured name and version.
 */
declare function createServer(): McpServer;

/**
 * Registers all resources on the MCP server.
 */
declare function registerAllResources(server: McpServer): void;

/**
 * Registers all prompts on the MCP server.
 */
declare function registerAllPrompts(server: McpServer): void;

export { createServer, registerAllPrompts, registerAllResources };
