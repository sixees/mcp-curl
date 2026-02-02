// src/lib/server/index.ts
// Server module barrel export

export { createServer } from "./server-factory.js";
export { CurlExecuteSchema, JqQuerySchema } from "./schemas.js";
export type { CurlExecuteInput, JqQueryInput } from "./schemas.js";
export { registerAllCapabilities } from "./registration.js";
export {
    initializeLifecycle,
    setHttpServer,
    shutdown,
    registerShutdownHandlers,
} from "./lifecycle.js";

// Extensible server class and related exports
export { McpCurlServer } from "../extensible/index.js";
export type { InstanceUtilities, ExecuteRequestParams } from "../extensible/index.js";
