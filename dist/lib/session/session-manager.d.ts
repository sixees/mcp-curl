import type { Session } from "../types/index.js";
/**
 * Manages HTTP transport sessions with automatic cleanup.
 * Encapsulates the sessions Map and provides controlled access.
 */
export declare class SessionManager {
    private sessions;
    private cleanupInterval;
    /**
     * Check if a session exists.
     */
    has(id: string): boolean;
    /**
     * Get a session by ID.
     */
    get(id: string): Session | undefined;
    /**
     * Store a session.
     */
    set(id: string, session: Session): void;
    /**
     * Delete a session.
     */
    delete(id: string): void;
    /**
     * Get the number of active sessions.
     */
    get size(): number;
    /**
     * Iterate over all sessions.
     */
    entries(): IterableIterator<[string, Session]>;
    /**
     * Start periodic cleanup of idle sessions.
     * Sessions that exceed SESSION.IDLE_TIMEOUT_MS without activity are closed.
     */
    startCleanup(): void;
    /**
     * Stop the cleanup interval.
     */
    stopCleanup(): void;
    /**
     * Close all active sessions gracefully.
     * Used during server shutdown.
     */
    closeAll(): Promise<void>;
}
