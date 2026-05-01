import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
    createOriginMiddleware,
    createAuthMiddleware,
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
    // Real-world JWT fixtures — header.payload.signature triplets large enough
    // to regression-lock the per-format size assumptions documented in the
    // PR-4 plan body. The `signature` segments are random base64url; they are
    // not signed by any real key and have no semantic meaning.
    const RSA_256_JWT = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjVjMmI3NjYxIn0.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6ImFwaS5leGFtcGxlLmNvbSIsImlzcyI6Imh0dHBzOi8vYXV0aC5leGFtcGxlLmNvbSIsImlhdCI6MTcxNDQwMDAwMCwiZXhwIjoxNzE0NDAzNjAwLCJzY29wZSI6InJlYWQ6cHJvZmlsZSB3cml0ZTpwcm9maWxlIn0.${"a1B2c3D4e5F6g7H8".repeat(40)}`;
    const OIDC_ID_TOKEN = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjVjMmI3NjYxIn0.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6ImNsaWVudC1pZC1leGFtcGxlIiwiaXNzIjoiaHR0cHM6Ly9hY2NvdW50cy5leGFtcGxlLmNvbSIsImlhdCI6MTcxNDQwMDAwMCwiZXhwIjoxNzE0NDAzNjAwLCJub25jZSI6ImFiYzEyMyIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiSmFuZSBEb2UiLCJwaWN0dXJlIjoiaHR0cHM6Ly9leGFtcGxlLmNvbS9hdmF0YXIvamFuZS5wbmcifQ.${"X9y8Z7w6V5u4T3s2".repeat(100)}`;

    it("accepts undefined (no token configured)", () => {
        expect(() => validateAuthToken(undefined)).not.toThrow();
    });

    it("accepts an empty string (treated as no token)", () => {
        expect(() => validateAuthToken("")).not.toThrow();
    });

    it("accepts a short printable-ASCII token", () => {
        expect(() => validateAuthToken("Bearer-style-token-123")).not.toThrow();
    });

    it("accepts a token at the maximum allowed length", () => {
        const token = "a".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH);
        expect(() => validateAuthToken(token)).not.toThrow();
    });

    it("rejects a token one character over the maximum", () => {
        const token = "a".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH + 1);
        expect(() => validateAuthToken(token)).toThrow(/exceeds maximum/);
    });

    it("includes the length but not the token value in the over-length error", () => {
        const token = "z".repeat(LIMITS.MAX_AUTH_TOKEN_LENGTH + 1);
        try {
            validateAuthToken(token);
            throw new Error("expected validateAuthToken to throw");
        } catch (err) {
            const message = (err as Error).message;
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

    it("accepts a real-world RSA-256 JWT (~700+ chars, regression lock)", () => {
        // The 256-char cap proposed in an earlier draft of B5 would have
        // rejected this. The 4096 cap accepts it.
        expect(RSA_256_JWT.length).toBeGreaterThan(700);
        expect(() => validateAuthToken(RSA_256_JWT)).not.toThrow();
    });

    it("accepts a real-world OIDC ID token (~1700+ chars, regression lock)", () => {
        expect(OIDC_ID_TOKEN.length).toBeGreaterThan(1700);
        expect(() => validateAuthToken(OIDC_ID_TOKEN)).not.toThrow();
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
