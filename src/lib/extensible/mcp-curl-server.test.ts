// src/lib/extensible/mcp-curl-server.test.ts
// Unit tests for McpCurlServer

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { McpCurlServer } from "./mcp-curl-server.js";
import { MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "../utils/index.js";

describe("McpCurlServer", () => {
    let server: McpCurlServer;

    beforeEach(() => {
        server = new McpCurlServer();
    });

    describe("configure()", () => {
        it("should merge configuration options", () => {
            server.configure({ baseUrl: "https://api.example.com" });
            server.configure({ defaultTimeout: 60 });

            const config = server.getConfig();
            expect(config.baseUrl).toBe("https://api.example.com");
            expect(config.defaultTimeout).toBe(60);
        });

        it("should override existing config values", () => {
            server.configure({ baseUrl: "https://old.com" });
            server.configure({ baseUrl: "https://new.com" });

            expect(server.getConfig().baseUrl).toBe("https://new.com");
        });

        it("should return this for chaining", () => {
            const result = server.configure({ baseUrl: "https://api.example.com" });
            expect(result).toBe(server);
        });

        it("should warn on unknown config keys", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            server.configure({ serverName: "test" } as any);
            expect(warnSpy).toHaveBeenCalledOnce();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('unknown config key "serverName"')
            );
            warnSpy.mockRestore();
        });

        it("should not absorb unknown fields into config", () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            server.configure({ serverName: "test", baseUrl: "https://api.example.com" } as any);
            const config = server.getConfig() as Record<string, unknown>;
            expect(config.baseUrl).toBe("https://api.example.com");
            expect(config.serverName).toBeUndefined();
            vi.restoreAllMocks();
        });

        it("should not warn on known config keys", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            server.configure({ baseUrl: "https://api.example.com", defaultTimeout: 30 });
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

    });

    describe("disableCurlExecute()", () => {
        it("should return this for chaining", () => {
            const result = server.disableCurlExecute();
            expect(result).toBe(server);
        });
    });

    describe("disableJqQuery()", () => {
        it("should return this for chaining", () => {
            const result = server.disableJqQuery();
            expect(result).toBe(server);
        });
    });

    describe("beforeRequest()", () => {
        it("should accept hook function", () => {
            const hook = vi.fn();
            const result = server.beforeRequest(hook);
            expect(result).toBe(server);
        });

        it("should support chaining multiple hooks", () => {
            const hook1 = vi.fn();
            const hook2 = vi.fn();

            server.beforeRequest(hook1).beforeRequest(hook2);
            // No error means success
        });
    });

    describe("afterResponse()", () => {
        it("should accept hook function", () => {
            const hook = vi.fn();
            const result = server.afterResponse(hook);
            expect(result).toBe(server);
        });
    });

    describe("onError()", () => {
        it("should accept hook function", () => {
            const hook = vi.fn();
            const result = server.onError(hook);
            expect(result).toBe(server);
        });
    });

    describe("getConfig()", () => {
        it("should return frozen config after values are set", () => {
            server.configure({ baseUrl: "https://api.example.com" });
            const config = server.getConfig();

            expect(Object.isFrozen(config)).toBe(true);
        });

        it("should return empty frozen config when no configuration set", () => {
            const config = server.getConfig();
            expect(Object.isFrozen(config)).toBe(true);
        });
    });

    describe("utilities()", () => {
        it("should return instance utilities object", () => {
            const utils = server.utilities();
            expect(utils).toHaveProperty("executeRequest");
            expect(utils).toHaveProperty("queryFile");
        });

        it("should apply config to utilities", () => {
            server.configure({ baseUrl: "https://api.example.com" });
            const utils = server.utilities();

            // The utilities should have access to the config
            expect(typeof utils.executeRequest).toBe("function");
            expect(typeof utils.queryFile).toBe("function");
        });

        it("should return different instances before start (no caching)", () => {
            const utils1 = server.utilities();
            const utils2 = server.utilities();
            expect(utils1).not.toBe(utils2);
        });

        it("should invalidate cached utilities after shutdown()", async () => {
            // Simulate post-start frozen state
            (server as any)._started = true;
            (server as any)._frozenConfig = Object.freeze({});

            // With frozen config, utilities() should cache (same instance)
            const cached1 = server.utilities();
            const cached2 = server.utilities();
            expect(cached1).toBe(cached2);

            // After shutdown, cache is cleared — fresh instances again
            await server.shutdown();
            const fresh1 = server.utilities();
            const fresh2 = server.utilities();
            expect(fresh1).not.toBe(cached1);
            expect(fresh1).not.toBe(fresh2);
        });
    });

    describe("getMcpServer()", () => {
        it("should return null before start", () => {
            expect(server.getMcpServer()).toBeNull();
        });
    });

    describe("isStarted()", () => {
        it("should return false before start", () => {
            expect(server.isStarted()).toBe(false);
        });
    });

    describe("fluent chaining", () => {
        it("should support full builder pattern", () => {
            const hook1 = vi.fn();
            const hook2 = vi.fn();
            const hook3 = vi.fn();

            const result = server
                .configure({ baseUrl: "https://api.example.com" })
                .configure({ defaultTimeout: 60 })
                .disableCurlExecute()
                .beforeRequest(hook1)
                .afterResponse(hook2)
                .onError(hook3);

            expect(result).toBe(server);
            expect(server.getConfig().baseUrl).toBe("https://api.example.com");
            expect(server.getConfig().defaultTimeout).toBe(60);
        });
    });
});

