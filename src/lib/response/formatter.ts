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
 * - headers: string (response header text, if include_headers was used)
 *
 * - headers_truncated: boolean (only when header text was cut)
 * - header_bytes_received: number (total cURL wrote; only when text was cut)
 * - header_bytes_returned: number (how much survived; only when text was cut)
 * - headers_undetermined: boolean (include_headers was requested but cURL wrote
 *   no header block, so none is reported. The body is unaffected — it arrives on
 *   its own stream — so this says "no headers", never "contaminated body")
 *
 * When includeMetadata is false:
 * - If file was saved: returns the message or filepath
 * - Otherwise: returns header text (if any), a blank line, then stdout
 *
 * **The two branches differ in more than shape.** Under `include_metadata` the
 * header text is a discrete `headers` key and the body in `response` is the body
 * alone. On the plain branch there is only one string, so header text is
 * prefixed to the body with a blank line — the caller gets a blob that is not
 * JSON-parseable. What holds on BOTH branches, and is the guarantee worth
 * relying on, is that header text never reaches the saved file and never reaches
 * `jq_filter`.
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
/** Out-of-band facts about the header text, reported beside it rather than in it. */
export interface HeaderInfo {
    truncated?: boolean;
    bytesReceived?: number;
    bytesReturned?: number;
    undetermined?: boolean;
}

/**
 * Attach the header and stderr fields to a metadata object.
 *
 * One implementation, because there are two metadata branches — saved-to-file
 * and inline — and they emit the same fields. They were near-copies, and the
 * copies drifted the first time a field was added: `header_bytes_returned`
 * landed on one branch and not the other, so the same response reported
 * different facts depending on whether it happened to be saved.
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
    if (stderr) output.stderr = stderr;
}

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
    // origin cannot occupy, so this does not reintroduce the forgeable marker
    // that was deliberately moved out of band.
    const plainNotice = !includeMetadata
        ? [
              // A non-zero exit has no field to land in on this branch, so
              // without this line a FAILED request is byte-identical to an
              // empty successful one. That is the shape the notice below was
              // about to make worse.
              exitCode !== 0
                  ? `[mcp-curl] cURL exited ${exitCode}; the response below may be empty or incomplete`
                  : null,
              headerInfo?.truncated
                  ? `[mcp-curl] response headers truncated: ${headerInfo.bytesReturned} of ${headerInfo.bytesReceived} bytes returned`
                  : null,
              // Only ever claimed on a CLEAN exit. Keyed on `undetermined`
              // alone it asserted the body was sound on every cURL failure
              // after connect — exit 23, 35, 56, 63 — where the body is empty
              // precisely BECAUSE the request failed. The flag's domain cannot
              // answer a question about the body; `exitCode` can.
              headerInfo?.undetermined
                  ? exitCode === 0
                      ? "[mcp-curl] response headers were requested but none were received; the body below is unaffected"
                      : "[mcp-curl] response headers were requested but none were received"
                  : null,
          ].filter(Boolean).join("\n")
        : "";
    const withNotice = (text: string) => (plainNotice ? `${plainNotice}\n\n${text}` : text);
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
        return withNotice(responseHeaders ? `${responseHeaders}\n\n${message}` : message);
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
    return withNotice(responseHeaders ? `${responseHeaders}\n\n${stdout}` : stdout);
}
