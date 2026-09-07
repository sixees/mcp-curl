// src/lib/response/formatter.ts
// Format response for MCP output

/**
 * Information about file saving for response formatting.
 */
export interface FileSaveInfo {
    /** Whether the response was saved to a file */
    savedToFile: boolean;
    /** Path to the saved file (when savedToFile is true) */
    filepath?: string;
    /** Optional message about the save operation */
    message?: string;
}

/** Out-of-band facts about the header text, reported beside it rather than in it. */
export interface HeaderInfo {
    truncated?: boolean;
    bytesReceived?: number;
    bytesReturned?: number;
    undetermined?: boolean;
    /** True when this host cannot capture headers at all — a local fact, not one about the origin. */
    unsupported?: boolean;
}

/**
 * Attach the header and stderr fields to a metadata object.
 *
 * One implementation, because the two metadata branches — saved-to-file and
 * inline — emit the same fields. Written as near-copies they drift the moment a
 * field is added to one and not the other, and the symptom is a response
 * reporting different facts depending on whether it happened to be saved. The
 * branches differ in the body they carry, never in these fields.
 */
function applyHeaderFields(
    output: Record<string, unknown>,
    responseHeaders: string | undefined,
    headerInfo: HeaderInfo | undefined,
    stderr: string
): void {
    if (responseHeaders) output.headers = responseHeaders;
    if (responseHeaders && headerInfo?.truncated) {
        output.headers_truncated = true;
        output.header_bytes_received = headerInfo.bytesReceived;
        output.header_bytes_returned = headerInfo.bytesReturned;
    }
    if (headerInfo?.undetermined) output.headers_undetermined = true;
    if (headerInfo?.unsupported) output.headers_unsupported = true;
    if (stderr) output.stderr = stderr;
}

/**
 * The server-authored `[mcp-curl] …` lines for the plain branch, or `""`.
 *
 * **Exported because they must travel as their own MCP content entry, not as a
 * prefix on remote bytes.** Prefixing them was a defence argument — a position
 * an origin cannot occupy — and it was sound for that. What it was not is a
 * REGION boundary: `defendForInline` keys its verbatim-JSON arm on the whole
 * text part being a composite document, so a prefix demoted a JSON body to the
 * undivided scan, which then paired `<!--` in one field with `-->` in a later
 * one and deleted what lay between. Measured:
 * `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` returned
 * `{"a":"open ","d":"kept"}` on any non-darwin host with `include_headers`.
 *
 * A separate content entry is a STRONGER boundary than an unoccupiable
 * position, so the original argument survives the move intact. ARCHITECTURE.md
 * invariants 13 and 16; `LESSONS.md` RC-37, RC-41.
 */
export function plainBranchNotices(exitCode: number, headerInfo?: HeaderInfo): string {
    return [
        // A non-zero exit has no field to land in on this branch, so without
        // this line a FAILED request is byte-identical to an empty successful
        // one — the shape the reassurance below would otherwise make worse by
        // naming the body sound.
        exitCode !== 0
            ? `[mcp-curl] cURL exited ${exitCode}; the response below may be empty or incomplete`
            : null,
        // Two arms, because the pair is only sometimes statable. Where the
        // defence grew the text past the ceiling, how many origin octets
        // survived is genuinely unknown — so the fact of the cut is reported
        // and the ratio is not invented.
        headerInfo?.truncated
            ? headerInfo.bytesReturned !== undefined
                ? `[mcp-curl] response headers truncated: ${headerInfo.bytesReturned} of ${headerInfo.bytesReceived} bytes used`
                : `[mcp-curl] response headers truncated to fit the inline limit; ${headerInfo.bytesReceived} bytes were received`
            : null,
        // A fact about this host, so it is stated whatever the exit code was:
        // the flag is never added here, which is a decision taken before the
        // request and independent of how the request went.
        headerInfo?.unsupported
            ? "[mcp-curl] response headers cannot be captured on this host (macOS only); none are reported, and this says nothing about what the origin sent"
            : null,
        // The reassurance is claimed only on a CLEAN exit. Keyed on
        // `undetermined` alone it asserts the body is sound on every cURL
        // failure after connect — exit 23, 35, 56, 63 — where the body is empty
        // precisely BECAUSE the request failed. This flag's domain cannot answer
        // a question about the body; `exitCode` can.
        headerInfo?.undetermined
            ? exitCode === 0
                ? "[mcp-curl] response headers were requested but none were received; the body is unaffected"
                : "[mcp-curl] response headers were requested but none were received"
            : null,
    ]
        .filter(Boolean)
        .join("\n");
}

