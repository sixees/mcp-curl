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
import { LIMITS } from "../config/limits.js";

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

// cURL's own timeout must stay BELOW vitest's, or a genuine hang fails on the
// test runner's clock before the abort path this suite exercises can fire.
const CURL_TIMEOUT_MS = 3_000;

describe("executeCommand — header descriptor", () => {
    it("puts headers on their own stream and the body on stdout", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            CURL_TIMEOUT_MS
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
            CURL_TIMEOUT_MS
        );

        expect(result.stdoutBytes.toString("utf8")).toBe("HELLO");
        expect(result.stdoutBytes.toString("utf8")).not.toContain("TRAILER_TEXT_HERE");
        expect(result.headerBytes?.toString("utf8")).toContain("X-Leak: TRAILER_TEXT_HERE");
    });

    it("reports no header bytes when capture was not requested", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand("curl", ["-s", `http://127.0.0.1:${port}/`], CURL_TIMEOUT_MS);

        expect(result.exitCode).toBe(0);
        expect(result.stdoutBytes.toString("utf8")).toBe("body-side!!");
        expect(result.headerBytes).toBeUndefined();
    });

    // The safety property the whole mechanism rests on. If cURL fell back to
    // stdout when the descriptor were missing, the two streams would silently
    // re-multiplex and every guard above would still pass. It does not: it
    // fails the request instead.
    //
    // Reaching that state takes a descriptor cURL is told to use and the
    // executor does not open. The argv derivation in `executeCommand` makes
    // that unreachable through the real path, so this test names a DIFFERENT
    // descriptor to construct it — the guard is asserted on its own merits
    // because the fail-closed behaviour, not the derivation, is what makes the
    // mechanism safe.
    it("fails the request rather than falling back to stdout when the descriptor is absent", async () => {
        const port = await serveOnce(SIMPLE);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", "/dev/fd/9", `http://127.0.0.1:${port}/`],
            CURL_TIMEOUT_MS
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stdoutBytes.toString("utf8")).not.toContain("X-Marker");
        expect(result.stdoutBytes.toString("utf8")).not.toContain("body-side");
    });

    // The executor opens the pipe iff cURL was told to write to it. Two sites
    // deciding this independently is what let a truthy non-boolean open one and
    // not the other; deriving it means the test can assert the link directly.
    it("opens the descriptor from the arguments, not from a separate flag", async () => {
        const port = await serveOnce(SIMPLE);

        const withDump = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            CURL_TIMEOUT_MS
        );
        expect(withDump.exitCode).toBe(0);
        expect(withDump.headerBytes).toBeDefined();

        const port2 = await serveOnce(SIMPLE);
        const without = await executeCommand(
            "curl", ["-s", `http://127.0.0.1:${port2}/`], CURL_TIMEOUT_MS
        );
        expect(without.headerBytes).toBeUndefined();
    });

    // Retention is bounded; the COUNT is not. A hostile origin was measured
    // putting 2.5 MB on this descriptor against a 64 KB usable ceiling, so the
    // buffer must stop growing — but `bytesReceived` must still describe what
    // arrived, or the truncation notice reports our own cap back to us.
    it("bounds what it retains while still counting what arrived", async () => {
        const pad = "x".repeat(1_000);
        const many = Array.from({ length: 200 }, (_, i) => `X-Pad-${i}: ${pad}`).join("\r\n");
        const big = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n${many}\r\nContent-Length: 2\r\n\r\nok`;
        const port = await serveOnce(big);

        const result = await executeCommand(
            "curl",
            ["-s", "--dump-header", HEADER_DUMP_PATH, `http://127.0.0.1:${port}/`],
            CURL_TIMEOUT_MS
        );

        expect(result.exitCode).toBe(0);
        expect(result.headerBytes!.length).toBeLessThanOrEqual(LIMITS.MAX_HEADER_TEXT_BYTES);
        // The origin sent more than we kept, and the count says so.
        expect(result.headerBytesReceived!).toBeGreaterThan(result.headerBytes!.length);
        expect(result.stdoutBytes.toString("utf8")).toBe("ok");
    });
});
