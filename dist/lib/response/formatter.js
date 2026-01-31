// src/lib/response/formatter.ts
// Format response for MCP output
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
 * @returns Formatted response string
 */
export function formatResponse(stdout, stderr, exitCode, includeMetadata, fileSaveInfo) {
    // If file was saved, always indicate the filepath (user needs to know where data is)
    if (fileSaveInfo?.savedToFile && fileSaveInfo.filepath) {
        if (includeMetadata) {
            // Full JSON metadata
            const output = {
                success: exitCode === 0,
                exit_code: exitCode,
                saved_to_file: true,
                filepath: fileSaveInfo.filepath,
                message: fileSaveInfo.message ?? "Response saved to file. Read the file to access contents.",
            };
            if (stderr)
                output.stderr = stderr;
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the message or fallback to filepath
        return fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
    }
    // Normal response
    if (includeMetadata) {
        const output = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        if (stderr)
            output.stderr = stderr;
        return JSON.stringify(output, null, 2);
    }
    return stdout;
}
