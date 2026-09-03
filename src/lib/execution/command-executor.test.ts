// src/lib/execution/command-executor.test.ts
// Real-cURL tests for the header descriptor.
//
// These spawn cURL against a loopback socket rather than mocking it, because
// the property under test is one no mock can hold: that cURL writes the header
// block to a descriptor the body never touches. Every other test in this repo
// mocks `executeCommand` away, so the wiring added here — the fourth stdio
// pipe, its drain, and the flag that opens it — would otherwise ship untested.

import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { executeCommand, HEADER_DUMP_PATH } from "./command-executor.js";

let server: net.Server | undefined;

afterEach(() => {
    server?.close();
    server = undefined;
});

/** Serve one raw HTTP response on loopback and return its port. */
async function serveOnce(payload: string): Promise<number> {
    server = net.createServer((socket) => {
        socket.once("data", () => socket.end(Buffer.from(payload, "utf8")));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return (server!.address() as net.AddressInfo).port;
}

const SIMPLE =
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Marker: header-side\r\n" +
    "Content-Length: 11\r\n\r\nbody-side!!";

// A chunked response with a trailer section. `%{size_header}` does not count
// trailers and `curl -i` wrote them to stdout after the body, so trailer text
// landed inside `response` — LESSONS.md RC-17, the third failure of the
// arithmetic this mechanism replaces.
const CHUNKED_WITH_TRAILER =
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n" +
    "Transfer-Encoding: chunked\r\nTrailer: X-Leak\r\n\r\n" +
    "5\r\nHELLO\r\n0\r\nX-Leak: TRAILER_TEXT_HERE\r\n\r\n";

describe("executeCommand — header descriptor", () => {
    it("puts headers on their own stream and the body on stdout", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            10_000,
            { captureHeaders: true }
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdoutBytes.toString("utf8")).toBe("body-side!!");
        expect(result.headerBytes?.toString("utf8")).toContain("X-Marker: header-side");
        // The halves must not bleed into each other in either direction.
        expect(result.stdoutBytes.toString("utf8")).not.toContain("X-Marker");
        expect(result.headerBytes?.toString("utf8")).not.toContain("body-side");
    });

    it("keeps a chunked trailer out of the body", async () => {
        const port = await serveOnce(CHUNKED_WITH_TRAILER);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            10_000,
            { captureHeaders: true }
        );

        expect(result.stdoutBytes.toString("utf8")).toBe("HELLO");
        expect(result.stdoutBytes.toString("utf8")).not.toContain("TRAILER_TEXT_HERE");
        expect(result.headerBytes?.toString("utf8")).toContain("X-Leak: TRAILER_TEXT_HERE");
    });

    it("reports no header bytes when capture was not requested", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand("curl", ["-s", `http://127.0.0.1:${port}/`], 10_000);

        expect(result.exitCode).toBe(0);
        expect(result.stdoutBytes.toString("utf8")).toBe("body-side!!");
        expect(result.headerBytes).toBeUndefined();
    });

    // The safety property the whole mechanism rests on. If cURL fell back to
    // stdout when the descriptor were missing, a dropped `captureHeaders` would
    // silently re-multiplex the two streams and every guard above would still
    // pass. It does not: it fails the request instead.
    it("fails the request rather than falling back to stdout when the descriptor is absent", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            10_000,
            { captureHeaders: false }
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stdoutBytes.toString("utf8")).not.toContain("X-Marker");
        expect(result.stdoutBytes.toString("utf8")).not.toContain("body-side");
    });
});
