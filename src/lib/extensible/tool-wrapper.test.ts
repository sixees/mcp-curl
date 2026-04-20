// src/lib/extensible/tool-wrapper.test.ts
// Tests for applyConfigTransformsCurl default User-Agent and Referer behavior,
// and maybeApplySpotlighting via registerCurlToolWithHooks.

import { describe, it, expect, afterEach, vi } from "vitest";
import { applyConfigTransformsCurl, registerCurlToolWithHooks } from "./tool-wrapper.js";
import type { McpCurlConfig, CurlExecuteInput } from "../types/public.js";
import { DEFAULT_USER_AGENT } from "../config/index.js";

// ---------------------------------------------------------------------------
// Spotlighting tests
// ---------------------------------------------------------------------------

describe("spotlighting (maybeApplySpotlighting)", () => {
    it("wraps text content in sentinel tags when enableSpotlighting is true", async () => {
        // Build a minimal fake McpServer that captures the registered handler
        let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null;
        const fakeServer = {
            registerTool: (_name: string, _meta: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
                capturedHandler = handler;
            },
        };

        // Mock executeWithHooks to return a simple text result
        const mockExecutor = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "hello from api" }],
            isError: false,
        });

        registerCurlToolWithHooks(fakeServer as never, {
            executor: mockExecutor as never,
            enabled: true,
            config: { enableSpotlighting: true } as McpCurlConfig,
            hooks: { beforeRequest: [], afterResponse: [], onError: [] },
        });

        expect(capturedHandler).not.toBeNull();
        const result = await capturedHandler!({
            url: "https://example.com",
            follow_redirects: true,
            insecure: false,
            verbose: false,
            include_headers: false,
            compressed: true,
            include_metadata: false,
        }, { sessionId: undefined });

        const text = (result as { content: { text: string }[] }).content[0].text;
        expect(text).toMatch(/^---EXTERNAL-CONTENT-BEGIN-[0-9a-f-]{36}---/);
        expect(text).toContain("hello from api");
        expect(text).toMatch(/---EXTERNAL-CONTENT-END-[0-9a-f-]{36}---$/);
    });

    it("does not wrap content when enableSpotlighting is false", async () => {
        let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null;
        const fakeServer = {
            registerTool: (_name: string, _meta: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
                capturedHandler = handler;
            },
        };

        const mockExecutor = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "hello from api" }],
            isError: false,
        });

        registerCurlToolWithHooks(fakeServer as never, {
            executor: mockExecutor as never,
            enabled: true,
            config: { enableSpotlighting: false } as McpCurlConfig,
            hooks: { beforeRequest: [], afterResponse: [], onError: [] },
        });

        const result = await capturedHandler!({
            url: "https://example.com",
            follow_redirects: true,
            insecure: false,
            verbose: false,
            include_headers: false,
            compressed: true,
            include_metadata: false,
        }, { sessionId: undefined });

        const text = (result as { content: { text: string }[] }).content[0].text;
        expect(text).toBe("hello from api");
    });

    it("does not wrap error results", async () => {
        let capturedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null;
        const fakeServer = {
            registerTool: (_name: string, _meta: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
                capturedHandler = handler;
            },
        };

        const mockExecutor = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Error: something went wrong" }],
            isError: true,
        });

        registerCurlToolWithHooks(fakeServer as never, {
            executor: mockExecutor as never,
            enabled: true,
            config: { enableSpotlighting: true } as McpCurlConfig,
            hooks: { beforeRequest: [], afterResponse: [], onError: [] },
        });

        const result = await capturedHandler!({
            url: "https://example.com",
            follow_redirects: true,
            insecure: false,
            verbose: false,
            include_headers: false,
            compressed: true,
            include_metadata: false,
        }, { sessionId: undefined });

        const text = (result as { content: { text: string }[] }).content[0].text;
        expect(text).toBe("Error: something went wrong");
        expect(text).not.toContain("<response");
    });

    // Note: ToolResult guarantees content[0].type === "text" via the type system.
    // Non-text content items cannot be returned by the executor in practice.
});

function makeParams(overrides: Partial<CurlExecuteInput> = {}): CurlExecuteInput {
    return {
        url: "https://example.com",
        follow_redirects: true,
        insecure: false,
        verbose: false,
        include_headers: false,
        compressed: true,
        include_metadata: false,
        ...overrides,
    };
}