describe("McpCurlServer utilities", () => {
    describe("executeRequest with path and baseUrl", () => {
        it("should handle path without baseUrl gracefully", async () => {
            const server = new McpCurlServer();
            const utils = server.utilities();

            // Should return error when no url and no baseUrl configured
            const result = await utils.executeRequest({ path: "/users" });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain("Must provide url or path");
        });

        it("should combine baseUrl and path correctly", async () => {
            const server = new McpCurlServer().configure({
                baseUrl: "https://api.example.com",
            });
            const utils = server.utilities();

            // We can't actually make the request, but we can verify the utility exists
            // and accepts the parameters
            expect(typeof utils.executeRequest).toBe("function");
        });
    });
});

describe("McpCurlServer.registerCustomTool()", () => {
    let server: McpCurlServer;

    beforeEach(() => {
        server = new McpCurlServer();
    });

    it("should return this for chaining", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });
        const result = server.registerCustomTool(
            "my_tool",
            {
                title: "My Tool",
                description: "A custom tool",
                inputSchema: z.object({ query: z.string() }),
            },
            handler
        );
        expect(result).toBe(server);
    });

    it("should support chaining with other methods", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });
        const result = server
            .configure({ baseUrl: "https://api.example.com" })
            .registerCustomTool(
                "my_tool",
                {
                    title: "My Tool",
                    description: "A custom tool",
                    inputSchema: z.object({ query: z.string() }),
                },
                handler
            )
            .disableJqQuery();

        expect(result).toBe(server);
    });

    it("should reject tool name curl_execute", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });
        expect(() =>
            server.registerCustomTool(
                "curl_execute",
                {
                    title: "Override Curl",
                    description: "Try to override",
                    inputSchema: z.object({}),
                },
                handler
            )
        ).toThrow("built-in tool names are reserved");
    });

    it("should reject tool name jq_query", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });
        expect(() =>
            server.registerCustomTool(
                "jq_query",
                {
                    title: "Override JQ",
                    description: "Try to override",
                    inputSchema: z.object({}),
                },
                handler
            )
        ).toThrow("built-in tool names are reserved");
    });

    it("should reject duplicate custom tool names", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });
        server.registerCustomTool(
            "my_tool",
            {
                title: "My Tool",
                description: "First registration",
                inputSchema: z.object({}),
            },
            handler
        );

        expect(() =>
            server.registerCustomTool(
                "my_tool",
                {
                    title: "My Tool Again",
                    description: "Duplicate",
                    inputSchema: z.object({}),
                },
                handler
            )
        ).toThrow('Custom tool "my_tool" is already registered');
    });

    it("should not warn when description is exactly MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH chars", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const handler = vi.fn().mockResolvedValue({ content: [] });
        const exactDesc = "a".repeat(MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH);
        server.registerCustomTool(
            "my_tool",
            { title: "T", description: exactDesc, inputSchema: z.object({}) },
            handler
        );
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("should warn when sanitized description exceeds MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH chars", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const handler = vi.fn().mockResolvedValue({ content: [] });
        // MAX + 1 printable chars — no chars stripped by sanitizeDescription, so sanitized length exceeds limit
        const longDesc = "a".repeat(MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH + 1);
        server.registerCustomTool(
            "my_tool",
            { title: "T", description: longDesc, inputSchema: z.object({}) },
            handler
        );
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("description truncated")
        );
        warnSpy.mockRestore();
    });

    it("should not warn when description shrinks to ≤MAX due to sanitization alone", () => {
        // MAX + 1 chars but the extra char is an attack char stripped by sanitizeDescription.
        // Sanitized length = MAX (exactly at limit), so no truncation warning.
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const handler = vi.fn().mockResolvedValue({ content: [] });
        // MAX printable chars + 1 zero-width space (U+200B stripped to empty by sanitizeDescription)
        const descWithAttackChar = "a".repeat(MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH) + "\u200B";
        server.registerCustomTool(
            "my_tool",
            { title: "T", description: descWithAttackChar, inputSchema: z.object({}) },
            handler
        );
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("should allow multiple different custom tools", () => {
        const handler = vi.fn().mockResolvedValue({ content: [] });

        expect(() => {
            server
                .registerCustomTool(
                    "tool_one",
                    {
                        title: "Tool One",
                        description: "First tool",
                        inputSchema: z.object({}),
                    },
                    handler
                )
                .registerCustomTool(
                    "tool_two",
                    {
                        title: "Tool Two",
                        description: "Second tool",
                        inputSchema: z.object({}),
                    },
                    handler
                );
        }).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// PR-5 / B4 — deep sanitisation of `inputSchema` field descriptions.
//
// Every assertion reads via the public `.description` getter or
// `z.toJSONSchema(...)` — never `_def.description` — because Zod v4 stores
// descriptions in `z.globalRegistry`, and a regression to in-place `_def`
// mutation would silently pass under a `_def`-shaped check.
// ---------------------------------------------------------------------------
describe("McpCurlServer.registerCustomTool() inputSchema deep sanitisation (B4)", () => {
    let server: McpCurlServer;
    const handler = vi.fn().mockResolvedValue({ content: [] });
    const ATTACK = "‮"; // RIGHT-TO-LEFT OVERRIDE — sanitised to ""
    const PWN = `${ATTACK}pwn`;

    beforeEach(() => {
        server = new McpCurlServer();
    });

    /**
     * Cast helper: tests poke at the private `_customTools` array to assert
     * that what survives registration matches the public-getter contract.
     * No production callers should imitate this — the array is private.
     */
    function lastTool(s: McpCurlServer): {
        name: string;
        meta: {
            inputSchema: z.ZodObject<z.ZodRawShape>;
            title: string;
            description: string;
        };
    } {
        const tools = (s as unknown as { _customTools: unknown[] })._customTools;
        return tools[tools.length - 1] as {
            name: string;
            meta: {
                inputSchema: z.ZodObject<z.ZodRawShape>;
                title: string;
                description: string;
            };
        };
    }

    it("strips a bidi override on a top-level field description", () => {
        const inputSchema = z.object({ field: z.string().describe(PWN) });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        expect((sanitised.shape.field as z.ZodString).description).toBe("pwn");
    });

    it("strips a bidi override on an optional field's description", () => {
        const inputSchema = z.object({ q: z.string().optional().describe(PWN) });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const field = sanitised.shape.q as z.ZodOptional<z.ZodString>;
        expect(field.description).toBe("pwn");
        // Wrapper still optional — `.parse(undefined)` is the canonical check
        // (per Zod v4's deprecated `isOptional()` JSDoc).
        expect(field.safeParse(undefined).success).toBe(true);
    });

    it("strips a bidi override on a default-wrapped field, preserving the default", () => {
        const inputSchema = z.object({
            page: z.string().default("first").describe(PWN),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const field = sanitised.shape.page as z.ZodDefault<z.ZodString>;
        expect(field.description).toBe("pwn");
        expect(field.parse(undefined)).toBe("first");
    });

    it("strips a bidi override inside a nested ZodObject (S3)", () => {
        const inputSchema = z.object({
            user: z.object({ name: z.string().describe(PWN) }),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const userObj = sanitised.shape.user as z.ZodObject<{ name: z.ZodString }>;
        expect(userObj.shape.name.description).toBe("pwn");
    });

    it("strips a bidi override inside a ZodArray<ZodObject> element (S3)", () => {
        const inputSchema = z.object({
            tags: z.array(z.object({ label: z.string().describe(PWN) })),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const tags = sanitised.shape.tags as z.ZodArray<z.ZodObject<{ label: z.ZodString }>>;
        expect(tags.element.shape.label.description).toBe("pwn");
    });

    it("strips a bidi override inside every option of a ZodUnion-of-object (S3)", () => {
        const inputSchema = z.object({
            payload: z.union([
                z.object({ a: z.string().describe(PWN) }),
                z.object({ b: z.string().describe(`${ATTACK}b`) }),
            ]),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const union = sanitised.shape.payload as z.ZodUnion<
            [z.ZodObject<{ a: z.ZodString }>, z.ZodObject<{ b: z.ZodString }>]
        >;
        const [optA, optB] = union.options;
        expect(optA.shape.a.description).toBe("pwn");
        expect(optB.shape.b.description).toBe("b");
    });

    it("strips a bidi override on a deeply-nested object reached through ZodOptional (S3)", () => {
        const inputSchema = z.object({
            inner: z.object({ x: z.string().describe(PWN) }).optional(),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const optionalInner = sanitised.shape.inner as z.ZodOptional<
            z.ZodObject<{ x: z.ZodString }>
        >;
        expect(optionalInner.unwrap().shape.x.description).toBe("pwn");
    });

    it("preserves field reference identity when no description is set", () => {
        const stringField = z.string();
        const inputSchema = z.object({ x: stringField });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        // No `.describe()` was called, so the helper has nothing to rebuild
        // for this leaf — the original instance should pass through verbatim.
        expect(sanitised.shape.x).toBe(stringField);
    });

    it("memoises rebuild output: re-registering the same input schema returns the cached output (C3)", () => {
        const sharedSchema = z.object({ field: z.string().describe(PWN) });

        const a = new McpCurlServer();
        const b = new McpCurlServer();
        a.registerCustomTool("t", { title: "T", description: "D", inputSchema: sharedSchema }, handler);
        b.registerCustomTool("t", { title: "T", description: "D", inputSchema: sharedSchema }, handler);

        // Identity equality proves the WeakMap cache hit — the rebuild ran
        // exactly once across both registrations.
        expect(lastTool(a).meta.inputSchema).toBe(lastTool(b).meta.inputSchema);
    });

    it("memoisation is idempotent: feeding the rebuilt schema back in returns it unchanged", () => {
        const inputSchema = z.object({ field: z.string().describe(PWN) });
        server.registerCustomTool("t1", { title: "T", description: "D", inputSchema }, handler);
        const firstRebuild = lastTool(server).meta.inputSchema;

        // Feed the *output* back in — the cache short-circuits on the rebuilt
        // schema's identity (it's mapped to itself), so no new clone happens.
        server.registerCustomTool(
            "t2",
            { title: "T", description: "D", inputSchema: firstRebuild },
            handler
        );
        expect(lastTool(server).meta.inputSchema).toBe(firstRebuild);
    });

    it("z.toJSONSchema() round-trip carries the sanitised description at every depth (Standard-Schema regression / A7)", () => {
        const inputSchema = z.object({
            top: z.string().describe(PWN),
            nested: z.object({ inner: z.string().describe(`${ATTACK}inner`) }),
            arr: z.array(z.object({ label: z.string().describe(`${ATTACK}label`) })),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const json = z.toJSONSchema(lastTool(server).meta.inputSchema) as unknown as {
            properties: {
                top: { description: string };
                nested: { properties: { inner: { description: string } } };
                arr: { items: { properties: { label: { description: string } } } };
            };
        };
        expect(json.properties.top.description).toBe("pwn");
        expect(json.properties.nested.properties.inner.description).toBe("inner");
        expect(json.properties.arr.items.properties.label.description).toBe("label");
        // None of the sanitised descriptions retain the bidi-override codepoint.
        expect(JSON.stringify(json)).not.toContain(ATTACK);
    });
});
