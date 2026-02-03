// src/lib/execution/command-executor.ts
// Execute shell commands with memory tracking, timeout, and size limits

import { spawn, ChildProcess } from "child_process";
import { LIMITS, BYTES_PER_MB } from "../config/limits.js";
import { allocateMemory, releaseMemory } from "./memory-tracker.js";

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
export async function executeCommand(
    command: string,
    args: string[],
    timeout: number = LIMITS.DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
    // Track this request's memory usage for cleanup
    let requestMemoryUsage = 0;

    return new Promise((resolve, reject) => {
        // Use AbortController for process-level timeout (spawn ignores timeout option)
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);

        const childProcess: ChildProcess = spawn(command, args, {
            signal: abortController.signal,
        });

        let stdout = "";
        let stderr = "";
        let stderrMemoryUsage = 0;
        let killed = false;

        // Cleanup function to release memory tracking
        const releaseRequestMemory = () => {
            releaseMemory(requestMemoryUsage);
            requestMemoryUsage = 0;
        };

        childProcess.stdout?.on("data", (data: Buffer) => {
            // data is already a Buffer, so .length gives byte count directly
            const dataSize = data.length;

            // Check global memory limit
            if (!allocateMemory(dataSize) && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseRequestMemory();
                childProcess.kill();
                reject(new Error(
                    "Server memory limit reached due to concurrent requests. Please try again later."
                ));
                return;
            }

            stdout += data.toString();
            requestMemoryUsage += dataSize;

            // Check per-request limit
            if (requestMemoryUsage > LIMITS.MAX_RESPONSE_SIZE && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseRequestMemory();
                childProcess.kill();
                reject(new Error(
                    `Response exceeded maximum processing size of ${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. ` +
                    `Consider using a more specific API endpoint or adding query parameters to reduce response size.`
                ));
            }
        });

        childProcess.stderr?.on("data", (data: Buffer) => {
            if (stderrMemoryUsage < LIMITS.MAX_RESPONSE_SIZE) {
                const dataStr = data.toString();
                stderr += dataStr;
                // data is already a Buffer, so .length gives byte count directly
                stderrMemoryUsage += data.length;

                if (stderrMemoryUsage > LIMITS.MAX_RESPONSE_SIZE) {
                    // Truncate efficiently using Buffer slice
                    const truncateMsg = "\n[stderr truncated]";
                    const maxBytes = LIMITS.MAX_RESPONSE_SIZE - Buffer.byteLength(truncateMsg, "utf8");
                    const buf = Buffer.from(stderr, "utf8").subarray(0, maxBytes);
                    stderr = buf.toString("utf8") + truncateMsg;
                    stderrMemoryUsage = Buffer.byteLength(stderr, "utf8");
                }
            }
        });

        childProcess.on("close", (code: number | null) => {
            clearTimeout(timeoutId);
            releaseRequestMemory(); // Release memory tracking on completion
            if (!killed) {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            }
        });

        childProcess.on("error", (error: Error) => {
            clearTimeout(timeoutId);
            releaseRequestMemory(); // Release memory tracking on error
            // AbortError means our timeout triggered
            if (error.name === "AbortError") {
                reject(new Error(
                    `Request timed out after ${timeout / 1000} seconds. ` +
                    `The server may be slow or unresponsive.`
                ));
            } else {
                reject(error);
            }
        });
    });
}
