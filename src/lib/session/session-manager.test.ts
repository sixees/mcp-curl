// src/lib/session/session-manager.test.ts
// Tests for SessionManager

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./session-manager.js";
import type { Session } from "../types/session.js";

// Mock session factory
function createMockSession(): Session {
    return {
        server: { close: vi.fn().mockResolvedValue(undefined) } as unknown as Session["server"],
        transport: { close: vi.fn(), sessionId: "test-id" } as unknown as Session["transport"],
        lastActivity: Date.now(),
    };
}

describe("SessionManager", () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
        sessionManager = new SessionManager(5); // Small limit for testing
    });

    afterEach(() => {
        sessionManager.stopCleanup();
    });

    describe("constructor validation", () => {
        it("rejects zero maxSessions", () => {
            expect(() => new SessionManager(0)).toThrow("maxSessions must be a positive integer, got: 0");
        });

        it("rejects negative maxSessions", () => {
            expect(() => new SessionManager(-1)).toThrow("maxSessions must be a positive integer, got: -1");
        });

        it("rejects non-integer maxSessions", () => {
            expect(() => new SessionManager(1.5)).toThrow("maxSessions must be a positive integer, got: 1.5");
        });

        it("rejects NaN maxSessions", () => {
            expect(() => new SessionManager(NaN)).toThrow("maxSessions must be a positive integer, got: NaN");
        });

        it("accepts positive integer maxSessions", () => {
            expect(() => new SessionManager(1)).not.toThrow();
            expect(() => new SessionManager(100)).not.toThrow();
        });
    });

    describe("session limit enforcement", () => {
        it("allows sessions up to the limit", () => {
            for (let i = 0; i < 5; i++) {
                sessionManager.set(`session-${i}`, createMockSession());
            }
            expect(sessionManager.size).toBe(5);
        });

        it("throws when adding new session beyond limit", () => {
            for (let i = 0; i < 5; i++) {
                sessionManager.set(`session-${i}`, createMockSession());
            }

            expect(() => sessionManager.set("session-6", createMockSession())).toThrow(
                "Session limit reached (max: 5)"
            );
        });

        it("allows updating existing session at limit", () => {
            for (let i = 0; i < 5; i++) {
                sessionManager.set(`session-${i}`, createMockSession());
            }

            // Updating existing session should not throw
            const updatedSession = createMockSession();
            expect(() => sessionManager.set("session-0", updatedSession)).not.toThrow();
            expect(sessionManager.size).toBe(5);
        });

        it("allows new session after deleting one at limit", () => {
            for (let i = 0; i < 5; i++) {
                sessionManager.set(`session-${i}`, createMockSession());
            }

            sessionManager.delete("session-0");
            expect(sessionManager.size).toBe(4);

            expect(() => sessionManager.set("new-session", createMockSession())).not.toThrow();
            expect(sessionManager.size).toBe(5);
        });
    });

    describe("basic operations", () => {
        it("stores and retrieves sessions", () => {
            const session = createMockSession();
            sessionManager.set("test-id", session);

            expect(sessionManager.has("test-id")).toBe(true);
            expect(sessionManager.get("test-id")).toBe(session);
        });

        it("deletes sessions", () => {
            sessionManager.set("test-id", createMockSession());
            sessionManager.delete("test-id");

            expect(sessionManager.has("test-id")).toBe(false);
            expect(sessionManager.get("test-id")).toBeUndefined();
        });

        it("tracks session count", () => {
            expect(sessionManager.size).toBe(0);

            sessionManager.set("id-1", createMockSession());
            expect(sessionManager.size).toBe(1);

            sessionManager.set("id-2", createMockSession());
            expect(sessionManager.size).toBe(2);

            sessionManager.delete("id-1");
            expect(sessionManager.size).toBe(1);
        });
    });
});
