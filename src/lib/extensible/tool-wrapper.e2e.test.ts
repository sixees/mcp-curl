// src/lib/extensible/tool-wrapper.e2e.test.ts
// curl_execute through a real MCP client, so the SDK's own input parse runs.
// A fake `registerTool` skips that parse, so a schema that rejects what the
// handler expects — a relative `url` under `baseUrl` — passes every such test.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCurlToolWithHooks } from "./tool-wrapper.js";
import { connectInMemory, type InMemoryConnection } from "./in-memory-client.test-fixture.js";
import type { CurlToolExecutor } from "./types.js";
import type { McpCurlConfig } from "../types/public.js";
import { createServer } from "../server/server-factory.js";
import { SERVER } from "../config/index.js";
import { CURL_EXECUTE_TOOL_META, executeCurlRequest } from "../tools/curl-execute.js";

const BASE = "https://api.example.com/v1";

let connection: InMemoryConnection | undefined;

afterEach(async () => {
    await connection?.close();
    connection = undefined;
});

function okExecutor() {
    return vi.fn<CurlToolExecutor>().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
    });
}

async function connectCurl(config: McpCurlConfig, executor: CurlToolExecutor, enabled = true) {
    const server = createServer();
    registerCurlToolWithHooks(server, {
        executor,
        enabled,
        config,
        hooks: { beforeRequest: [], afterResponse: [], onError: [] },
    });
    connection = await connectInMemory(server);
    return connection.client;
}

function textOf(result: Awaited<ReturnType<InMemoryConnection["client"]["callTool"]>>): string {
    return (result.content as { text: string }[]).map((part) => part.text).join("\n");
}

describe("curl_execute with baseUrl, through a real MCP client", () => {
    it("resolves a relative url against the base before the executor runs", async () => {
        const executor = okExecutor();
        const client = await connectCurl({ baseUrl: BASE }, executor);

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "/users/me" } });

        expect(result.isError).toBeFalsy();
        expect(executor).toHaveBeenCalledOnce();
        expect(executor.mock.calls[0][0].url).toBe(`${BASE}/users/me`);
    });

    it("advertises url as an absolute URI or a /-path, never a uri-formatted path", async () => {
        const client = await connectCurl({ baseUrl: BASE }, okExecutor());

        const { tools } = await client.listTools();
        const url = (tools[0].inputSchema.properties as Record<string, { anyOf?: object[] }>).url;

        expect(url.anyOf).toEqual([
            expect.objectContaining({ format: "uri" }),
            expect.objectContaining({ pattern: expect.any(String) }),
        ]);
        expect(url.anyOf![1]).not.toHaveProperty("format");
    });

    it("passes an absolute url to another host through unchanged", async () => {
        const executor = okExecutor();
        const client = await connectCurl({ baseUrl: BASE }, executor);

        await client.callTool({ name: "curl_execute", arguments: { url: "https://other.example/x" } });

        expect(executor.mock.calls[0][0].url).toBe("https://other.example/x");
    });

    // A refusal the model can read: a tool result naming the code, where a
    // schema rejection would be a protocol error it never sees.
    it.each(["//evil.com", "/\\evil.com", "\\\\evil.com", "\\evil.com", "/a\tb", "/a\r\nHost: evil.com"])(
        "refuses %j as a LOCAL_REFUSED_PATH tool result",
        async (url) => {
            const executor = okExecutor();
            const client = await connectCurl({ baseUrl: BASE }, executor);

            const result = await client.callTool({ name: "curl_execute", arguments: { url } });

            expect(result.isError).toBe(true);
            expect(textOf(result)).toContain("Refused locally: no request was sent (LOCAL_REFUSED_PATH).");
            expect(textOf(result)).not.toContain("evil.com");
            expect(executor).not.toHaveBeenCalled();
        }
    );

    it("still rejects an absolute non-http(s) url at the schema", async () => {
        const executor = okExecutor();
        const client = await connectCurl({ baseUrl: BASE }, executor);

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "ftp://x" } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).not.toContain("LOCAL_REFUSED_PATH");
        expect(textOf(result)).toMatch(/validation/i);
        expect(executor).not.toHaveBeenCalled();
    });

    it("refuses a relative url with a dot-segment before the executor runs", async () => {
        const executor = okExecutor();
        const client = await connectCurl({ baseUrl: BASE }, executor);

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "/users/../admin" } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(". or .. path segment");
        expect(executor).not.toHaveBeenCalled();
    });

    it("refuses a malformed baseUrl with an error naming the key, not the value", async () => {
        const executor = okExecutor();
        const client = await connectCurl({ baseUrl: "https://SECRETHOST:notaport" }, executor);

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "/users" } });
        const text = textOf(result);

        expect(result.isError).toBe(true);
        expect(executor).not.toHaveBeenCalled();
        expect(text).toContain("baseUrl");
        expect(text).not.toContain("SECRETHOST");
    });

    it("leaves the joined url to the real executor's SSRF gate", async () => {
        // allowLocalhost pinned off, so an exported MCP_CURL_ALLOW_LOCALHOST
        // cannot turn this into a real request.
        const client = await connectCurl({ baseUrl: "http://127.0.0.1" }, (params) =>
            executeCurlRequest(params, { allowLocalhost: false })
        );

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "/admin" } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("internal/private networks are not allowed");
    });
});

