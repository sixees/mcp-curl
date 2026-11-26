export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, d as McpCurlServer, O as OnErrorHook, T as TransportMode, e as createApiServer, f as createApiServerSync, g as createInstanceUtilities, h as executeJqQuery } from '../api-server-Jm7p_Lxw.js';
export { C as CurlExecuteInput, m as CurlExecuteSchema, n as HostPolicy, J as JqQueryInput, o as JqQuerySchema, p as deriveHostPolicy, q as executeCurlRequest } from '../generator-BBozd3k8.js';
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
