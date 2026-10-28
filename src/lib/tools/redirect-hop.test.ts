// src/lib/tools/redirect-hop.test.ts
import { describe, it, expect } from "vitest";
import type { CurlExecuteInput } from "../server/schemas.js";
import { FOLLOWED_REDIRECT_STATUSES, nextHopParams, sameOrigin } from "./redirect-hop.js";

const NEXT = "https://api.test/next";

function base(overrides: Partial<CurlExecuteInput> = {}): CurlExecuteInput {
    return {
        url: "https://api.test/start",
        follow_redirects: true,
        insecure: false,
        ...overrides,
    } as CurlExecuteInput;
}

describe("sameOrigin", () => {
    const u = (s: string) => new URL(s);

    it.each([
        ["https://api.test/a", "https://API.test./b", true],
        ["https://api.test/a", "https://api.test:443/b", true],
        ["https://api.test/a", "http://api.test/a", false],
        ["https://api.test/a", "https://api.test:8443/a", false],
        ["https://api.test/a", "https://other.test/a", false],
    ])("%s vs %s → %s", (a, b, expected) => {
        expect(sameOrigin(u(a), u(b))).toBe(expected);
    });
});

describe("nextHopParams: the method table", () => {
    // [method as sent, has body] for each method the schema allows, plus the
    // implicit POST cURL sends for a body with no -X.
    const METHODS: [CurlExecuteInput["method"], boolean, string][] = [
        [undefined, false, "GET"],
        [undefined, true, "POST"],
        ["GET", false, "GET"],
        ["HEAD", false, "HEAD"],
        ["POST", true, "POST"],
        ["PUT", true, "PUT"],
        ["PATCH", true, "PATCH"],
        ["DELETE", false, "DELETE"],
        ["OPTIONS", false, "OPTIONS"],
    ];

    function expectedDrop(status: number, sent: string): boolean {
        if (status === 303) return sent !== "HEAD";
        if (status === 301 || status === 302) return sent === "POST";
        return false;
    }

    for (const status of FOLLOWED_REDIRECT_STATUSES) {
        for (const [method, hasBody, sent] of METHODS) {
            it(`${status} with ${sent}${hasBody ? " and a body" : ""}`, () => {
                const params = base({
                    method,
                    ...(hasBody ? { data: "{}", headers: { "Content-Type": "application/json", "Content-Length": "2" } } : {}),
                });
                const next = nextHopParams(params, status, false, NEXT);
                expect(next.url).toBe(NEXT);
                if (expectedDrop(status, sent)) {
                    expect(next.method).toBeUndefined();
                    expect(next.data).toBeUndefined();
                    expect(next.form).toBeUndefined();
                    expect(Object.keys(next.headers ?? {})).toEqual([]);
                } else {
                    expect(next.method).toBe(method);
                    expect(next.data).toBe(params.data);
                    expect(next.headers).toEqual(params.headers);
                }
            });
        }
    }

    it("drops a multipart form with the body", () => {
        const next = nextHopParams(base({ form: { a: "1" } }), 302, false, NEXT);
        expect(next.form).toBeUndefined();
        expect(next.method).toBeUndefined();
    });

    it("keeps a form on 307", () => {
        const next = nextHopParams(base({ form: { a: "1" } }), 307, false, NEXT);
        expect(next.form).toEqual({ a: "1" });
    });
});

describe("nextHopParams: cross-origin hops", () => {
    const CREDENTIALED = base({
        headers: {
            Accept: "application/json",
            "accept-language": "en",
            "Accept-Encoding": "gzip",
            "User-Agent": "ua",
            "X-Api-Key": "from-defaultHeaders",
            Authorization: "from-yaml-auth-headers",
            "X-Hook-Injected": "from-a-hook",
            Cookie: "c=1",
        },
        basic_auth: "u:p",
        bearer_token: "t",
        user_agent: "agent",
    });

    it("keeps only the allow-listed headers and drops basic_auth and bearer_token", () => {
        const next = nextHopParams(CREDENTIALED, 302, true, "https://other.test/");
        expect(next.headers).toEqual({
            Accept: "application/json",
            "accept-language": "en",
            "Accept-Encoding": "gzip",
            "User-Agent": "ua",
        });
        expect(next.basic_auth).toBeUndefined();
        expect(next.bearer_token).toBeUndefined();
        expect(next.user_agent).toBe("agent");
    });

    it("keeps everything on a same-origin hop", () => {
        const next = nextHopParams(CREDENTIALED, 302, false, NEXT);
        expect(next.headers).toEqual(CREDENTIALED.headers);
        expect(next.basic_auth).toBe("u:p");
        expect(next.bearer_token).toBe("t");
    });

    it("keeps the body headers on a cross-origin 307, which keeps the body", () => {
        const params = base({ method: "POST", data: "{}", headers: { "Content-Type": "application/json", "X-Api-Key": "k" } });
        const next = nextHopParams(params, 307, true, "https://other.test/");
        expect(next.headers).toEqual({ "Content-Type": "application/json" });
        expect(next.data).toBe("{}");
    });

    it("A → B → A: credentials stripped at B stay stripped back on A", () => {
        const atB = nextHopParams(CREDENTIALED, 302, true, "https://other.test/");
        // The caller keeps the flag sticky; hop 3 is back on hop 1's origin.
        const backOnA = nextHopParams(atB, 302, true, NEXT);
        expect(backOnA.headers).not.toHaveProperty("X-Api-Key");
        expect(backOnA.headers).not.toHaveProperty("Authorization");
        expect(backOnA.bearer_token).toBeUndefined();
        expect(backOnA.basic_auth).toBeUndefined();
    });
});
