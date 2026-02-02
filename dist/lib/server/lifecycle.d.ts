import type { Server } from "http";
import type { SessionManager } from "../session/index.js";
/**
 * Initialize lifecycle state.
 * Called by transport runners to register cleanup targets.
 */
export declare function initializeLifecycle(sessions: SessionManager | null, rateLimitInterval: NodeJS.Timeout): void;
/**
 * Set the HTTP server reference for graceful shutdown.
 * Called by HTTP transport after server starts listening.
 */
export declare function setHttpServer(server: Server): void;
/**
 * Graceful shutdown handler.
 * Closes all connections and cleans up resources.
 */
export declare function shutdown(signal: string): Promise<void>;
/**
 * Register process shutdown handlers.
 * Should be called once at application startup.
 */
export declare function registerShutdownHandlers(): void;