/**
 * Format the response for MCP output.
 *
 * When includeMetadata is true, returns a JSON object with:
 * - success: boolean (true if exitCode is 0)
 * - exit_code: number
 * - response: string (stdout content; present only on the not-saved-to-file branch)
 * - stderr: string (if present)
 * - saved_to_file: boolean (present, and true, only when fileSaveInfo.savedToFile is
 *   true AND fileSaveInfo.filepath is set — absent otherwise, never emitted as false)
 * - filepath: string (path to saved file; present only alongside saved_to_file)
 * - message: string (informational message; present only alongside saved_to_file)
 * - headers: string (defended header text; present only when there is text to
 *   report, so absent on both the undetermined and the unsupported paths)
 *
 * - headers_truncated: boolean (only when header text was cut)
 * - header_bytes_received: number (total cURL wrote; only when text was cut)
 * - header_bytes_returned: number (origin octets used; only when text was cut AND
 *   that count is knowable. Absent where the defence grew the text past the
 *   ceiling, because the surviving octet count cannot be stated in origin units
 *   — see `HeaderChannel.bytesReturned`. Reporting the pair is optional; the
 *   `headers_truncated` flag beside it is not)
 * - headers_undetermined: boolean (include_headers was requested but cURL wrote
 *   no header block, so none is reported. The header channel cannot have
 *   contaminated the body — it arrives on its own stream — but whether the body
 *   is COMPLETE is `exit_code`'s to answer, not this field's)
 * - headers_unsupported: boolean (this host cannot capture headers at all; a
 *   fact about the host, deliberately distinct from headers_undetermined, which
 *   is a fact about the origin)
 *
 * When includeMetadata is false:
 * - If file was saved: returns the message or filepath
 * - Otherwise: returns the server-authored notices, then stdout
 *
 * **This function never composes header text with body text, on either branch,
 * and that is a defence rather than a formatting choice.** Under
 * `include_metadata` the header text is a discrete `headers` key and the body in
 * `response` is the body alone. On the plain branch the header text is not
 * returned here at all — `tools/curl-execute.ts` emits it as its own MCP content
 * part, because two remote-controlled regions may not share a channel
 * (ARCHITECTURE.md invariant 13) and the post-processor wrap defends each part
 * independently.
 *
 * **It used to prefix the header block to the body with a blank line, and that
 * merged two regions into one string the wrap could not divide.** The cost was
 * measured: a body holding `<!--` and a later field holding `-->` had
 * `stripHtmlComments` pair them ACROSS the join and delete the field between —
 * `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` returned as
 * `{"a":"open ","d":"kept"}`, still valid JSON, with nothing downstream able to
 * tell. That was survivable only while the wrap re-serialised each JSON leaf and
 * so neutralised the tokens before composition; `docs/todos/018` removes that
 * round trip to make a JSON body byte-exact, which takes the mitigation with it.
 * ARCHITECTURE.md invariants 7, 13 and 16, and `LESSONS.md` RC-16.
 *
 * What holds on BOTH branches, and is the guarantee worth relying on, is that
 * header text never reaches the saved file and never reaches `jq_filter`.
 *
 * @param stdout - Standard output from the command
 * @param stderr - Standard error from the command
 * @param exitCode - Exit code (0 indicates success)
 * @param includeMetadata - Whether to wrap response in JSON with metadata
 * @param fileSaveInfo - Optional information about file saving
 * @param responseHeaders - Optional response header text (from include_headers).
 *   Kept out of the body so a saved file stays parseable and a jq filter still
 *   sees plain JSON. Surfaced inline even when the body went to a file, which is
 *   why it carries its own byte ceiling rather than relying on `max_result_size`.
 * @param headerInfo - Out-of-band facts about the header text. Reported as
 *   separate fields rather than appended to `responseHeaders`, because a notice
 *   written into remote-authored text is indistinguishable from the same words
 *   sent by the origin.
 * @returns Formatted response string
 */
export function formatResponse(
    stdout: string,
    stderr: string,
    exitCode: number,
    includeMetadata: boolean,
    fileSaveInfo?: FileSaveInfo,
    responseHeaders?: string,
    headerInfo?: HeaderInfo
): string {
    // The plain branch has one string and so cannot carry JSON fields — but
    // "no field available" must not become "no signal". A truncated header
    // block is byte-identical to a complete one, so a caller reading it
    // concludes a security header is absent when it was merely cut off.
    // Written by us and placed BEFORE the remote text, which is a position an
    // origin cannot occupy — so this is a server-authored prefix rather than
    // the forgeable in-band marker the out-of-band fields exist to avoid.
    // **The notices are NOT joined to the body here.** They go back as their own
    // MCP content entry, emitted by `tools/curl-execute.ts` — see
    // {@link plainBranchNotices} for the measurement that forced the move. They
    // ARE joined to the saved-to-file message below, and the difference is the
    // whole rule: that message is server-authored end to end, so the join has
    // no remote region on either side of it. What may never be joined is server
    // prose to remote bytes.
    const notices = !includeMetadata ? plainBranchNotices(exitCode, headerInfo) : "";
    const withNotice = (text: string) => (notices ? `${notices}\n\n${text}` : text);
    // If file was saved, always indicate the filepath (user needs to know where data is)
    if (fileSaveInfo?.savedToFile && fileSaveInfo.filepath) {
        if (includeMetadata) {
            // Full JSON metadata
            const output: Record<string, unknown> = {
                success: exitCode === 0,
                exit_code: exitCode,
                saved_to_file: true,
                filepath: fileSaveInfo.filepath,
                message: fileSaveInfo.message ?? "Response saved to file. Read the file to access contents.",
            };
            applyHeaderFields(output, responseHeaders, headerInfo, stderr);
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the message or fallback to filepath
        const message = fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
        return withNotice(message);
    }

    // Normal response
    if (includeMetadata) {
        const output: Record<string, unknown> = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        applyHeaderFields(output, responseHeaders, headerInfo, stderr);
        return JSON.stringify(output, null, 2);
    }
    // No `withNotice` — see above. `stdout` is remote bytes and nothing
    // server-authored may share this string with them.
    return stdout;
}
