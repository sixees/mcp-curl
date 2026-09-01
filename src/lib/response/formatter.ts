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
 * When includeMetadata is false:
 * - If file was saved: returns the message or filepath
 * - Otherwise: returns plain stdout
 *
 * @param stdout - Standard output from the command
 * @param stderr - Standard error from the command
 * @param exitCode - Exit code (0 indicates success)
 * @param includeMetadata - Whether to wrap response in JSON with metadata
 * @param fileSaveInfo - Optional information about file saving
 * @param responseHeaders - Optional response header text (from include_headers).
 *   Reported alongside the body rather than glued to the front of it, so that a
 *   saved file stays parseable and a jq filter still sees plain JSON. Always
 *   surfaced inline even when the body went to a file — headers are small, and
 *   they are usually the reason the caller asked for them.
 * @returns Formatted response string
 */
export function formatResponse(
    stdout: string,
    stderr: string,
    exitCode: number,
    includeMetadata: boolean,
    fileSaveInfo?: FileSaveInfo,
    responseHeaders?: string
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
        if (stderr) output.stderr = stderr;
        return JSON.stringify(output, null, 2);
    }
    return responseHeaders ? `${responseHeaders}\n\n${stdout}` : stdout;
}
