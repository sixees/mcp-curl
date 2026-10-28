// src/lib/tools/curl-output.test-fixture.ts
// Shared fixture builder for tests that stub `executeCommand` and drive
// `executeCurlRequest` end to end.
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file. `tsup` bundles from the four entry points so
// it does not ship today, and `file-saver.test.ts`'s *nothing in production
// imports a test-only module* sweep is what keeps it that way: without it a
// production import compiles and reads as an ordinary intra-directory import in
// review. That sweep states its own residual; do not read this note as a
// coverage claim. Every other non-test module here is a registered tool handler
// or the barrel, so the name is the only thing distinguishing this file.
// `CONVENTIONS.md` → *Naming* owns the rule.
//
// **Shared by every suite that stubs the executor**, because the
// shape is what those suites assert against: the header block on its own field,
// the `-w` metadata suffix on stdout, and a separator of the real length. A
// per-suite copy drifts toward a fixture that passes against a handler inferring
// the header/body boundary from the body, which `ARCHITECTURE.md` invariant 13
// forbids.
//
// `register-all-tools.test.ts` keeps its own `CommandResult` builder, typed
// through `vi.mocked` on its executor stub, but takes its metadata block from
// `metadataSuffix` here — so the block has one spelling across every suite.
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

/** The `-w` metadata fields, as cURL expands them. */
export interface MetadataFields {
    /** `%{content_type}` */
    contentType: string;
    /** `%{http_code}`; defaults to `200` */
    httpCode?: number | string;
    /** `%{redirect_url}`; defaults to `""`, cURL's value when there is no target */
    redirectUrl?: string;
    /** `%header{…}`; omit for a block that carries no sync field */
    syncHeaderValue?: string;
    /** defaults to `METADATA_SEPARATOR` */
    separator?: string;
}

/**
 * The `-w` metadata block in `buildCurlArgs`'s field order, as cURL writes it
 * after the body.
 *
 * **The one place a test spells the block.** A suite that writes
 * `${SEP}${contentType}` by hand produces a block with the wrong separator
 * count, which parses as undetermined — so its assertions pass or fail against
 * the strictest grammar rather than the path they name. `curl-args-builder.test.ts`
 * holds this function to the builder's real format string.
 */
export function metadataSuffix({
    contentType,
    httpCode = 200,
    redirectUrl = "",
    syncHeaderValue,
    separator = METADATA_SEPARATOR,
}: MetadataFields): string {
    const fields = [String(httpCode), redirectUrl];
    if (syncHeaderValue !== undefined) fields.push(syncHeaderValue);
    fields.push(contentType);
    return fields.map((field) => separator + field).join("");
}

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
 * @param headerBlock - the response-header descriptor's content; omit for none
 */
export function curlOutputFor({
    body,
    headerBlock,
    ...fields
}: Omit<MetadataFields, "separator"> & {
    body: Bytes;
    headerBlock?: Bytes;
}): CurlOutputFixture {
    const bodyBytes = toBuffer(body);
    const meta = Buffer.from(metadataSuffix(fields), "utf8");
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
