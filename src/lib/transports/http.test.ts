import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
    createOriginMiddleware,
    createAuthMiddleware,
    formatAuthStatus,
    formatHostForUrl,
    resolveHost,
    validateAuthToken,
} from "./http.js";
import { LIMITS } from "../config/index.js";

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

    it("rejects oversized Authorization headers without invoking the timing-safe compare", () => {
        // Defence-in-depth: a malicious client should not be able to force
        // `safeStringCompare` to allocate Buffers proportional to a
        // ~8 KB Authorization header. The middleware short-circuits on
        // length mismatch, which is safe — `safeStringCompare` already
        // returns false for length-mismatched inputs.
        const mw = createAuthMiddleware("secret-token");
        const res = mockRes();
        const next = mockNext();
        const oversized = `Bearer ${"x".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH * 2)}`;
        mw(mockReq({ authorization: oversized }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("collapses array-form Authorization header to its first value", () => {
        // Express types `req.headers.authorization` as `string | string[] |
        // undefined`. RFC 7230 forbids duplicate Authorization headers, but
        // the runtime can still surface arrays in edge cases; the middleware
        // must not throw when this happens.
        const mw = createAuthMiddleware("secret-token");
        const next = mockNext();
        mw(mockReq({ authorization: ["Bearer secret-token", "Bearer evil"] }), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    // RFC 6750 §2.1 — the auth scheme name MUST be matched case-insensitively.
    // The token portion remains case-sensitive (it is the shared secret).
    it.each([
        ["lowercase scheme", "bearer secret-token"],
        ["uppercase scheme", "BEARER secret-token"],
        ["mixed-case scheme", "BeArEr secret-token"],
    ])("accepts %s with the correct token (RFC 6750 §2.1)", (_label, header) => {
        const mw = createAuthMiddleware("secret-token");
        const next = mockNext();
        mw(mockReq({ authorization: header }), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it("still rejects case-insensitive scheme when the token is wrong", () => {
        // Regression-lock: scheme case insensitivity must not relax token
        // checking. A malformed token under a lowercase `bearer` scheme has
        // to fail with 401, not pass.
        const mw = createAuthMiddleware("secret-token");
        const res = mockRes();
        const next = mockNext();
        mw(mockReq({ authorization: "bearer wrong-token" }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("rejects unknown auth schemes (Basic, Token, …)", () => {
        // Defence-in-depth: non-Bearer schemes must not slip through just
        // because the prefix length and trailing token length happen to
        // match. The scheme slice has to lowercase to "bearer ".
        const mw = createAuthMiddleware("secret-token");
        const res = mockRes();
        const next = mockNext();
        mw(mockReq({ authorization: "Basic1 secret-token" }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

// ─── formatAuthStatus ───

describe("formatAuthStatus", () => {
    it("reports DISABLED when no token is configured", () => {
        // Operators frequently typo MCP_AUTH_TOKEN — a "DISABLED" stderr
        // line at boot is the only way to tell an open server from a
        // protected one without making a request.
        expect(formatAuthStatus(undefined)).toMatch(/DISABLED/);
        expect(formatAuthStatus(undefined)).toContain("MCP_AUTH_TOKEN");
        expect(formatAuthStatus("")).toMatch(/DISABLED/);
    });

    it("reports enabled when a token is configured, without echoing the token", () => {
        const status = formatAuthStatus("super-secret-token-hunter2");
        expect(status).toMatch(/enabled/);
        expect(status).not.toContain("hunter2");
        expect(status).not.toContain("super-secret");
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

// ─── validateAuthToken ───

describe("validateAuthToken", () => {
    // JWT-shaped fixture — exercises the base64url charset (a-zA-Z0-9-_) plus
    // the `.` separator, which `"a".repeat(N)` does not. Regression-locks the
    // contract that PRINTABLE_ASCII accepts the full JWT alphabet.
    const JWT_SHAPED = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc-_DEF123";

    it("accepts undefined (no token configured)", () => {
        expect(() => validateAuthToken(undefined)).not.toThrow();
    });

    it("accepts an empty string (treated as no token)", () => {
        expect(() => validateAuthToken("")).not.toThrow();
    });

    it("accepts a short printable-ASCII token", () => {
        expect(() => validateAuthToken("Bearer-style-token-123")).not.toThrow();
    });

    it("accepts a JWT-shaped token (base64url alphabet + dots)", () => {
        expect(() => validateAuthToken(JWT_SHAPED)).not.toThrow();
    });

    it("accepts a token at the maximum allowed length", () => {
        const token = "a".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH);
        expect(() => validateAuthToken(token)).not.toThrow();
    });

    it("rejects a token over the maximum without echoing it", () => {
        const token = "z".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH + 1);
        try {
            validateAuthToken(token);
            throw new Error("expected validateAuthToken to throw");
        } catch (err) {
            const message = (err as Error).message;
            expect(message).toMatch(/exceeds maximum/);
            expect(message).toContain(`[length=${LIMITS.MAX_AUTH_TOKEN_LENGTH + 1}]`);
            // Token body must never appear in error output (entropy leak).
            expect(message).not.toContain(token);
            expect(message).not.toMatch(/z{10,}/);
        }
    });

    it.each([
        ["newline", "abc\ndef"],
        ["carriage return", "abc\rdef"],
        ["tab", "abc\tdef"],
        ["NUL", "abc\0def"],
        ["DEL (0x7F)", "abc\x7Fdef"],
        ["high-bit char (é)", "abcédef"],
        ["emoji", "abc🔐def"],
    ])("rejects token containing %s", (_label, token) => {
        expect(() => validateAuthToken(token)).toThrow(/printable ASCII/);
    });

    it("redacts the token in the charset error and never echoes the input", () => {
        const token = "abc\ndef-secret-hunter2";
        try {
            validateAuthToken(token);
            throw new Error("expected validateAuthToken to throw");
        } catch (err) {
            const message = (err as Error).message;
            expect(message).toContain("[redacted]");
            expect(message).not.toContain("hunter2");
            expect(message).not.toContain("def-secret");
        }
    });

    it("references the env var name (MCP_AUTH_TOKEN) in error messages", () => {
        // Operators see the env var name in their boot logs, even if they
        // configured the token via McpCurlConfig.authToken — the env var
        // is the canonical externally-visible name.
        expect(() => validateAuthToken("a".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH + 1)))
            .toThrow(/MCP_AUTH_TOKEN/);
        expect(() => validateAuthToken("bad\ntoken")).toThrow(/MCP_AUTH_TOKEN/);
    });
});
