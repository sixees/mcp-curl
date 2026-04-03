#!/usr/bin/env node
import {
  createServer,
  initializeLifecycle,
  registerAllCapabilities,
  registerShutdownHandlers,
  runHTTP
} from "./chunk-4OEJS6BE.js";
import {
  cleanupOrphanedTempDirs,
  startRateLimitCleanup,
  stopRateLimitCleanup
} from "./chunk-FBAV2EBE.js";

// src/lib/transports/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
async function runStdio() {
  await cleanupOrphanedTempDirs();
  const rateLimitInterval = startRateLimitCleanup();
  initializeLifecycle(null, rateLimitInterval);
  try {
    const server = createServer();
    registerAllCapabilities(server);
    const transport2 = new StdioServerTransport();
    await server.connect(transport2);
    console.error("cURL MCP server running on stdio");
  } catch (error) {
    stopRateLimitCleanup(rateLimitInterval);
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
