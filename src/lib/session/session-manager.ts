// src/lib/session/session-manager.ts
// Encapsulates HTTP transport session management

import type { Session } from "../types/index.js";
import { SESSION } from "../config/index.js";

/**
 * Manages HTTP transport sessions with automatic cleanup.
 * Encapsulates the sessions Map and provides controlled access.
 */
export class SessionManager {
    private sessions = new Map<string, Session>();
    private cleanupInterval: NodeJS.Timeout | null = null;

    /**
     * Create a new session manager with optional custom max sessions.
     * @param maxSessions - Maximum number of concurrent sessions (default: SESSION.MAX_SESSIONS)
     * @throws Error if maxSessions is not a positive integer
     */
    constructor(private readonly maxSessions: number = SESSION.MAX_SESSIONS) {
        if (!Number.isInteger(maxSessions) || maxSessions < 1) {
            throw new Error(`maxSessions must be a positive integer, got: ${maxSessions}`);
        }
    }

    /**
     * Check if a session exists.
     */
    has(id: string): boolean {
        return this.sessions.has(id);
    }

    /**
     * Get a session by ID.
     */
    get(id: string): Session | undefined {
        return this.sessions.get(id);
    }

    /**
     * Store a session.
     * @throws Error if session limit is reached
     */
    set(id: string, session: Session): void {
        // Enforce session limit when adding new sessions
        if (!this.sessions.has(id) && this.sessions.size >= this.maxSessions) {
            throw new Error(`Session limit reached (max: ${this.maxSessions})`);
        }
        this.sessions.set(id, session);
    }

    /**
     * Delete a session.
     */
    delete(id: string): void {
        this.sessions.delete(id);
    }

    /**
     * Get the number of active sessions.
     */
    get size(): number {
        return this.sessions.size;
    }

    /**
     * Iterate over all sessions.
     */
    entries(): IterableIterator<[string, Session]> {
        return this.sessions.entries();
    }

    /**
     * Start periodic cleanup of idle sessions.
     * Sessions that exceed SESSION.IDLE_TIMEOUT_MS without activity are closed.
     */
    startCleanup(): void {
        if (this.cleanupInterval) {
            return; // Already running
        }

        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, session] of this.sessions) {
                if (now - session.lastActivity > SESSION.IDLE_TIMEOUT_MS) {
                    try {
                        session.transport.close();
                    } catch (error) {
                        console.error(`Warning: Error closing idle session ${id} transport:`, error);
                    }
                    void session.server.close().catch((error) => {
                        console.error(`Warning: Error closing idle session ${id} server:`, error);
                    });
                    this.sessions.delete(id);
                }
            }
        }, SESSION.CLEANUP_INTERVAL_MS);

        // Prevent interval from keeping process alive during shutdown
        this.cleanupInterval.unref();
    }

    /**
     * Stop the cleanup interval.
     */
    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Close all active sessions gracefully.
     *
     * The MCP SDK's `StreamableHTTPServerTransport.close()` is asynchronous
     * (it drains in-flight SSE streams via `_onsessionclosed`); awaiting it
     * is required for a clean shutdown. Sessions close in parallel via
     * `Promise.allSettled`, and each individual close is bounded by
     * {@link CLOSE_TIMEOUT_MS} so a transport that never drains can't keep
     * the shutdown wait open indefinitely.
     */
    async closeAll(): Promise<void> {
        const entries = Array.from(this.sessions.entries());
        this.sessions.clear();
        await Promise.allSettled(
            entries.map(async ([sessionId, session]) => {
                await closeWithTimeout(
                    () => session.transport.close(),
                    "session_close_transport",
                    sessionId,
                );
                await closeWithTimeout(
                    () => session.server.close(),
                    "session_close_server",
                    sessionId,
                );
            }),
        );
    }
}

/**
 * Maximum time we wait for a single session-component close. Mirrors the
 * 5-second budget {@link McpCurlServer.shutdown} uses for `_httpServer.close`,
 * so a single-transport hang during shutdown still completes within the same
 * envelope the operator already expects.
 */
const CLOSE_TIMEOUT_MS = 5_000;

/**
 * Run `op()` and reject if it hasn't settled within {@link CLOSE_TIMEOUT_MS}.
 * Errors and timeouts are logged in the
 * `<label> error: [<sessionId>] <ErrorClassName>` shape the rest of the
 * codebase uses (see CLAUDE.md "Error logging") — no message bodies, so a
 * misbehaving close cannot leak transport-internal state to stderr.
 */
async function closeWithTimeout(
    op: () => Promise<void>,
    label: string,
    sessionId: string,
): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            op(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`${label}_timeout`)),
                    CLOSE_TIMEOUT_MS,
                );
                timer.unref?.();
            }),
        ]);
    } catch (error) {
        const errorClass = error instanceof Error ? error.constructor.name : "unknown";
        console.error(`${label} error: [${sessionId}] ${errorClass}`);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
