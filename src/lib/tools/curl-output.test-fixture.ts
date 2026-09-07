// src/lib/tools/curl-output.test-fixture.ts
// Shared fixture builder for tests that stub `executeCommand` and drive
// `executeCurlRequest` end to end.
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file. `tsup` bundles from the four entry points so
// it does not ship today, but a production import would compile, read as an
// ordinary intra-directory import in review, and land test scaffolding in
// `dist/` and on npm. Every other member of this directory is a registered tool
// handler, so the name is the only thing distinguishing them.
// `CONVENTIONS.md` → *Naming* owns the rule.
//
// **Extracted rather than copied, because the shape is the assertion.** Three
// suites stub the executor — the header channel, the body's octet fidelity, and
// the full registration path — and all three depend on cURL's actual output
// shape: the header block on its own field, the `-w` metadata suffix on stdout,
// and a separator of the real length. A hand-written copy drifts silently, and
// the direction it drifts is toward a fixture that passes against a handler
// which infers the header/body boundary from the body — the exact defect
// `ARCHITECTURE.md` invariant 13 forbids.
//
// The `vi.mock` declarations stay in each test file: vitest hoists them per
// module, so they cannot live here.

import type { CommandResult } from "../execution/index.js";

/**
 * The real separator length, not a short stand-in.
 *
 * `parseResponseWithMetadata` sizes its metadata search window from
 * `sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH`, so a shorter mock hides margin
 * the production path does not have.
 */
export const METADATA_SEPARATOR = "\n---MCP-CURL-00000000-0000-4000-8000-000000000000---\n";

/**
 * The hostname every stubbed `validateUrlAndResolveDns` resolves to.
 *
 * One value, because three suites mock that call and two of them had already
 * drifted from the third (`example.test` against `api.example.test`). Nothing
 * currently branches on it — which is exactly why the drift was invisible, and
 * why a future per-host rate-limit key or log label would have been exercised by
 * two suites and silently not by the third.
 */
export const STUB_HOSTNAME = "example.test";

/**
 * What `executeCommand` resolves with, as `executeCurlRequest` reads it.
 *
 * **Derived from `CommandResult`, never restated.** The two header fields are
 * intersected back to required-but-nullable on purpose: a builder must *decide*
 * whether a header block is present rather than silently omitting it, and the
 * intersection means a field added to `CommandResult` is a compile error here
 * instead of arriving as `undefined` in every end-to-end case that stubs the
 * executor. Those cases are the only proof invariant 13's header/body split
 * holds, so a silent lapse in them is a lapse in the one guarantee they exist
 * for.
 */
export type CurlOutputFixture = CommandResult & {
    headerBytes: Buffer | undefined;
    headerBytesReceived: number | undefined;
};

/** What a fixture may be handed as bytes-or-text. */
type Bytes = Buffer | string;

const toBuffer = (value: Bytes): Buffer =>
    Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");

/**
 * Build cURL output as the real executor hands it back.
 *
 * The header block goes on its OWN field, never onto stdout, because that is
 * what cURL does once `--dump-header` points at a descriptor.
 *
 * **An options object rather than positionals, because the arguments are not
 * distinguishable by type.** `body` and `headerBlock` are both `Buffer | string`,
 * so two builders with opposite orders — which is what this module replaced —
 * compiled either way and produced a fixture with the header block on *stdout*.
 * `processor.ts::SavedMessageFacts` takes an object for the same reason, stated
 * in its own doc-block: two parameters whose meanings are not interchangeable
 * must not be positionally interchangeable.
 *
 * Takes Buffers so a test can put non-UTF-8 bytes on either stream — the point
 * for the octet-fidelity suite, since `Buffer.from(s, "utf8")` cannot produce an
 * invalid sequence and a string-only fixture could not express the input under
 * test.
 *
 * @param body - the response body's octets, before the metadata suffix
 * @param contentType - the value cURL's `-w` block carries
 * @param headerBlock - the response-header descriptor's content; omit for none
 */
export function curlOutputFor({
    body,
    contentType,
    headerBlock,
}: {
    body: Bytes;
    contentType: string;
    headerBlock?: Bytes;
}): CurlOutputFixture {
    const bodyBytes = toBuffer(body);
    const meta = Buffer.from(`${METADATA_SEPARATOR}${contentType}`, "utf8");
    // `undefined` when there is no block at all, distinguishing "capture was not
    // requested" from "requested and the origin sent nothing" — the split
    // invariant 13 asks `curl_execute` to report rather than guess. An EMPTY
    // block is still a block, so a caller passing "" gets a zero-length Buffer
    // rather than absence.
    const header = headerBlock === undefined ? undefined : toBuffer(headerBlock);
    return {
        stdoutBytes: Buffer.concat([bodyBytes, meta]),
        headerBytes: header,
        headerBytesReceived: header?.length,
        stderr: "",
        exitCode: 0,
    };
}
