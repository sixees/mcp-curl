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
// **Shared by three of the four suites that stub the executor**, because the
// shape is what those suites assert against: the header block on its own field,
// the `-w` metadata suffix on stdout, and a separator of the real length. A
// per-suite copy drifts toward a fixture that passes against a handler inferring
// the header/body boundary from the body, which `ARCHITECTURE.md` invariant 13
// forbids.
//
// `register-all-tools.test.ts` keeps its own builder, so this module is not the
// single source of that shape. What ties that suite to the contract instead is
// `vi.mocked` on its executor stub plus an explicit `CommandResult` return type
// on its builder — a compile error at one site rather than at 31 call sites.
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

// **No shared stub-hostname constant here, and it is a vitest constraint rather
// than a preference.** `vi.mock` factories hoist above every import, so a factory
// referencing an imported binding throws `Cannot access '__vi_import_N__' before
// initialization`. `vi.hoisted` makes a value reachable from a factory but only
// within one file, so it buys no sharing at all.
//
// Each suite therefore spells its own hostname inside its own factory, and they
// have drifted — `example.test` here, `api.example.test` in
// `register-all-tools.test.ts`. Nothing branches on the hostname, so if anything
// ever does, the fix is to assert the value rather than to share it.
// `LESSONS.md` RC-35.

/**
 * What `executeCommand` resolves with, as `executeCurlRequest` reads it.
 *
 * **Derived from `CommandResult`, never restated.** The two header fields are
 * intersected back to required-but-nullable on purpose: a builder must *decide*
 * whether a header block is present rather than silently omitting it.
 *
 * A new **required** field on `CommandResult` is then a compile error here. A new
 * **optional** one is not, and no type can close that — it arrives as `undefined`
 * with nothing erroring. What covers the gap, and the literals that bypass this
 * builder entirely, is `vi.mocked` at each suite's mock declaration.
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
 * **An options object, because `body` and `headerBlock` are both
 * `Buffer | string`.** Positionally they are interchangeable to the compiler and
 * not to the reader, so transposing them yields a fixture with the header block
 * on *stdout* — the composition invariant 13 forbids — and it compiles.
 * `processor.ts::SavedMessageFacts` takes an object for the same reason.
 *
 * Accepts Buffers so a test can put non-UTF-8 bytes on either stream:
 * `Buffer.from(s, "utf8")` cannot produce an invalid sequence, so a string-only
 * fixture could not express the size-guard cases at all.
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
    // **Empty and absent collapse to `undefined`, matching the executor** — a
    // fixture that can express a state the producer cannot is a fixture that can
    // give a test an unreachable branch to pass against.
    //
    // `headerBytes` cannot distinguish "capture not requested" from "requested,
    // origin sent nothing"; `params.include_headers` in `curl-execute.ts` is what
    // answers that.
    const headerCandidate = headerBlock === undefined ? undefined : toBuffer(headerBlock);
    const header = headerCandidate?.length ? headerCandidate : undefined;
    return {
        stdoutBytes: Buffer.concat([bodyBytes, meta]),
        headerBytes: header,
        headerBytesReceived: header?.length,
        stderr: "",
        exitCode: 0,
    };
}

/**
 * Pull the saved path out of a tool result's server-authored message.
 *
 * **Throws with the message text rather than returning `undefined`**: when the
 * save path is not taken, the reason is in that text, and an earlier version
 * that swallowed it reported a byte comparison against an empty file.
 *
 * Shared rather than copied — `docs/todos/018` gave a second suite the same need
 * the moment a non-JSON body started taking the save arm unconditionally, and
 * two spellings of "find the path" is the shape `.claude/rules/02-reuse-first.md`
 * names. The caller owns cleanup: push the return onto whatever list its
 * `afterAll` removes.
 */
export function savedPathFrom(text: string): string {
    const match = /saved to: (\S+?)(?:\s|$)/.exec(text);
    if (!match) throw new Error(`no saved path in result text: ${text.slice(0, 400)}`);
    return match[1]!.replace(/[.,]$/, "");
}
