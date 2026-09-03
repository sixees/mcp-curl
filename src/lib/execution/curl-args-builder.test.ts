// src/lib/execution/curl-args-builder.test.ts
// Tests for cURL CLI argument building

import { describe, it, expect } from "vitest";
import { buildCurlArgs, type CurlArgsParams } from "./curl-args-builder.js";
import { HEADER_DUMP_PATH } from "./command-executor.js";
import { LIMITS } from "../config/index.js";

function makeParams(overrides: Partial<CurlArgsParams> = {}): CurlArgsParams {
    return {
        url: "https://example.com/api",
        metadataSeparator: "\n---SEP---\n",
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
        it("dumps headers to the descriptor the executor opens", () => {
            const args = buildCurlArgs(makeParams({ include_headers: true }));
            const i = args.indexOf("--dump-header");
            expect(i).toBeGreaterThan(-1);
            expect(args[i + 1]).toBe(HEADER_DUMP_PATH);
        });

        it("never multiplexes headers onto stdout with -i", () => {
            const args = buildCurlArgs(makeParams({ include_headers: true }));
            expect(args).not.toContain("-i");
            expect(args).not.toContain("--include");
        });

        it("asks for no header dump when include_headers is absent", () => {
            const args = buildCurlArgs(makeParams());
            expect(args).not.toContain("--dump-header");
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

        // The boundary is structural now, so no byte count rides this channel.
        // Reintroducing one would put a header/body offset back on a stream the
        // parse would then have to interpret — the shape RC-1, RC-2 and RC-17
        // each failed on.
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

        it("appends the metadata block to a caller's output_format", () => {
            const args = buildCurlArgs(makeParams({ output_format: "%{http_code}" }));
            const w = args[args.indexOf("-w") + 1];
            expect(w).toBe("%{http_code}\\n---SEP---\\n%{content_type}");
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
