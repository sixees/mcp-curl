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

    has(id: string): boolean {
        return this.sessions.has(id);
    }

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
     * Delete a session entry from the map without closing its transport
     * or MCP server. Used by `transport.onclose` after the SDK has already
     * torn down the transport — we only need to drop the bookkeeping.
     *
     * For the explicit DELETE /mcp path, callers should use
     * {@link closeSession} which awaits the SDK close handlers.
     */
    delete(id: string): void {
        this.sessions.delete(id);
    }

    get size(): number {
        return this.sessions.size;
    }

    entries(): IterableIterator<[string, Session]> {
        return this.sessions.entries();
    }

    /**
     * Start periodic cleanup of idle sessions.
     *
     * Sessions that exceed `SESSION.IDLE_TIMEOUT_MS` without activity are
     * removed from the map synchronously (so a slow close cannot let a
     * subsequent tick re-process the same session) and torn down through
     * {@link closeWithTimeout} — symmetric with `closeAll` and `closeSession`.
     * The actual close runs in the background via `void this.closeSessions(...)`
     * because the interval callback cannot be `await`-ed; `closeWithTimeout`
     * logs its own errors so nothing is dropped.
     */
    startCleanup(): void {
        if (this.cleanupInterval) {
            return; // Already running
        }

        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const idle: Array<[string, Session]> = [];
            for (const [id, session] of this.sessions) {
                if (now - session.lastActivity > SESSION.IDLE_TIMEOUT_MS) {
                    idle.push([id, session]);
                    this.sessions.delete(id);
                }
            }
            if (idle.length > 0) {
                void this.closeSessions(idle);
            }
        }, SESSION.CLEANUP_INTERVAL_MS);

        // Prevent interval from keeping process alive during shutdown
        this.cleanupInterval.unref();
    }

    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Close a single session by id and remove it from the map.
     *
     * Used by the DELETE /mcp route, which must `await` the SDK transport
     * close so in-flight SSE frames are drained before the response returns.
     * No-op when the id isn't tracked.
     */
    async closeSession(id: string): Promise<void> {
        const session = this.sessions.get(id);
        if (!session) {
            return;
        }
        this.sessions.delete(id);
        await this.closeSessions([[id, session]]);
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
        await this.closeSessions(entries);
    }

    /**
     * Tear down a batch of session entries through the same timeout-bounded
     * helper used by `closeAll` and `closeSession`. Centralises the order
     * (transport before MCP server) and the parallelisation policy
     * (`Promise.allSettled` so one hung session can't block the rest of the
     * batch — bounded individually by {@link CLOSE_TIMEOUT_MS}).
     */
    private async closeSessions(
        entries: ReadonlyArray<readonly [string, Session]>,
    ): Promise<void> {
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
 * 5-second budget `McpCurlServer.shutdown` uses for `_httpServer.close`,
 * so a single-transport hang during shutdown still completes within the same
 * envelope the operator already expects.
 */
const CLOSE_TIMEOUT_MS = 5_000;

/**
 * Run `op()` and reject if it hasn't settled within {@link CLOSE_TIMEOUT_MS}.
 * Errors and timeouts are logged in the
 * `<label> error: [<sessionId>] <ErrorClassName>` shape the rest of the
 * codebase uses (see docs/architecture/architecture.md → "Error-Logging
 * Discipline") — no message bodies, so a
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
