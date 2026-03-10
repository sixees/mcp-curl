// src/lib/config/defaults.test.ts
// Tests for default User-Agent/Referer resolution logic

import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveDefault, DEFAULT_USER_AGENT, DEFAULT_REFERER } from "./defaults.js";

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
