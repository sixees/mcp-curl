// src/lib/tools/curl-output-fixture.ts
// Shared fixture builder for tests that stub `executeCommand` and drive
// `executeCurlRequest` end to end.
//
// **Extracted rather than copied, because the shape is the assertion.** Two
// suites now stub the executor — the header channel and the body's octet
// fidelity — and both depend on cURL's actual output shape: the header block on
// its own field, the `-w` metadata suffix on stdout, and a separator of the real
// length. A second hand-written copy of that arrangement would drift silently,
// and the direction it drifts is toward a fixture that passes against a handler
// which infers the header/body boundary from the body — the exact defect
// `ARCHITECTURE.md` invariant 13 forbids.
//
// The `vi.mock` declarations stay in each test file: vitest hoists them per
// module, so they cannot live here.

/**
 * The real separator length, not a short stand-in.
 *
 * `parseResponseWithMetadata` sizes its metadata search window from
 * `sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH`, so a shorter mock hides margin
 * the production path does not have.
 */
export const METADATA_SEPARATOR = "\n---MCP-CURL-00000000-0000-4000-8000-000000000000---\n";

/** The fields `executeCommand` resolves with, as `executeCurlRequest` reads them. */
export interface CurlOutputFixture {
    stdoutBytes: Buffer;
    headerBytes: Buffer | undefined;
    headerBytesReceived: number | undefined;
    stderr: string;
    exitCode: number;
}

/**
 * Build cURL output as the real executor hands it back.
 *
 * The header block goes on its OWN field, never onto stdout, because that is
 * what cURL does once `--dump-header` points at a descriptor.
 *
 * Takes Buffers so a test can put non-UTF-8 bytes on either stream — which is
 * the whole point for the octet-fidelity suite: `Buffer.from(s, "utf8")` cannot
 * produce an invalid sequence, so a string-only fixture could not express the
 * input under test.
 */
export function curlOutputFor(
    headerBlock: Buffer | string,
    body: Buffer | string,
    contentType: string
): CurlOutputFixture {
    const h = Buffer.isBuffer(headerBlock) ? headerBlock : Buffer.from(headerBlock, "utf8");
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const meta = Buffer.from(`${METADATA_SEPARATOR}${contentType}`, "utf8");
    return {
        stdoutBytes: Buffer.concat([b, meta]),
        headerBytes: h.length > 0 ? h : undefined,
        headerBytesReceived: h.length > 0 ? h.length : undefined,
        stderr: "",
        exitCode: 0,
    };
}
