// src/lib/execution/loopback-server.test-fixture.ts
// Raw HTTP responses served on a loopback socket, for suites that spawn real cURL.

import net from "node:net";

// Every server opened, not just the newest: a test that needs two responders
// opens two, and a single reference would leave the first listener alive for
// the rest of the worker with nothing holding a handle to close it. Accepted
// sockets are tracked for the same reason teardown needs them — see below.
const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

/**
 * Close every server and socket this fixture opened. Call it from `afterEach`.
 *
 * Sockets first, and nothing here is awaited. `close()` completes only once
 * every accepted connection has ended, and a cURL run that gives up before
 * sending its request leaves one that the "data" handler never ends — so a
 * teardown that waited on `close()` would wait on that socket for the whole
 * test timeout. Destroying first removes what it would wait for; not waiting
 * at all removes the failure mode outright.
 */
export function closeLoopbackServers(): void {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    for (const server of servers.splice(0)) server.close();
}

/** A loopback responder: its port, and the first chunk of each request it received. */
export interface LoopbackServer {
    port: number;
    requests: string[];
}

/**
 * Serve raw HTTP responses on loopback, one per connection, in order: the nth
 * connection gets `payloads[n]`, and every connection past the last gets the
 * last. cURL opens a fresh connection per spawn, so a redirect chain followed
 * one spawn per hop reads one payload per hop.
 *
 * @param host - `"localhost"` for a request that goes through the SSRF gate,
 *   which refuses a loopback IP literal as a hostname but allows the name
 *   `localhost` when localhost is enabled. Binding by name puts the listener on
 *   the address that name resolves to, which is the address the gate pins.
 */
export async function serveResponses(
    payloads: readonly string[],
    host: "127.0.0.1" | "localhost" = "127.0.0.1"
): Promise<LoopbackServer> {
    const requests: string[] = [];
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.once("data", (chunk) => {
            const index = requests.push(chunk.toString("latin1")) - 1;
            socket.end(Buffer.from(payloads[Math.min(index, payloads.length - 1)], "utf8"));
        });
    });
    servers.push(server);
    // A bind failure emits "error" and never calls the listening callback, so
    // without this arm the await is on an event that will not arrive and the
    // setup failure surfaces as a test timeout instead of as itself.
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, host, () => resolve());
    });
    return { port: (server.address() as net.AddressInfo).port, requests };
}

/** Serve one raw HTTP response on loopback and return its port. */
export async function serveOnce(payload: string): Promise<number> {
    return (await serveResponses([payload])).port;
}
