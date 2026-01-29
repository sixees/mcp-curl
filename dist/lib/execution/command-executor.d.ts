/**
 * Result of executing a command.
 */
export interface CommandResult {
    /** Standard output from the command */
    stdout: string;
    /** Standard error from the command */
    stderr: string;
    /** Exit code (0 indicates success) */
    exitCode: number;
}
/**
 * Execute a command with memory tracking, timeout, and size limits.
 *
 * Security features:
 * - Uses spawn() without shell to prevent command injection
 * - Per-request memory tracking with global limit enforcement
 * - Per-request size limit (kills process if exceeded)
 * - AbortController for process-level timeout
 * - Stderr truncation at MAX_RESPONSE_SIZE
 *
 * @param command - The command to execute
 * @param args - Arguments for the command
 * @param timeout - Timeout in milliseconds (defaults to LIMITS.DEFAULT_TIMEOUT_MS)
 * @returns CommandResult with stdout, stderr, and exitCode
 * @throws Error if timeout, memory limit, or size limit exceeded
 */
export declare function executeCommand(command: string, args: string[], timeout?: number): Promise<CommandResult>;
