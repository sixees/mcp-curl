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
//
// Implementation lives in `./schema-sanitizer.ts`. The walker mutates
// `z.globalRegistry` entries on the *caller's* schema in place — this
// preserves runtime invariants that `z.object(newShape)` / `z.array(elem)` /
// `z.union(opts)` rebuilds would silently strip (`.refine()`, `.check()`,
// `.strict()`, array length checks, factory defaults, discriminated-union
// discriminator). The block below covers both the sanitisation contract and
// the invariant-preservation contract.
// ---------------------------------------------------------------------------
describe("McpCurlServer.registerCustomTool() inputSchema deep sanitisation (B4)", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE. Written as an escape (not a literal
    // bidi codepoint) so the source file is safe to view in editors that
    // honour the override. Sanitised to "" by `sanitizeDescription`.
    const ATTACK = "\u202E";
    const PWN = `${ATTACK}pwn`;

    let server: McpCurlServer;
    // Stateless mock — re-using across tests is safe (the suite asserts on
    // schema mutation, not on handler call counts). Mirrors the pattern used
    // by the rest of this file.
    const handler = vi.fn().mockResolvedValue({ content: [] });

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

    // -------- core sanitisation contract (depth + wrapper coverage) --------

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

    it("strips a bidi override on a nullable-wrapped field", () => {
        const inputSchema = z.object({ q: z.string().nullable().describe(PWN) });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const field = sanitised.shape.q as z.ZodNullable<z.ZodString>;
        expect(field.description).toBe("pwn");
        expect(field.safeParse(null).success).toBe(true);
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

    it("strips a bidi override on a wrapper that itself carries the description", () => {
        const inputSchema = z.object({
            // Outer `.describe()` clones the optional wrapper and registers PWN
            // *on the wrapper itself*, not the inner string. The walker must
            // sanitise the wrapper's own entry — not just the inner schema.
            field: z.string().optional().describe(PWN),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        expect((sanitised.shape.field as z.ZodOptional<z.ZodString>).description).toBe("pwn");
    });

    it("returns the same schema instance — mutates registry in place", () => {
        const inputSchema = z.object({ field: z.string().describe(PWN) });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        // The walker's contract is: same object identity, mutated registry
        // entries. Callers that re-use the schema reference downstream see
        // the sanitised description (security-improving mutation).
        expect(lastTool(server).meta.inputSchema).toBe(inputSchema);
    });

    it("is idempotent — re-registering the same (already-clean) schema is a no-op", () => {
        const inputSchema = z.object({ field: z.string().describe(PWN) });
        server.registerCustomTool("t1", { title: "T", description: "D", inputSchema }, handler);
        // After the first walk, every description is clean. A second walk
        // should leave each description identical (no change-on-equal write).
        server.registerCustomTool("t2", { title: "T", description: "D", inputSchema }, handler);
        expect((inputSchema.shape.field as z.ZodString).description).toBe("pwn");
    });

    // -------- runtime-invariant preservation (P1 regressions caught) --------

    it("preserves `.refine()` checks on a ZodObject after sanitisation", () => {
        const refined = z
            .object({ a: z.number(), b: z.number().describe(PWN) })
            .refine((v) => v.a < v.b, "a must be < b");
        // ZodObject<...>.refine() returns ZodObject in v4 — but the public
        // typings widen to `ZodType`. We cast through unknown to keep the
        // test focused on the runtime parse contract.
        const inputSchema = refined as unknown as z.ZodObject<z.ZodRawShape>;
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        // Refinement still fires after sanitisation — proves we did not
        // rebuild via `z.object(newShape)` (which would have stripped it).
        const result = (lastTool(server).meta.inputSchema as unknown as typeof refined).safeParse({
            a: 5,
            b: 3,
        });
        expect(result.success).toBe(false);
    });

    it("preserves `.strict()` mode on a ZodObject after sanitisation", () => {
        const strict = z
            .object({ a: z.string().describe(PWN) })
            .strict();
        const inputSchema = strict as unknown as z.ZodObject<z.ZodRawShape>;
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        // Unknown key must still be rejected — proves catchall("strict") was
        // preserved (a rebuild would downgrade to "strip" mode).
        const result = (lastTool(server).meta.inputSchema as unknown as typeof strict).safeParse({
            a: "ok",
            extra: "bad",
        });
        expect(result.success).toBe(false);
    });

    it("preserves `z.array().min()` length checks after sanitisation", () => {
        const inputSchema = z.object({
            tags: z.array(z.string().describe(PWN)).min(2),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        // Array of length 1 must still be rejected.
        const result = lastTool(server).meta.inputSchema.safeParse({ tags: ["one"] });
        expect(result.success).toBe(false);
    });

    it("preserves a factory `default(() => ...)` (does not freeze the closure)", () => {
        let counter = 0;
        const inputSchema = z.object({
            id: z
                .string()
                .default(() => `id-${++counter}`)
                .describe(PWN),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        // Two parses must yield two different ids — proves the factory
        // closure survived. A rebuild via `.default(field._def.defaultValue)`
        // would have evaluated the getter once and frozen the result.
        const a = sanitised.parse({}) as { id: string };
        const b = sanitised.parse({}) as { id: string };
        expect(a.id).not.toBe(b.id);
    });

    it("preserves a ZodDiscriminatedUnion's discriminator after sanitisation", () => {
        const du = z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("a"), a: z.string().describe(PWN) }),
            z.object({ kind: z.literal("b"), b: z.string().describe(`${ATTACK}b`) }),
        ]);
        const inputSchema = z.object({ payload: du });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        // Parse a value matching the "a" arm — discriminator routing must
        // still work. A rebuild via `z.union(opts)` would have downgraded the
        // discriminated union to a plain ZodUnion (still parses, but error
        // messages and runtime behaviour differ).
        const sanitised = lastTool(server).meta.inputSchema;
        expect(sanitised.safeParse({ payload: { kind: "a", a: "ok" } }).success).toBe(true);
        // Descriptions still sanitised at every arm.
        const arms = (sanitised.shape.payload as typeof du).options as readonly z.ZodObject<
            z.ZodRawShape
        >[];
        expect((arms[0].shape.a as z.ZodString).description).toBe("pwn");
        expect((arms[1].shape.b as z.ZodString).description).toBe("b");
    });

    // -------- additional wrapper coverage (Tuple/Record/Intersection/Pipe/Lazy/Readonly) --------

    it("strips a bidi override on every item of a ZodTuple (and the rest type)", () => {
        const inputSchema = z.object({
            pair: z.tuple(
                [z.string().describe(PWN), z.number().describe(`${ATTACK}n`)],
                z.boolean().describe(`${ATTACK}rest`),
            ),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const tuple = sanitised.shape.pair as z.ZodTuple;
        const def = tuple.def as unknown as {
            items: readonly z.ZodTypeAny[];
            rest: z.ZodTypeAny | null;
        };
        expect(def.items[0].description).toBe("pwn");
        expect(def.items[1].description).toBe("n");
        expect(def.rest?.description).toBe("rest");
    });

    it("strips a bidi override on a ZodRecord's key and value descriptions", () => {
        const inputSchema = z.object({
            headers: z.record(z.string().describe(PWN), z.number().describe(`${ATTACK}n`)),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const record = sanitised.shape.headers as z.ZodRecord<z.ZodString, z.ZodNumber>;
        expect(record.keyType.description).toBe("pwn");
        expect(record.valueType.description).toBe("n");
    });

    it("strips a bidi override on both arms of a ZodIntersection", () => {
        const inputSchema = z.object({
            combo: z.intersection(
                z.object({ a: z.string().describe(PWN) }),
                z.object({ b: z.number().describe(`${ATTACK}b`) }),
            ),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const intersection = sanitised.shape.combo as z.ZodIntersection<
            z.ZodObject<{ a: z.ZodString }>,
            z.ZodObject<{ b: z.ZodNumber }>
        >;
        const def = intersection.def as unknown as {
            left: z.ZodObject<{ a: z.ZodString }>;
            right: z.ZodObject<{ b: z.ZodNumber }>;
        };
        expect(def.left.shape.a.description).toBe("pwn");
        expect(def.right.shape.b.description).toBe("b");
    });

    it("strips a bidi override on the source schema inside a ZodPipe (`.transform()`)", () => {
        const inputSchema = z.object({
            derived: z.string().describe(PWN).transform((s) => s.length),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const piped = sanitised.shape.derived as unknown as { in: z.ZodString };
        expect(piped.in.description).toBe("pwn");
        // Transform still fires after sanitisation — the pipe was not rebuilt.
        expect(sanitised.parse({ derived: "hello" })).toEqual({ derived: 5 });
    });

    it("strips a bidi override on the schema returned by a ZodLazy getter", () => {
        const inner = z.string().describe(PWN);
        const inputSchema = z.object({ deferred: z.lazy(() => inner) });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const lazy = sanitised.shape.deferred as z.ZodLazy<z.ZodString>;
        expect(lazy.unwrap().description).toBe("pwn");
    });

    it("strips a bidi override through a ZodReadonly wrapper", () => {
        const inputSchema = z.object({
            frozen: z.string().describe(PWN).readonly(),
        });
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const readonly = sanitised.shape.frozen as z.ZodReadonly<z.ZodString>;
        expect(readonly.unwrap().description).toBe("pwn");
    });

    it("does not loop on a recursive ZodLazy — cycle guard short-circuits", () => {
        // Canonical recursive-type pattern: a named const with a lazy
        // back-edge. The inner lazy's getter returns the same `Tree`
        // reference, so the WeakSet must detect the back-edge and stop.
        type Tree = { label: string; children: Tree[] };
        const Tree: z.ZodType<Tree> = z.object({
            label: z.string().describe(PWN),
            children: z.array(z.lazy((): z.ZodType<Tree> => Tree)),
        }) as unknown as z.ZodType<Tree>;
        const inputSchema = z.object({
            root: Tree as unknown as z.ZodObject<{ label: z.ZodString }>,
        });
        // Should return synchronously (no infinite recursion).
        server.registerCustomTool("t", { title: "T", description: "D", inputSchema }, handler);
        const sanitised = lastTool(server).meta.inputSchema;
        const root = sanitised.shape.root as z.ZodObject<{ label: z.ZodString }>;
        expect(root.shape.label.description).toBe("pwn");
    });

    // -------- regression for `z.toJSONSchema()` (Standard-Schema integration) --------

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
