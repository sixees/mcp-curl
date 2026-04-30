// src/lib/transports/stdio.ts
// Stdio transport runner

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cleanupOrphanedTempDirs } from "../files/index.js";
import {
    startRateLimitCleanup,
    stopRateLimitCleanup,
    startInjectionCleanup,
    stopInjectionCleanup,
} from "../security/index.js";
import { createServer, registerAllCapabilities, initializeLifecycle } from "../server/index.js";

/**
 * Run the MCP server with stdio transport.
 * This is the default transport mode.
 */
export async function runStdio(): Promise<void> {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();

    // Start background cleanup intervals
    const rateLimitInterval = startRateLimitCleanup();
    const injectionInterval = startInjectionCleanup();
    initializeLifecycle(null, rateLimitInterval, injectionInterval);

    try {
        const server = createServer();
        registerAllCapabilities(server);

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("cURL MCP server running on stdio");
    } catch (error) {
        // Clean up intervals on startup failure
        stopRateLimitCleanup(rateLimitInterval);
        stopInjectionCleanup(injectionInterval);
        throw error;
    }
}
