// src/lib/execution/curl-args-builder.test.ts
// Tests for cURL CLI argument building

import { describe, it, expect, afterEach } from "vitest";
import { buildCurlArgs, type CurlArgsParams } from "./curl-args-builder.js";
import { HEADER_DUMP_PATH } from "./command-executor.js";
import { LIMITS } from "../config/index.js";

function makeParams(overrides: Partial<CurlArgsParams> = {}): CurlArgsParams {
    return {
        url: "https://example.com/api",
        metadataSeparator: "\n---SEP---\n",
        dnsResolve: { hostname: "example.com", port: 443, resolvedIp: "93.184.216.34" },
        ...overrides,
    };
}

describe("buildCurlArgs", () => {
    // The contract between buildCurlArgs and command-executor: the flag names
    // the descriptor the executor opens. Drop the flag and cURL writes no
    // headers anywhere, so `include_headers` reports "none received" on every
    // request — a green suite with the feature silently gone. Point it at a
    // different descriptor and cURL exits 23 on every header request. Both are
    // failures this block turns into test failures.
    describe("--dump-header", () => {
        // `buildCurlArgs` reads the real `process.platform`, so on a Linux
        // runner every assertion below would hold vacuously — no flag is
        // emitted, so "does not contain `-i`" passes without the builder having
        // decided anything. Pinning the platform is what makes each assertion
        // about the branch it names.
        const real = process.platform;
        const setPlatform = (value: string) =>
            Object.defineProperty(process, "platform", { value, configurable: true });
        afterEach(() => setPlatform(real));

        it("dumps headers to the descriptor the executor opens", () => {
            setPlatform("darwin");
            const args = buildCurlArgs(makeParams({ include_headers: true }));
            const i = args.indexOf("--dump-header");
            expect(i).toBeGreaterThan(-1);
            expect(args[i + 1]).toBe(HEADER_DUMP_PATH);
        });

        it("never multiplexes headers onto stdout with -i", () => {
            setPlatform("darwin");
            const args = buildCurlArgs(makeParams({ include_headers: true }));
            expect(args).not.toContain("-i");
            expect(args).not.toContain("--include");
        });

        it("asks for no header dump when include_headers is absent", () => {
            const args = buildCurlArgs(makeParams());
            expect(args).not.toContain("--dump-header");
        });

        // The guard exists entirely for platforms this suite cannot run on, so
        // without a stub it has no teeth at all: on darwin it is always true
        // and deleting it changes nothing observable. Stubbing `process.platform`
        // is the only way the degrade-don't-fail behaviour is ever exercised.
        describe("on a platform that cannot serve the descriptor", () => {
            it("omits the flag rather than asking cURL to fail", () => {
                setPlatform("linux");
                const args = buildCurlArgs(makeParams({ include_headers: true }));
                expect(args).not.toContain("--dump-header");
                expect(args).not.toContain(HEADER_DUMP_PATH);
                // The request itself is untouched: the caller keeps its body.
                expect(args).toContain("https://example.com/api");
            });

            it("still emits the flag on darwin", () => {
                setPlatform("darwin");
                const args = buildCurlArgs(makeParams({ include_headers: true }));
                expect(args).toContain("--dump-header");
            });
        });
    });

    describe("-w metadata block", () => {
        // %{content_type} is remote-echoed and is safe as the block's whole
        // content only while nothing follows it. A second field appended here
        // would give a crafted Content-Type a delimiter to spoof, so this
        // asserts the shape rather than merely the presence.
        it("emits content_type as the entire metadata block", () => {
            const args = buildCurlArgs(makeParams());
            const w = args[args.indexOf("-w") + 1];
            expect(w).toContain("%{content_type}");
            expect(w.endsWith("%{content_type}")).toBe(true);
        });

        // The boundary is structural, so no byte count rides this channel. One
        // here would put a header/body offset on a stream the parse then has to
        // interpret — the shape RC-1, RC-2 and RC-17 each failed on.
        it("carries no header byte count", () => {
            const args = buildCurlArgs(makeParams({ include_headers: true }));
            const w = args[args.indexOf("-w") + 1];
            expect(w).not.toContain("%{size_header}");
        });

        it("puts the whole metadata block after the escaped separator", () => {
            const args = buildCurlArgs(makeParams());
            const w = args[args.indexOf("-w") + 1];
            expect(w).toBe("\\n---SEP---\\n%{content_type}");
        });
    });

    describe("--resolve emission (invariant 2, first hop, builder half)", () => {
        // Scope: this asserts only that the builder EMITS the pin it is handed.
        // That the pin carries the address the SSRF check produced is asserted
        // at the producer in curl-execute.headers.test.ts; hops 2..N are
        // docs/todos/007.
        it("always emits a pin for the address it was given", () => {
            const args = buildCurlArgs(makeParams());
            const i = args.indexOf("--resolve");
            expect(i).toBeGreaterThan(-1);
            expect(args[i + 1]).toBe("example.com:443:93.184.216.34");
        });
    });

    describe("--proto flag", () => {
        it("always includes --proto =http,https", () => {
            const args = buildCurlArgs(makeParams());
            const idx = args.indexOf("--proto");
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe("=http,https");
        });

        it("includes --proto even when redirects are disabled", () => {
            const args = buildCurlArgs(makeParams({ follow_redirects: false }));
            expect(args).toContain("--proto");
            expect(args[args.indexOf("--proto") + 1]).toBe("=http,https");
        });
    });

    describe("--proto-redir flag", () => {
        it("includes --proto-redir when redirects are enabled (default)", () => {
            const args = buildCurlArgs(makeParams());
            const idx = args.indexOf("--proto-redir");
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe("=http,https");
        });

        it("does not include --proto-redir when redirects are disabled", () => {
            const args = buildCurlArgs(makeParams({ follow_redirects: false }));
            expect(args).not.toContain("--proto-redir");
        });
    });

    describe("--max-filesize flag", () => {
        it("always includes --max-filesize with LIMITS.MAX_RESPONSE_SIZE", () => {
            const args = buildCurlArgs(makeParams());
            const idx = args.indexOf("--max-filesize");
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(args[idx + 1]).toBe(String(LIMITS.MAX_RESPONSE_SIZE));
        });

        it("places --max-filesize before the URL", () => {
            const args = buildCurlArgs(makeParams());
            const fileSizeIdx = args.indexOf("--max-filesize");
            const urlIdx = args.lastIndexOf("https://example.com/api");
            expect(fileSizeIdx).toBeLessThan(urlIdx);
        });
    });

    describe("URL positioning", () => {
        it("URL is always the last argument", () => {
            const url = "https://example.com/test";
            const args = buildCurlArgs(
                makeParams({
                    url,
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    data: '{"key":"value"}',
                    timeout: 60,
                    compressed: true,
                    verbose: true,
                })
            );
            expect(args[args.length - 1]).toBe(url);
        });
    });
});
