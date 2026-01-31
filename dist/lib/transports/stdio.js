// src/lib/transports/stdio.ts
// Stdio transport runner
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cleanupOrphanedTempDirs } from "../files/index.js";
import { startRateLimitCleanup } from "../security/index.js";
import { createServer, registerToolsAndResources, initializeLifecycle } from "../server/index.js";
/**
 * Run the MCP server with stdio transport.
 * This is the default transport mode.
 */
export async function runStdio() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    // Start rate limit cleanup
    const rateLimitInterval = startRateLimitCleanup();
    initializeLifecycle(null, rateLimitInterval);
    const server = createServer();
    registerToolsAndResources(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("cURL MCP server running on stdio");
}
