// src/lib/server/index.ts
// Server module barrel export
export { createServer } from "./server-factory.js";
export { CurlExecuteSchema, JqQuerySchema } from "./schemas.js";
export { registerToolsAndResources } from "./registration.js";
export { initializeLifecycle, setHttpServer, shutdown, registerShutdownHandlers, } from "./lifecycle.js";
