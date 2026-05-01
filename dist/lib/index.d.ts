export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities, g as executeJqQuery } from '../api-server-CNx9XA55.js';
export { C as CurlExecuteInput, m as CurlExecuteSchema, J as JqQueryInput, n as JqQuerySchema, o as executeCurlRequest } from '../generator-C4tc86Qe.js';
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
