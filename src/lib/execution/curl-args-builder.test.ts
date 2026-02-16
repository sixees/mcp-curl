// src/lib/execution/curl-args-builder.test.ts
// Tests for cURL CLI argument building

import { describe, it, expect } from "vitest";
import { buildCurlArgs, type CurlArgsParams } from "./curl-args-builder.js";
import { LIMITS } from "../config/index.js";

function makeParams(overrides: Partial<CurlArgsParams> = {}): CurlArgsParams {
    return {
        url: "https://example.com/api",
        metadataSeparator: "\n---SEP---\n",
        ...overrides,
    };
}

describe("buildCurlArgs", () => {
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
