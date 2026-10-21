// src/lib/extensible/in-memory-client.test-fixture.ts
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file; `file-saver.test.ts`'s *nothing in
// production imports a test-only module* sweep is what enforces it.
// `CONVENTIONS.md` → *Naming* owns the rule.
//
// A real MCP client over a linked in-memory transport. A test that fakes
// `registerTool` and calls the captured handler skips the SDK's own input
// parse, so a schema that rejects what the handler expects passes every such
// test.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** A connected client, and the teardown that closes both ends. */
export interface InMemoryConnection {
    client: Client;
    close: () => Promise<void>;
}

/**
 * Connect a fresh `Client` to `server` over `InMemoryTransport`. Register every
 * tool before calling this: the SDK fixes the capability set at connect time.
 */
export async function connectInMemory(server: McpServer): Promise<InMemoryConnection> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "in-memory-test-client", version: "0.0.0" });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}
