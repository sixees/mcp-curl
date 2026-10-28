// src/lib/tools/curl-execute.redirects.e2e.test.ts
// Redirects through real cURL on loopback: a hostile origin's 302 to an internal
// address returns a refusal and never the target's body (todo 007), and a hop
// that passes the gate is really followed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CurlExecuteSchema } from "../server/schemas.js";
import { ANY_HOST_POLICY } from "../config/index.js";
import { serveResponses, closeLoopbackServers } from "../execution/loopback-server.test-fixture.js";
import { executeCurlRequest } from "./curl-execute.js";

const params = (p: Record<string, unknown>) => CurlExecuteSchema.parse(p);
const textOf = (result: unknown) =>
    (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n");

const found = (location: string) =>
    `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`;
const ok = (body: string) =>
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`;

// Loopback hop 1 needs localhost allowed; a separate session keeps these
// requests off any other suite's client count.
const EXTRA = { allowLocalhost: true, hostPolicy: ANY_HOST_POLICY, sessionId: "redirects-e2e" };

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    closeLoopbackServers();
    vi.restoreAllMocks();
});

describe("todo 007: a redirect hop is validated like the first", () => {
    it.each([
        ["a privileged loopback port", "http://localhost:22/"],
        ["an RFC 1918 address", "http://10.0.0.5/internal"],
        ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ])("refuses a 302 to %s", async (_label, target) => {
        const origin = await serveResponses([found(target)], "localhost");

        const result = await executeCurlRequest(params({ url: `http://localhost:${origin.port}/start` }), EXTRA);

        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(textOf(result)).toContain(
            "Redirect refused locally: 1 request(s) were sent; hop 2 was not (LOCAL_REDIRECT_REFUSED)."
        );
        expect(textOf(result)).not.toContain(new URL(target).hostname);
        expect(origin.requests).toHaveLength(1);
    });

    it("follows a hop that passes the gate (positive control)", async () => {
        const origin = await serveResponses([found("/next"), ok('{"hop":"second"}')], "localhost");

        const result = await executeCurlRequest(params({ url: `http://localhost:${origin.port}/start` }), EXTRA);

        expect(textOf(result)).toContain('"hop":"second"');
        expect(origin.requests.map((r) => r.split("\r\n")[0])).toEqual(["GET /start HTTP/1.1", "GET /next HTTP/1.1"]);
    });

    it("sends a cross-origin hop none of hop 1's credentials", async () => {
        const target = await serveResponses([ok('{"hop":"target"}')], "localhost");
        const origin = await serveResponses([found(`http://localhost:${target.port}/landing`)], "localhost");

        const result = await executeCurlRequest(
            params({
                url: `http://localhost:${origin.port}/start`,
                headers: { "X-Api-Key": "secret-key", Accept: "application/json" },
                bearer_token: "secret-token",
            }),
            EXTRA
        );

        expect(textOf(result)).toContain('"hop":"target"');
        expect(origin.requests[0]).toContain("X-Api-Key: secret-key");
        expect(target.requests[0]).not.toContain("X-Api-Key");
        expect(target.requests[0]).not.toContain("Authorization");
        expect(target.requests[0]).toContain("Accept: application/json");
    });

    it("sends a 302 after a POST as a body-less GET", async () => {
        const origin = await serveResponses([found("/after"), ok("{}")], "localhost");

        await executeCurlRequest(
            params({ url: `http://localhost:${origin.port}/form`, method: "POST", data: '{"a":1}' }),
            EXTRA
        );

        expect(origin.requests[0].split("\r\n")[0]).toBe("POST /form HTTP/1.1");
        expect(origin.requests[1].split("\r\n")[0]).toBe("GET /after HTTP/1.1");
        expect(origin.requests[1]).not.toContain('{"a":1}');
    });
});
