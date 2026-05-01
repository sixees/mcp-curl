// src/lib/transports/http.session.test.ts
// Integration tests for the POST /mcp session lifecycle.
//
// These tests exercise the SDK contract that historically tripped us up:
// `StreamableHTTPServerTransport.sessionId` is undefined after `connect()`.
// The SDK only assigns it inside `handleRequest` once it sees an
// `initialize` JSON-RPC body, and surfaces the new id via the
// `onsessioninitialized(sid)` constructor option. A regression that
// re-introduces a post-`connect` registration block would silently orphan
// every session — we want a test that fails loudly if that comes back.
//
// We stub the SDK transport to capture constructor options and to drive
// the `onsessioninitialized` callback ourselves, then assert the
// registration shows up in `SessionManager`.

import express from "express";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock the SDK transport so we can capture constructor options. ----
//
// `captured.options` always points at the *most recent* construction so
// each test can interrogate the live transport without juggling indices.

interface CapturedTransportOptions {
    sessionIdGenerator?: () => string;
    enableJsonResponse?: boolean;
    onsessioninitialized?: (sid: string) => void | Promise<void>;
}

interface FakeTransport {
    sessionId: string | undefined;
    onclose: (() => void) | undefined;
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
}

const captured: { options: CapturedTransportOptions | null; transport: FakeTransport | null } = {
    options: null,
    transport: null,
};

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
    // The SDK exports a real class — vitest's `vi.fn().mockImplementation`
    // is not invoked when the mock is called with `new`, so we expose a
    // hand-rolled class instead. (Vitest emits a warning otherwise and
    // returns an empty object, breaking the route handler.)
    class StreamableHTTPServerTransport implements FakeTransport {
        sessionId: string | undefined = undefined;
        onclose: (() => void) | undefined = undefined;
        handleRequest: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn> = vi.fn(async () => {});
        constructor(opts: CapturedTransportOptions) {
            captured.options = opts;
            // Capture `this` once — `mockImplementation` rebinds otherwise.
            const self = this;
            this.handleRequest = vi.fn(async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }, _body: unknown) => {
                if (!self.sessionId && opts.onsessioninitialized && opts.sessionIdGenerator) {
                    self.sessionId = opts.sessionIdGenerator();
                    await opts.onsessioninitialized(self.sessionId);
                }
                // Minimal JSON-RPC response so the route handler does not
                // hang; payload contents are not asserted.
                res.status(200).json({ jsonrpc: "2.0", result: {}, id: 1 });
            });
            captured.transport = this;
        }
    }
    return { StreamableHTTPServerTransport };
});

// Import AFTER vi.mock so the http module picks up the mocked SDK.
import { createHttpApp } from "./http.js";
import { SessionManager } from "../session/index.js";

// --- Test scaffolding -------------------------------------------------

interface RunningApp {
    url: string;
    sessionManager: SessionManager;
    close: () => Promise<void>;
}

async function startApp(): Promise<RunningApp> {
    const sessionManager = new SessionManager();
    // Minimal stub server — `server.connect(transport)` is the only method
    // the route handler invokes on it before delegating to handleRequest.
    const stubServer = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const app = createHttpApp({
        createMcpServer: () => stubServer as unknown as Parameters<typeof createHttpApp>[0]["createMcpServer"] extends () => infer R ? R : never,
        sessionManager,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/mcp`,
        sessionManager,
        close: () =>
            new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

const initializeBody = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "regression-test", version: "0.0.0" },
    },
};

beforeEach(() => {
    captured.options = null;
    captured.transport = null;
});

afterEach(() => {
    vi.clearAllMocks();
});

// --- POST /mcp: onsessioninitialized wiring ---------------------------

describe("POST /mcp session registration", () => {
    it("constructs the SDK transport with an onsessioninitialized callback", async () => {
        const app = await startApp();
        try {
            await fetch(app.url, {
                method: "POST",
                headers: { "content-type": "application/json", origin: "http://localhost" },
                body: JSON.stringify(initializeBody),
            });
            expect(captured.options).not.toBeNull();
            expect(typeof captured.options?.onsessioninitialized).toBe("function");
            expect(typeof captured.options?.sessionIdGenerator).toBe("function");
        } finally {
            await app.close();
        }
    });

    it("registers the session in SessionManager when onsessioninitialized fires", async () => {
        // This is the regression check for the dead-code session-registration
        // block we removed in PR-4 review pass 2. If a future change starts
        // reading `transport.sessionId` immediately after `server.connect()`
        // again, this assertion will fail because the SDK only assigns the
        // id inside `handleRequest`.
        const app = await startApp();
        try {
            const res = await fetch(app.url, {
                method: "POST",
                headers: { "content-type": "application/json", origin: "http://localhost" },
                body: JSON.stringify(initializeBody),
            });
            expect(res.status).toBe(200);
            expect(app.sessionManager.size).toBe(1);
            const [sid] = Array.from(app.sessionManager.entries()).map(([id]) => id);
            expect(captured.transport?.sessionId).toBe(sid);
        } finally {
            await app.close();
        }
    });

    it("routes a follow-up request with the same Mcp-Session-Id to the existing transport", async () => {
        const app = await startApp();
        try {
            await fetch(app.url, {
                method: "POST",
                headers: { "content-type": "application/json", origin: "http://localhost" },
                body: JSON.stringify(initializeBody),
            });
            const [sid] = Array.from(app.sessionManager.entries()).map(([id]) => id);
            const firstTransport = captured.transport;
            expect(firstTransport).not.toBeNull();
            firstTransport!.handleRequest.mockClear();

            const followUp = await fetch(app.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: "http://localhost",
                    "mcp-session-id": sid,
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
            });
            expect(followUp.status).toBe(200);
            // The follow-up must hit the *same* transport instance, proving
            // the session was registered and discoverable by id.
            expect(firstTransport!.handleRequest).toHaveBeenCalledTimes(1);
            expect(app.sessionManager.size).toBe(1);
        } finally {
            await app.close();
        }
    });

    it("returns 404 for a follow-up request with an unknown Mcp-Session-Id", async () => {
        const app = await startApp();
        try {
            const res = await fetch(app.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: "http://localhost",
                    "mcp-session-id": "11111111-1111-4111-8111-111111111111",
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
            });
            expect(res.status).toBe(404);
            expect(app.sessionManager.size).toBe(0);
        } finally {
            await app.close();
        }
    });

    it("returns 400 when no session id is supplied and the body is not initialize", async () => {
        const app = await startApp();
        try {
            const res = await fetch(app.url, {
                method: "POST",
                headers: { "content-type": "application/json", origin: "http://localhost" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
            });
            expect(res.status).toBe(400);
            expect(app.sessionManager.size).toBe(0);
        } finally {
            await app.close();
        }
    });
});

// Compile-time assurance that the `express` import is real (the mocked
// SDK module does not pull in Express). Without this reference tsup may
// tree-shake the import in tests that only use `fetch`.
void express;
