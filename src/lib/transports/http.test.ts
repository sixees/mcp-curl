import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
    createOriginMiddleware,
    createAuthMiddleware,
    formatHostForUrl,
    resolveHost,
} from "./http.js";

// Helper to create mock Express req/res/next
function mockReq(headers: Record<string, string | string[] | undefined> = {}): Request {
    return { headers } as unknown as Request;
}

function mockRes() {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function mockNext(): NextFunction & ReturnType<typeof vi.fn> {
    return vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
}

// ─── createOriginMiddleware ───

describe("createOriginMiddleware", () => {
    it("allows requests with no Origin header", () => {
        const mw = createOriginMiddleware();
        const next = mockNext();
        mw(mockReq(), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it("allows localhost origins by default", () => {
        const mw = createOriginMiddleware();
        for (const origin of [
            "http://localhost",
            "http://localhost:3000",
            "https://127.0.0.1:8080",
            "http://[::1]:5000",
        ]) {
            const next = mockNext();
            mw(mockReq({ origin }), mockRes(), next);
            expect(next).toHaveBeenCalled();
        }
    });

    it("blocks non-localhost origins by default", () => {
        const mw = createOriginMiddleware();
        const res = mockRes();
        const next = mockNext();
        mw(mockReq({ origin: "https://evil.com" }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("allows origins in explicit allowlist (case-insensitive)", () => {
        const mw = createOriginMiddleware(["https://app.example.com"]);
        const next = mockNext();
        mw(mockReq({ origin: "HTTPS://APP.EXAMPLE.COM" }), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it("blocks origins not in explicit allowlist", () => {
        const mw = createOriginMiddleware(["https://app.example.com"]);
        const res = mockRes();
        const next = mockNext();
        mw(mockReq({ origin: "https://other.com" }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("handles array Origin header (uses first value)", () => {
        const mw = createOriginMiddleware();
        const next = mockNext();
        // Express can deliver duplicate headers as an array
        mw(mockReq({ origin: ["http://localhost", "https://evil.com"] as unknown as string }), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });
});

// ─── createAuthMiddleware ───

describe("createAuthMiddleware", () => {
    it("allows all requests when no token configured", () => {
        const mw = createAuthMiddleware();
        const next = mockNext();
        mw(mockReq(), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it("allows requests with correct bearer token", () => {
        const mw = createAuthMiddleware("secret-token");
        const next = mockNext();
        mw(mockReq({ authorization: "Bearer secret-token" }), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it("rejects requests with missing token", () => {
        const mw = createAuthMiddleware("secret-token");
        const res = mockRes();
        const next = mockNext();
        mw(mockReq(), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("rejects requests with wrong token", () => {
        const mw = createAuthMiddleware("secret-token");
        const res = mockRes();
        const next = mockNext();
        mw(mockReq({ authorization: "Bearer wrong-token" }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

// ─── formatHostForUrl ───

describe("formatHostForUrl", () => {
    it("returns IPv4 addresses unchanged", () => {
        expect(formatHostForUrl("127.0.0.1")).toBe("127.0.0.1");
    });

    it("wraps IPv6 addresses in brackets", () => {
        expect(formatHostForUrl("::1")).toBe("[::1]");
    });

    it("does not double-wrap already-bracketed IPv6", () => {
        expect(formatHostForUrl("[::1]")).toBe("[::1]");
    });

    it("returns hostnames unchanged", () => {
        expect(formatHostForUrl("localhost")).toBe("localhost");
    });
});

// ─── resolveHost ───

describe("resolveHost", () => {
    const ENV_KEY = "MCP_CURL_HOST";

    beforeEach(() => {
        delete process.env[ENV_KEY];
    });

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it("uses config host when provided", () => {
        expect(resolveHost("0.0.0.0")).toBe("0.0.0.0");
    });

    it("falls back to env var", () => {
        process.env[ENV_KEY] = "192.168.1.1";
        expect(resolveHost()).toBe("192.168.1.1");
    });

    it("defaults to 127.0.0.1", () => {
        expect(resolveHost()).toBe("127.0.0.1");
    });
});
