// src/lib/index.ts
// Barrel export for library internals - use for advanced customization
//
// For most use cases, import from the main package entry point instead:
//   import { McpCurlServer, createApiServer } from "mcp-curl";
//
// This subpath exports lower-level utilities for advanced use cases.
// Extensible server class and utilities
export { McpCurlServer, createInstanceUtilities } from "./extensible/index.js";
// API server factory
export { createApiServer, createApiServerSync } from "./api-server.js";
// Server schemas (Zod schemas for input validation)
export { CurlExecuteSchema, JqQuerySchema } from "./server/schemas.js";
// Execution utilities
export { executeCurlRequest } from "./tools/curl-execute.js";
export { executeJqQuery } from "./tools/jq-query.js";
// Server factory and registration
export { createServer } from "./server/server-factory.js";
export { registerAllResources } from "./resources/index.js";
export { registerAllPrompts } from "./prompts/index.js";
