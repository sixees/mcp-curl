// src/lib/config/defaults.test.ts
// Tests for default User-Agent/Referer resolution logic

import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveDefault, applyDefaultHeaders, hasHeaderKey, DEFAULT_USER_AGENT, DEFAULT_REFERER } from "./defaults.js";

describe("resolveDefault", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("should return config value when provided", () => {
        const result = resolveDefault("custom-value", "UNUSED_ENV", "built-in");
        expect(result).toBe("custom-value");
    });

    it("should fall back to env var when config is undefined", () => {
        vi.stubEnv("TEST_ENV_VAR", "env-value");
        const result = resolveDefault(undefined, "TEST_ENV_VAR", "built-in");
        expect(result).toBe("env-value");
    });

    it("should fall back to built-in default when both config and env are undefined", () => {
        const result = resolveDefault(undefined, "NONEXISTENT_ENV_VAR", "built-in");
        expect(result).toBe("built-in");
    });

    it("should return undefined when config is empty string (disabled)", () => {
        const result = resolveDefault("", "UNUSED_ENV", "built-in");
        expect(result).toBeUndefined();
    });

    it("should return undefined when env var is empty string (disabled)", () => {
        vi.stubEnv("TEST_ENV_VAR", "");
        const result = resolveDefault(undefined, "TEST_ENV_VAR", "built-in");
        expect(result).toBeUndefined();
    });

    it("should prefer config over env var", () => {
        vi.stubEnv("TEST_ENV_VAR", "env-value");
        const result = resolveDefault("config-value", "TEST_ENV_VAR", "built-in");
        expect(result).toBe("config-value");
    });

    it("should prefer env var over built-in", () => {
        vi.stubEnv("TEST_ENV_VAR", "env-value");
        const result = resolveDefault(undefined, "TEST_ENV_VAR", "built-in");
        expect(result).toBe("env-value");
    });

    it("should return undefined when built-in default is empty string", () => {
        const result = resolveDefault(undefined, "NONEXISTENT_ENV_VAR", "");
        expect(result).toBeUndefined();
    });
});

describe("DEFAULT_USER_AGENT", () => {
    it("should contain mcp-curl/", () => {
        expect(DEFAULT_USER_AGENT).toContain("mcp-curl/");
    });

    it("should contain a browser-like prefix", () => {
        expect(DEFAULT_USER_AGENT).toContain("Mozilla/5.0");
    });
});

describe("DEFAULT_REFERER", () => {
    it("should be empty string (disabled by default)", () => {
        expect(DEFAULT_REFERER).toBe("");
    });
});

describe("hasHeaderKey", () => {
    it("should find exact-case match", () => {
        expect(hasHeaderKey({ "User-Agent": "test" }, "User-Agent")).toBe(true);
    });

    it("should find lowercase key when searching title-case", () => {
        expect(hasHeaderKey({ "user-agent": "test" }, "User-Agent")).toBe(true);
    });

    it("should find uppercase key when searching title-case", () => {
        expect(hasHeaderKey({ "REFERER": "test" }, "Referer")).toBe(true);
    });

    it("should return false when key is absent", () => {
        expect(hasHeaderKey({ "X-Custom": "test" }, "User-Agent")).toBe(false);
    });
});

describe("applyDefaultHeaders", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("should not overwrite explicit empty User-Agent in headers", () => {
        const result = applyDefaultHeaders({ "User-Agent": "" }, undefined);
        expect(result.headers["User-Agent"]).toBe("");
        expect(result.userAgent).toBeUndefined();
    });

    it("should not overwrite explicit empty Referer in headers", () => {
        vi.stubEnv("MCP_CURL_REFERER", "https://env.com");
        const result = applyDefaultHeaders({ "Referer": "" }, undefined);
        expect(result.headers["Referer"]).toBe("");
    });

    it("should preserve existing user_agent param", () => {
        const result = applyDefaultHeaders({}, "custom-ua");
        expect(result.userAgent).toBe("custom-ua");
        expect(result.headers["User-Agent"]).toBeUndefined();
    });

    it("should resolve UA when neither user_agent nor User-Agent header present", () => {
        const result = applyDefaultHeaders({}, undefined);
        expect(result.userAgent).toBe(DEFAULT_USER_AGENT);
    });

    it("should resolve Referer from config when not in headers", () => {
        const result = applyDefaultHeaders({}, undefined, { defaultReferer: "https://config.com" });
        expect(result.headers["Referer"]).toBe("https://config.com");
    });

    it("should use config overrides for both UA and Referer", () => {
        const result = applyDefaultHeaders({}, undefined, {
            defaultUserAgent: "config-ua",
            defaultReferer: "https://config-ref.com",
        });
        expect(result.userAgent).toBe("config-ua");
        expect(result.headers["Referer"]).toBe("https://config-ref.com");
    });

    it("should not inject Referer when built-in default is empty", () => {
        const result = applyDefaultHeaders({}, undefined);
        expect(result.headers["Referer"]).toBeUndefined();
    });

    it("should detect lowercase user-agent as existing (case-insensitive)", () => {
        const result = applyDefaultHeaders({ "user-agent": "custom" }, undefined);
        expect(result.userAgent).toBeUndefined();
    });

    it("should detect uppercase REFERER as existing (case-insensitive)", () => {
        const result = applyDefaultHeaders({ "REFERER": "https://custom.com" }, undefined, {
            defaultReferer: "https://config.com",
        });
        expect(result.headers["Referer"]).toBeUndefined();
        expect(result.headers["REFERER"]).toBe("https://custom.com");
    });

    it("should not modify original headers object", () => {
        const original = { "X-Custom": "value" };
        const result = applyDefaultHeaders(original, undefined);
        expect(original).not.toHaveProperty("User-Agent");
        expect(result.headers["X-Custom"]).toBe("value");
    });
});
