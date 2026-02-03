// src/lib.ts
// Library entry point for programmatic usage of mcp-curl
//
// This module exports the extensible McpCurlServer class and all public types
// for building custom MCP servers with cURL capabilities.

// Main server class
export { McpCurlServer } from "./lib/extensible/index.js";

// Instance utilities for direct tool execution
export { createInstanceUtilities } from "./lib/extensible/index.js";
export type { InstanceUtilities, ExecuteRequestParams } from "./lib/extensible/index.js";

// Public API types
export type {
    // Configuration
    McpCurlConfig,
    TransportMode,

    // Hook types
    HookContext,
    BeforeRequestResult,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,

    // Input types (for typing hook parameters)
    CurlExecuteInput,
    JqQueryInput,
} from "./lib/types/public.js";
