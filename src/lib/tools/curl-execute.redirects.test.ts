// src/lib/tools/curl-execute.redirects.test.ts
// The redirect hop loop in executeCurlRequest, with cURL mocked per hop: every
// hop passes the host list, the SSRF gate and the rate limit with its own URL,
// and every way a chain ends maps to one outcome. The real-cURL cases are in
// curl-execute.redirects.e2e.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CurlExecuteSchema } from "../server/schemas.js";
import { LIMITS, deriveHostPolicy, ANY_HOST_POLICY } from "../config/index.js";
import { METADATA_SEPARATOR as SEP, curlOutputFor } from "./curl-output.test-fixture.js";
import { LocalRefusalError } from "../utils/index.js";

vi.mock("../types/index.js", async () => {
    const actual = await vi.importActual<typeof import("../types/index.js")>("../types/index.js");
    return { ...actual, generateMetadataSeparator: () => SEP };
});

vi.mock("../security/index.js", async () => {
    const actual = await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        // Each hop's own host and port, pinned to one public address.
        validateUrlAndResolveDns: vi.fn(async (url: string) => {
            const parsed = new URL(url);
            return {
                hostname: parsed.hostname,
                port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
                resolvedIp: "93.184.216.34",
            };
        }),
        checkRateLimits: vi.fn(),
        hostRateLimitSyncHeader: vi.fn(() => undefined),
        applyServerRemaining: vi.fn(),
    };
});

vi.mock("../execution/index.js", async () => {
    const actual = await vi.importActual<typeof import("../execution/index.js")>("../execution/index.js");
    return { ...actual, executeCommand: vi.fn() };
});

const security = await import("../security/index.js");
const execution = await import("../execution/index.js");
const { executeCurlRequest } = await import("./curl-execute.js");

const validate = vi.mocked(security.validateUrlAndResolveDns);
const rateCheck = vi.mocked(security.checkRateLimits);
const spawnCurl = vi.mocked(execution.executeCommand);
const syncHeader = vi.mocked(security.hostRateLimitSyncHeader);
const applySync = vi.mocked(security.applyServerRemaining);

