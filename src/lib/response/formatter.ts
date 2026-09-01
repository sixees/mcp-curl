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
 * - response: string (stdout content)
 * - stderr: string (if present)
 * - saved_to_file: boolean (if fileSaveInfo provided)
 * - filepath: string (path to saved file)
 * - message: string (informational message)
 * - headers: string (response header text, if include_headers was used)
 *
 * - headers_truncated: boolean (only when header text was cut)
 * - header_bytes_received: number (only when header text was cut)
 * - headers_undetermined: boolean (include_headers was requested but the
 *   header/body boundary could not be established, so no headers are reported
 *   and the body may still carry the header block)
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
export function formatResponse(
    stdout: string,
    stderr: string,
    exitCode: number,
    includeMetadata: boolean,
    fileSaveInfo?: FileSaveInfo,
    responseHeaders?: string,
    headerInfo?: { truncated?: boolean; bytesReceived?: number; undetermined?: boolean }
): string {
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
            if (responseHeaders) output.headers = responseHeaders;
            if (responseHeaders && headerInfo?.truncated) {
                output.headers_truncated = true;
                output.header_bytes_received = headerInfo.bytesReceived;
            }
            if (headerInfo?.undetermined) output.headers_undetermined = true;
            if (stderr) output.stderr = stderr;
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the message or fallback to filepath
        const message = fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
        return responseHeaders ? `${responseHeaders}\n\n${message}` : message;
    }

    // Normal response
    if (includeMetadata) {
        const output: Record<string, unknown> = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        if (responseHeaders) output.headers = responseHeaders;
        if (responseHeaders && headerInfo?.truncated) {
            output.headers_truncated = true;
            output.header_bytes_received = headerInfo.bytesReceived;
        }
        if (headerInfo?.undetermined) output.headers_undetermined = true;
        if (stderr) output.stderr = stderr;
        return JSON.stringify(output, null, 2);
    }
    return responseHeaders ? `${responseHeaders}\n\n${stdout}` : stdout;
}
