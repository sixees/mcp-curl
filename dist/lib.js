// src/lib.ts
// Library entry point for programmatic usage of mcp-curl
//
// This module exports the extensible McpCurlServer class and all public types
// for building custom MCP servers with cURL capabilities.
// Main server class
export { McpCurlServer } from "./lib/extensible/index.js";
// Instance utilities for direct tool execution
export { createInstanceUtilities } from "./lib/extensible/index.js";
