// src/lib/extensible/tool-capture.test-fixture.ts
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file; `file-saver.test.ts`'s *nothing in
// production imports a test-only module* sweep is what enforces it.
// `CONVENTIONS.md` → *Naming* owns the rule.
//
// A stand-in `McpServer` that records each `registerTool` call. A handler
// called through it skips the SDK's input parse — use
// `in-memory-client.test-fixture.ts::connectInMemory` where the parse matters.
// What this one offers instead is the module-private wrap tag on the result,
// and the registered `meta`, so a test can assert which `inputSchema` a
// configuration selected.
import { vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as serverFactory from "../server/server-factory.js";

export type CapturedHandler = (...args: unknown[]) => Promise<unknown>;

/** One `registerTool` call, as the server received it. */
export interface CapturedTool {
    meta: { inputSchema?: unknown } & Record<string, unknown>;
    handler: CapturedHandler;
}

/**
 * Build a fake server and the map its `registerTool` calls land in, keyed by
 * tool name. `members` adds whatever else the code under test touches —
 * `registerResource`, `connect`, and so on.
 */
export function captureTools(members: Record<string, unknown> = {}): {
    server: McpServer;
    tools: Map<string, CapturedTool>;
} {
    const tools = new Map<string, CapturedTool>();
    const server = {
        ...members,
        registerTool: (name: string, meta: CapturedTool["meta"], handler: CapturedHandler) => {
            tools.set(name, { meta, handler });
        },
    };
    return { server: server as unknown as McpServer, tools };
}

/**
 * Make `createServer` return a capturing fake whose lifecycle members are
 * no-ops, so `McpCurlServer.start("stdio")` runs without touching stdin.
 * Restored by `vi.restoreAllMocks()`. `connect` and `close` are returned so a
 * test can assert on the lifecycle.
 */
export function stubServerFactory(): {
    tools: Map<string, CapturedTool>;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
} {
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const { server, tools } = captureTools({
        connect,
        close,
        registerResource: vi.fn(),
        registerPrompt: vi.fn(),
    });
    vi.spyOn(serverFactory, "createServer").mockReturnValue(server);
    return { tools, connect, close };
}
