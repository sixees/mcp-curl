// src/lib/execution/index.ts
// Execution module barrel export
export { executeCommand } from "./command-executor.js";
export { buildCurlArgs } from "./curl-args-builder.js";
export { getCurrentMemoryUsage, allocateMemory, releaseMemory, getMemoryLimit,
// Note: resetMemoryTracking intentionally not exported here (test-only).
// Tests should import directly from "./memory-tracker.js" if needed.
 } from "./memory-tracker.js";