const params = (p: Record<string, unknown>) => CurlExecuteSchema.parse(p);
const textOf = (result: unknown) =>
    (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n");
const isError = (result: unknown) => (result as { isError?: boolean }).isError === true;

// JSON bodies, so each is returned inline rather than saved to a file.
const redirect = (status: number, target: string, body = `hop body ${status}`) =>
    curlOutputFor({ body: JSON.stringify({ body }), httpCode: status, redirectUrl: target, contentType: "application/json" });
const final = (body: string) => curlOutputFor({ body: JSON.stringify({ body }), contentType: "application/json" });

/** The URL each spawn was handed: cURL takes it last. */
const spawnedUrls = () => spawnCurl.mock.calls.map(([, args]) => args[args.length - 1]);
const spawnArgs = (n: number) => spawnCurl.mock.calls[n][1];
const pinOf = (args: string[]) => args[args.indexOf("--resolve") + 1];

const refusedAt = (requestsSent: number) =>
    `Redirect refused locally: ${requestsSent} request(s) were sent; hop ${requestsSent + 1} was not (LOCAL_REDIRECT_REFUSED).`;

beforeEach(() => {
    validate.mockClear();
    rateCheck.mockReset();
    spawnCurl.mockReset();
    syncHeader.mockReset();
    applySync.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("each hop is gated with its own URL", () => {
    it("runs the SSRF gate, the rate limit and the pin once per hop", async () => {
        spawnCurl
            .mockResolvedValueOnce(redirect(302, "https://api.test/b"))
            .mockResolvedValueOnce(redirect(301, "https://cdn.test:8443/c"))
            .mockResolvedValueOnce(final("final body"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(isError(result)).toBe(false);
        expect(textOf(result)).toContain("final body");
        expect(textOf(result)).not.toContain("hop body");
        expect(validate.mock.calls.map(([url]) => url)).toEqual([
            "https://api.test/a",
            "https://api.test/b",
            "https://cdn.test:8443/c",
        ]);
        expect(rateCheck.mock.calls.map(([host]) => host)).toEqual(["api.test", "api.test", "cdn.test"]);
        expect(spawnedUrls()).toEqual(["https://api.test/a", "https://api.test/b", "https://cdn.test:8443/c"]);
        expect([0, 1, 2].map((n) => pinOf(spawnArgs(n)))).toEqual([
            "api.test:443:93.184.216.34",
            "api.test:443:93.184.216.34",
            "cdn.test:8443:93.184.216.34",
        ]);
    });

    it("refuses a hop whose host is off the list, before DNS", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://other.test/x"));
        const policy = deriveHostPolicy({ baseUrl: "https://api.test" });

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: policy });

        expect(isError(result)).toBe(true);
        expect(textOf(result)).toBe(`${refusedAt(1)} The target host is not in this server's allowedHosts list.`);
        expect(validate).toHaveBeenCalledTimes(1);
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("refuses a hop the SSRF gate rejects, without echoing its message", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "http://metadata.test/"));
        validate.mockImplementationOnce(async () => ({ hostname: "api.test", port: 443, resolvedIp: "93.184.216.34" }));
        validate.mockRejectedValueOnce(new Error('Requests to internal/private networks are not allowed: metadata.test'));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(textOf(result)).toContain(refusedAt(1));
        expect(textOf(result)).toContain("blocked by SSRF protection or did not resolve");
        expect(textOf(result)).not.toContain("metadata.test");
        expect(rateCheck).toHaveBeenCalledTimes(1);
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("refuses a hop the rate limit rejects, without echoing its message", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://busy.test/"));
        rateCheck.mockImplementationOnce(() => undefined);
        rateCheck.mockImplementationOnce(() => {
            throw new Error('Rate limit exceeded for host "busy.test"');
        });

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(textOf(result)).toContain(refusedAt(1));
        expect(textOf(result)).toContain("rate limit");
        expect(textOf(result)).not.toContain("busy.test");
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("carries the rate limit's wait onto a redirect hop's refusal", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://busy.test/"));
        rateCheck.mockImplementationOnce(() => undefined);
        rateCheck.mockImplementationOnce(() => {
            throw new LocalRefusalError({ code: "LOCAL_RATE_LIMITED", reason: "rate-limited", retryAfterSeconds: 12 });
        });

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(textOf(result)).toBe(
            `${refusedAt(1)} The rate limit for this target or session is exhausted; wait before retrying. Retry in 12 s.`
        );
    });

    it("hands cURL the parsed href, so the host it checked is the host it reaches", async () => {
        // WHATWG reads the host as a.test; cURL, handed the raw text, reads
        // `a.test\` as userinfo and connects to b.test (measured, cURL 8.7.1).
        spawnCurl.mockResolvedValueOnce(redirect(302, "http://a.test\\@b.test/")).mockResolvedValueOnce(final("ok"));

        await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(validate.mock.calls[1][0]).toBe("http://a.test/@b.test/");
        expect(spawnedUrls()[1]).toBe("http://a.test/@b.test/");
        expect(pinOf(spawnArgs(1))).toBe("a.test:80:93.184.216.34");
    });
});

describe("how a chain ends", () => {
    it("refuses once max_redirects redirects have been followed", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "https://api.test/loop"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a", max_redirects: 2 }), {});

        expect(textOf(result)).toBe(`${refusedAt(3)} The redirect chain reached max_redirects.`);
        expect(spawnCurl).toHaveBeenCalledTimes(3);
    });

    it("refuses the first redirect when max_redirects is 0", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "https://api.test/b"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a", max_redirects: 0 }), {});

        expect(textOf(result)).toContain(refusedAt(1));
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("defaults the cap to LIMITS.MAX_REDIRECTS", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "https://api.test/loop"));

        await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(spawnCurl).toHaveBeenCalledTimes(LIMITS.MAX_REDIRECTS + 1);
    });

    it("returns the first response when follow_redirects is false", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "https://api.test/b", "the 302 body"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a", follow_redirects: false }), {});

        expect(textOf(result)).toContain("the 302 body");
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("returns a followed 3xx with an empty target as is", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "", "no location"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(isError(result)).toBe(false);
        expect(textOf(result)).toContain("no location");
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it.each([300, 304, 305, 399])("does not follow %i", async (status) => {
        spawnCurl.mockResolvedValue(redirect(status, "https://api.test/b", "not followed"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(textOf(result)).toContain("not followed");
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("does not follow a hop whose cURL exit is non-zero", async () => {
        spawnCurl.mockResolvedValue({ ...redirect(302, "https://api.test/b"), exitCode: 28 });

        await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("does not follow when the metadata block is undetermined", async () => {
        // A block with one separator too few: no status to trust.
        const output = redirect(302, "https://api.test/b");
        spawnCurl.mockResolvedValue({ ...output, stdoutBytes: Buffer.from(`{}${SEP}302${SEP}application/json`) });

        await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    // Each of these reaches the loop as an unusable target, never as "empty,
    // so terminal" (RC-31: asserted at the consumer, not only at the parser).
    it.each([
        ["over the field bound", `https://api.test/${"a".repeat(LIMITS.MAX_REDIRECT_URL_LENGTH)}`],
        ["carrying a control byte", "https://api.test/\u0001x"],
        ["unparseable", "http://[::1"],
        ["not http(s)", "ftp://api.test/file"],
        ["carrying userinfo", "https://user:pass@api.test/"],
    ])("refuses a target %s", async (_label, target) => {
        spawnCurl.mockResolvedValue(redirect(302, target, "intermediate"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), {});

        expect(isError(result)).toBe(true);
        expect(textOf(result)).toBe(`${refusedAt(1)} The redirect target is not a usable http(s) URL.`);
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    // cURL writes the `-u` credentials it sent into `%{redirect_url}`
    // (measured, cURL 8.7.1), so that userinfo is not the remote's.
    it("follows a target carrying the credentials it sent, with them stripped from the URL", async () => {
        spawnCurl
            .mockResolvedValueOnce(redirect(302, "https://u:p@api.test/next"))
            .mockResolvedValueOnce(final("done"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a", basic_auth: "u:p" }), {});

        expect(isError(result)).toBe(false);
        expect(spawnedUrls()).toEqual(["https://api.test/a", "https://api.test/next"]);
        expect(spawnArgs(1)).toContain("u:p");
    });

    it("refuses a target carrying credentials other than the ones it sent", async () => {
        spawnCurl.mockResolvedValue(redirect(302, "https://other:x@api.test/next"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a", basic_auth: "u:p" }), {});

        expect(textOf(result)).toBe(`${refusedAt(1)} The redirect target is not a usable http(s) URL.`);
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("sends credentials from the request URL as basic_auth, not in the URL", async () => {
        spawnCurl.mockResolvedValueOnce(final("done"));

        await executeCurlRequest(params({ url: "https://alice:p%40ss@api.test/a" }), {});

        expect(spawnedUrls()).toEqual(["https://api.test/a"]);
        expect(spawnArgs(0)).toContain("alice:p@ss");
    });
});

describe("one deadline for the chain", () => {
    it("gives each hop what is left, and refuses a spent deadline before spawning", async () => {
        let now = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        spawnCurl.mockImplementation(async () => {
            now += 1_250;
            return redirect(302, "https://api.test/next");
        });

        const result = await executeCurlRequest(params({ url: "https://api.test/a", timeout: 2 }), {});

        const maxTimes = spawnCurl.mock.calls.map(([, args]) => args[args.indexOf("--max-time") + 1]);
        expect(maxTimes).toEqual(["2", "0.75"]);
        expect(spawnCurl.mock.calls.map(([, , timeout]) => timeout)).toEqual([2_000, 750]);
        expect(isError(result)).toBe(true);
        expect(textOf(result)).toContain("the whole timeout was used up");
    });

    it("bounds a redirect hop's DNS lookup by what is left, as a timeout and not a refusal", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://black-hole.test/x"));
        validate.mockImplementationOnce(async (url: string) => ({
            hostname: new URL(url).hostname, port: 443, resolvedIp: "93.184.216.34",
        }));
        validate.mockImplementationOnce(() => new Promise(() => undefined));

        const started = Date.now();
        const result = await executeCurlRequest(params({ url: "https://api.test/a", timeout: 1 }), {});

        expect(Date.now() - started).toBeLessThan(1_500);
        expect(isError(result)).toBe(true);
        expect(textOf(result)).toContain("the whole timeout was used up");
        expect(textOf(result)).not.toContain("LOCAL_REDIRECT_REFUSED");
        expect(spawnCurl).toHaveBeenCalledTimes(1);
    });

    it("bounds hop 1's DNS lookup too", async () => {
        validate.mockImplementationOnce(() => new Promise(() => undefined));

        const started = Date.now();
        const result = await executeCurlRequest(params({ url: "https://api.test/a", timeout: 1 }), {});

        expect(Date.now() - started).toBeLessThan(1_500);
        expect(textOf(result)).toContain("the whole timeout was used up");
        expect(spawnCurl).not.toHaveBeenCalled();
    });
});

describe("what a followed hop sends", () => {
    it("strips credentials on a cross-origin hop and keeps them stripped", async () => {
        spawnCurl
            .mockResolvedValueOnce(redirect(302, "https://other.test/x"))
            .mockResolvedValueOnce(redirect(302, "https://api.test/back"))
            .mockResolvedValueOnce(final("done"));

        await executeCurlRequest(
            params({
                url: "https://api.test/a",
                headers: { "X-Api-Key": "key", Accept: "application/json" },
                bearer_token: "tok",
                basic_auth: "u:p",
            }),
            {}
        );

        const hop1 = spawnArgs(0).join("\n");
        expect(hop1).toContain("X-Api-Key: key");
        expect(hop1).toContain("Authorization: Bearer tok");
        for (const n of [1, 2]) {
            const args = spawnArgs(n);
            expect(args.join("\n")).not.toContain("X-Api-Key");
            expect(args.join("\n")).not.toContain("Authorization");
            expect(args).not.toContain("-u");
            expect(args).toContain("Accept: application/json");
        }
    });

    it("keeps credentials on a same-origin hop", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://API.test./b")).mockResolvedValueOnce(final("ok"));

        await executeCurlRequest(params({ url: "https://api.test/a", headers: { "X-Api-Key": "key" } }), {});

        expect(spawnArgs(1)).toContain("X-Api-Key: key");
    });

    it("turns a POST into a body-less GET on 302", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(302, "https://api.test/b")).mockResolvedValueOnce(final("ok"));

        await executeCurlRequest(
            params({ url: "https://api.test/a", method: "POST", data: "{}", headers: { "Content-Type": "application/json" } }),
            {}
        );

        expect(spawnArgs(0)).toContain("--data-raw");
        const hop2 = spawnArgs(1);
        expect(hop2).not.toContain("--data-raw");
        expect(hop2).not.toContain("-X");
        expect(hop2.join("\n")).not.toContain("Content-Type");
    });

    it("keeps the method and body on 307", async () => {
        spawnCurl.mockResolvedValueOnce(redirect(307, "https://api.test/b")).mockResolvedValueOnce(final("ok"));

        await executeCurlRequest(params({ url: "https://api.test/a", method: "PUT", data: "{}" }), {});

        const hop2 = spawnArgs(1);
        expect(hop2[hop2.indexOf("-X") + 1]).toBe("PUT");
        expect(hop2[hop2.indexOf("--data-raw") + 1]).toBe("{}");
    });
});

describe("rate-limit header sync", () => {
    const synced = (status: number, target: string, remaining: string | undefined) =>
        curlOutputFor({
            body: JSON.stringify({ body: "b" }),
            httpCode: status,
            redirectUrl: target,
            syncHeaderValue: remaining,
            contentType: "application/json",
        });

    it("asks every hop for the header and applies each figure to the host that answered", async () => {
        syncHeader.mockReturnValue("X-Remaining");
        spawnCurl
            .mockResolvedValueOnce(synced(302, "https://cdn.test/b", "7"))
            .mockResolvedValueOnce(synced(200, "", "3"));

        const result = await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(isError(result)).toBe(false);
        expect(spawnArgs(0).join(" ")).toContain("%header{X-Remaining}");
        expect(spawnArgs(1).join(" ")).toContain("%header{X-Remaining}");
        expect(applySync.mock.calls).toEqual([["api.test", 7], ["cdn.test", 3]]);
    });

    it.each([["empty", ""], ["malformed", "7 requests"], ["negative", "-1"]])(
        "changes nothing on an %s value",
        async (_label, remaining) => {
            syncHeader.mockReturnValue("X-Remaining");
            spawnCurl.mockResolvedValueOnce(synced(200, "", remaining));

            await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

            expect(applySync).not.toHaveBeenCalled();
        }
    );

    it("asks for no header when none is configured", async () => {
        spawnCurl.mockResolvedValueOnce(final("plain"));

        await executeCurlRequest(params({ url: "https://api.test/a" }), { hostPolicy: ANY_HOST_POLICY });

        expect(spawnArgs(0).join(" ")).not.toContain("%header{");
        expect(applySync).not.toHaveBeenCalled();
    });
});
