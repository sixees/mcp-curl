// src/lib/execution/index.ts
// Execution module barrel export

export { executeCommand, type AllowedCommand, type CommandResult } from "./command-executor.js";
export { buildCurlArgs, type CurlArgsParams } from "./curl-args-builder.js";
export {
    getCurrentMemoryUsage,
    allocateMemory,
    releaseMemory,
    getMemoryLimit,
    // Note: resetMemoryTracking intentionally not exported here (test-only).
    // Tests should import directly from "./memory-tracker.js" if needed.
} from "./memory-tracker.js";