describe("curl_execute without baseUrl, through a real MCP client", () => {
    it("rejects a relative url at the schema", async () => {
        const executor = okExecutor();
        const client = await connectCurl({}, executor);

        const result = await client.callTool({ name: "curl_execute", arguments: { url: "/users/me" } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("Must be a valid URL");
        expect(executor).not.toHaveBeenCalled();
    });

    it("advertises exactly the static tool listing", async () => {
        const client = await connectCurl({}, okExecutor());
        const { tools } = await client.listTools();
        await connection!.close();

        const reference: McpServer = createServer();
        reference.registerTool("curl_execute", CURL_EXECUTE_TOOL_META, async () => ({ content: [] }));
        connection = await connectInMemory(reference);
        const { tools: expected } = await connection.client.listTools();

        expect(tools).toEqual(expected);
    });
});

describe("curl_execute description, through a real MCP client", () => {
    async function listedDescription(config: McpCurlConfig): Promise<string> {
        const client = await connectCurl(config, okExecutor());
        const { tools } = await client.listTools();
        return tools[0].description!;
    }

    it("keeps the summary on line 1 and ends the built-in text with the version token", async () => {
        const lines = (await listedDescription({})).split("\n");

        expect(lines[0]).toBe("Execute an HTTP request using cURL with structured parameters.");
        expect(lines.at(-1)).toBe(`mcp-curl v${SERVER.VERSION}`);
        expect(lines.at(-1)).toMatch(/^mcp-curl v\d+\.\d+\.\d+$/);
    });

    it("puts the embedder append after the version line, leaving the built-in text unchanged", async () => {
        const append = "Paths are relative to /api/v9.\nA 402 means the hourly quota is spent.";

        const description = await listedDescription({ curlExecuteDescriptionAppend: append });

        expect(description).toBe(`${CURL_EXECUTE_TOOL_META.description}\n\n${append}`);
        expect(CURL_EXECUTE_TOOL_META.description.endsWith(`mcp-curl v${SERVER.VERSION}`)).toBe(true);
    });

    it("leaves the append off a disabled tool, which is still listed", async () => {
        const client = await connectCurl({ curlExecuteDescriptionAppend: "Fronts the example API." }, okExecutor(), false);

        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name)).toEqual(["curl_execute"]);
        expect(tools[0].description).toBe(CURL_EXECUTE_TOOL_META.description);
    });

    it("composes the append with the baseUrl schema rather than replacing it", async () => {
        const client = await connectCurl(
            { baseUrl: BASE, curlExecuteDescriptionAppend: "Fronts the example API." },
            okExecutor()
        );
        const { tools } = await client.listTools();
        const url = (tools[0].inputSchema.properties as Record<string, { anyOf?: object[] }>).url;

        expect(tools[0].description!.endsWith("\n\nFronts the example API.")).toBe(true);
        expect(url.anyOf).toHaveLength(2);
    });
});
