#!/usr/bin/env node
import {
  createServer,
  initializeLifecycle,
  registerAllCapabilities,
  registerShutdownHandlers,
  runHTTP
} from "./chunk-Q4P5KGBX.js";
import {
  cleanupOrphanedTempDirs,
  startInjectionCleanup,
  startRateLimitCleanup,
  stopInjectionCleanup,
  stopRateLimitCleanup
} from "./chunk-C7VR5ICY.js";

// src/lib/transports/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
async function runStdio() {
  await cleanupOrphanedTempDirs();
  const rateLimitInterval = startRateLimitCleanup();
  const injectionInterval = startInjectionCleanup();
  initializeLifecycle(null, rateLimitInterval, injectionInterval);
  try {
    const server = createServer();
    registerAllCapabilities(server);
    const transport2 = new StdioServerTransport();
    await server.connect(transport2);
    console.error("cURL MCP server running on stdio");
  } catch (error) {
    stopRateLimitCleanup(rateLimitInterval);
    stopInjectionCleanup(injectionInterval);
    throw error;
  }
}

// src/index.ts
registerShutdownHandlers();
var transport = (process.env.TRANSPORT || "stdio").toLowerCase();
if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