describe("applyConfigTransformsCurl — User-Agent defaults", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("should inject built-in default User-Agent when no overrides", () => {
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.user_agent).toBe(DEFAULT_USER_AGENT);
    });

    it("should not override user_agent param", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ user_agent: "custom-ua" }),
            {}
        );
        expect(result.user_agent).toBe("custom-ua");
    });

    it("should not inject user_agent when headers['User-Agent'] is set", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ headers: { "User-Agent": "header-ua" } }),
            {}
        );
        expect(result.user_agent).toBeUndefined();
    });

    it("should use config.defaultUserAgent over built-in", () => {
        const config: McpCurlConfig = { defaultUserAgent: "config-ua" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.user_agent).toBe("config-ua");
    });

    it("should disable User-Agent when config.defaultUserAgent is empty string", () => {
        const config: McpCurlConfig = { defaultUserAgent: "" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.user_agent).toBeUndefined();
    });

    it("should use env var over built-in", () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", "env-ua");
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.user_agent).toBe("env-ua");
    });

    it("should disable User-Agent when env var is empty string", () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", "");
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.user_agent).toBeUndefined();
    });

    it("should use config.defaultUserAgent over env var", () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", "env-ua");
        const config: McpCurlConfig = { defaultUserAgent: "config-ua" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.user_agent).toBe("config-ua");
    });

    it("should not override User-Agent from defaultHeaders", () => {
        const config: McpCurlConfig = { defaultHeaders: { "User-Agent": "headers-ua" } };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.user_agent).toBeUndefined();
        expect(result.headers?.["User-Agent"]).toBe("headers-ua");
    });

    it("should detect lowercase user-agent in defaultHeaders (case-insensitive)", () => {
        const config: McpCurlConfig = { defaultHeaders: { "user-agent": "custom" } };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.user_agent).toBeUndefined();
        expect(result.headers?.["user-agent"]).toBe("custom");
    });
});

describe("applyConfigTransformsCurl — Referer defaults", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("should not inject Referer by default (built-in is disabled)", () => {
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.headers?.["Referer"]).toBeUndefined();
    });

    it("should not override Referer when set in params.headers", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ headers: { Referer: "https://custom.com" } }),
            {}
        );
        expect(result.headers?.["Referer"]).toBe("https://custom.com");
    });

    it("should use config.defaultReferer over built-in", () => {
        const config: McpCurlConfig = { defaultReferer: "https://config.com" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBe("https://config.com");
    });

    it("should disable Referer when config.defaultReferer is empty string", () => {
        const config: McpCurlConfig = { defaultReferer: "" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBeUndefined();
    });

    it("should use env var over built-in", () => {
        vi.stubEnv("MCP_CURL_REFERER", "https://env.com");
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.headers?.["Referer"]).toBe("https://env.com");
    });

    it("should disable Referer when env var is empty string", () => {
        vi.stubEnv("MCP_CURL_REFERER", "");
        const result = applyConfigTransformsCurl(makeParams(), {});
        expect(result.headers?.["Referer"]).toBeUndefined();
    });

    it("should use config.defaultReferer over env var", () => {
        vi.stubEnv("MCP_CURL_REFERER", "https://env.com");
        const config: McpCurlConfig = { defaultReferer: "https://config.com" };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBe("https://config.com");
    });

    it("should not override Referer from defaultHeaders", () => {
        const config: McpCurlConfig = { defaultHeaders: { Referer: "https://headers.com" } };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBe("https://headers.com");
    });

    it("should preserve other headers when no Referer injected", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ headers: { "X-Custom": "value" } }),
            {}
        );
        expect(result.headers?.["X-Custom"]).toBe("value");
        expect(result.headers?.["Referer"]).toBeUndefined();
    });

    it("should prefer defaultHeaders over config.defaultReferer", () => {
        const config: McpCurlConfig = {
            defaultHeaders: { Referer: "https://headers.com" },
            defaultReferer: "https://config.com",
        };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBe("https://headers.com");
    });
});

describe("applyConfigTransformsCurl — truthiness edge cases", () => {
    it("should respect explicit empty user_agent param", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ user_agent: "" }),
            {}
        );
        // Empty string user_agent is falsy but was explicitly set — however,
        // user_agent is resolved via applyDefaultHeaders which checks undefined,
        // and empty string is not undefined, so the default should NOT be applied
        expect(result.user_agent).toBe("");
    });

    it("should respect explicit empty User-Agent in headers", () => {
        const result = applyConfigTransformsCurl(
            makeParams({ headers: { "User-Agent": "" } }),
            {}
        );
        expect(result.headers?.["User-Agent"]).toBe("");
        expect(result.user_agent).toBeUndefined();
    });

    it("should respect explicit empty Referer in headers", () => {
        const config: McpCurlConfig = { defaultReferer: "https://config.com" };
        const result = applyConfigTransformsCurl(
            makeParams({ headers: { Referer: "" } }),
            config
        );
        expect(result.headers?.["Referer"]).toBe("");
    });

    it("should respect explicit empty User-Agent in defaultHeaders", () => {
        const config: McpCurlConfig = { defaultHeaders: { "User-Agent": "" } };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["User-Agent"]).toBe("");
        expect(result.user_agent).toBeUndefined();
    });

    it("should respect explicit empty Referer in defaultHeaders", () => {
        const config: McpCurlConfig = {
            defaultHeaders: { Referer: "" },
            defaultReferer: "https://config.com",
        };
        const result = applyConfigTransformsCurl(makeParams(), config);
        expect(result.headers?.["Referer"]).toBe("");
    });
});
