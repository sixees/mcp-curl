// src/lib/server/lifecycle.ts
// Server lifecycle management: shutdown handlers, state tracking

import type { Server } from "http";
import type { SessionManager } from "../session/index.js";
import { stopRateLimitCleanup } from "../security/index.js";
import { cleanupTempDir } from "../files/index.js";

// Module-level state for graceful shutdown
let httpServer: Server | null = null;
let sessionManager: SessionManager | null = null;
let rateLimitCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize lifecycle state.
 * Called by transport runners to register cleanup targets.
 */
export function initializeLifecycle(
    sessions: SessionManager | null,
    rateLimitInterval: NodeJS.Timeout
): void {
    sessionManager = sessions;
    rateLimitCleanupInterval = rateLimitInterval;
}

/**
 * Set the HTTP server reference for graceful shutdown.
 * Called by HTTP transport after server starts listening.
 */
export function setHttpServer(server: Server): void {
    httpServer = server;
}

/**
 * Graceful shutdown handler.
 * Closes all connections and cleans up resources.
 */
export async function shutdown(signal: string): Promise<void> {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);

    let hasError = false;

    // Close HTTP server if running
    if (httpServer) {
        try {
            await new Promise<void>((resolve, reject) => {
                httpServer!.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            console.error("Warning: Error closing HTTP server:", error);
            hasError = true;
        }
    }

    // Close all active sessions
    if (sessionManager) {
        sessionManager.stopCleanup();
        try {
            await sessionManager.closeAll();
        } catch (error) {
            console.error("Warning: Error closing sessions:", error);
            hasError = true;
        }
    }

    // Stop rate limit cleanup interval
    if (rateLimitCleanupInterval) {
        stopRateLimitCleanup(rateLimitCleanupInterval);
    }

    // Clean up temp directory (handles errors internally)
    await cleanupTempDir();

    // Reflect partial failures in exit code
    process.exit(hasError ? 1 : 0);
}

/**
 * Register process shutdown handlers.
 * Should be called once at application startup.
 */
export function registerShutdownHandlers(): void {
    process.on("SIGINT", () => {
        void shutdown("SIGINT").catch((error) => {
            console.error("Warning: Shutdown failed:", error);
            process.exit(1);
        });
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM").catch((error) => {
            console.error("Warning: Shutdown failed:", error);
            process.exit(1);
        });
    });
}
