// src/lib/execution/command-executor.ts
// Execute allowed commands with memory tracking, timeout, and size limits

import { spawn, ChildProcess } from "child_process";
import type { Readable } from "node:stream";
import { LIMITS, BYTES_PER_MB } from "../config/limits.js";
import { allocateMemory, releaseMemory } from "./memory-tracker.js";

/** Allowlist of commands that can be executed */
const ALLOWED_COMMANDS = ["curl"] as const;

/** Union type of allowed command names */
export type AllowedCommand = typeof ALLOWED_COMMANDS[number];

/**
 * The extra file descriptor cURL writes the response header block to.
 *
 * Three is the first descriptor after the standard trio, and the number is
 * shared rather than written twice: this module opens the pipe and
 * `buildCurlArgs` names the path cURL writes to, so a disagreement between
 * them would be a silent multiplexing regression rather than a type error.
 */
export const HEADER_DUMP_FD = 3;

/**
 * The path cURL is given for `--dump-header`, naming the descriptor above.
 *
 * POSIX-only by construction. When the descriptor is absent or unwritable
 * cURL exits 23 and writes nothing to stdout — measured, and the reason this
 * mechanism is safe: the failure mode is a failed request, never a header
 * block silently folded back onto the body stream.
 */
export const HEADER_DUMP_PATH = `/dev/fd/${HEADER_DUMP_FD}`;

/**
 * Result of executing a command.
 */
export interface CommandResult {
    /**
     * Standard output as the exact octets the process wrote.
     *
     * **Octets, not a string, because a decode is not reversible.** Any byte
     * that is not valid UTF-8 becomes U+FFFD and re-encodes to three bytes
     * where the wire had one, so a decoded copy can no longer be measured or
     * indexed against anything counted on the wire. Nothing currently applies
     * a wire offset to this buffer — the header boundary that once did is
     * structural now — and this stays a Buffer so that reintroducing one is a
     * type change rather than a silent corruption (`LESSONS.md` RC-2, where a
     * length guard could never fire because replacement only ever inflates).
     */
    stdoutBytes: Buffer;
    /**
     * The response header block as exact octets, when header capture was asked
     * for and cURL wrote one.
     *
     * A separate stream, never a prefix of `stdoutBytes`. That is the whole
     * point: `curl -i` multiplexes both onto stdout, and three successive
     * attempts to recover the boundary arithmetically each failed in a new way
     * (`LESSONS.md` RC-1, RC-2, and the chunked-trailer case behind RC-17).
     * A descriptor cURL cannot write the body to is a boundary the remote
     * cannot reach.
     *
     * Undefined when capture was not requested, and when it was requested but
     * cURL emitted nothing — `curl_execute` reports the second case rather
     * than guessing, per `ARCHITECTURE.md` invariant 13.
     */
    headerBytes?: Buffer;
    /** Standard error from the command */
    stderr: string;
    /** Exit code (0 indicates success) */
    exitCode: number;
}

/** Options for {@link executeCommand}. */
export interface ExecuteCommandOptions {
    /**
     * Open {@link HEADER_DUMP_FD} so cURL can write the header block to it.
     *
     * Derived from the same `include_headers` the args builder reads, so the
     * pipe exists exactly when `--dump-header` names it. Opening it
     * unconditionally would cost nothing at runtime but would leave the
     * descriptor's purpose invisible at the call site.
     */
    captureHeaders?: boolean;
}

/**
 * Execute an allowed command with memory tracking, timeout, and size limits.
 *
 * Security features:
 * - Command allowlist: only "curl" can be executed (compile-time + runtime)
 * - Uses spawn() without shell to prevent command injection
 * - Per-request memory tracking with global limit enforcement
 * - Per-request size limit (kills process if exceeded)
 * - AbortController for process-level timeout
 * - Stderr truncation at MAX_RESPONSE_SIZE
 * - Response headers arrive on their own descriptor, so no remote-controlled
 *   byte can move the header/body boundary (ARCHITECTURE.md invariant 13)
 *
 * @param command - The command to execute (must be in ALLOWED_COMMANDS)
 * @param args - Arguments for the command
 * @param timeout - Timeout in milliseconds (defaults to LIMITS.DEFAULT_TIMEOUT_MS)
 * @param options - Set `captureHeaders` to open {@link HEADER_DUMP_FD}
 * @returns CommandResult with stdout, the header block, stderr, and exitCode
 * @throws Error if command not allowed, timeout, memory limit, or size limit exceeded
 */
export async function executeCommand(
    command: AllowedCommand,
    args: string[],
    timeout: number = LIMITS.DEFAULT_TIMEOUT_MS,
    options: ExecuteCommandOptions = {}
): Promise<CommandResult> {
    // Runtime guard: reject commands not in the allowlist (defense-in-depth for JS callers)
    if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) {
        throw new Error(`Command not allowed: ${command}. Only ${ALLOWED_COMMANDS.join(", ")} can be executed.`);
    }

    // Validate timeout: use default for invalid values
    if (!Number.isFinite(timeout) || timeout <= 0) {
        timeout = LIMITS.DEFAULT_TIMEOUT_MS;
    }

    // Track this request's memory usage for cleanup
    let requestMemoryUsage = 0;

    return new Promise((resolve, reject) => {
        // Use AbortController for process-level timeout (spawn ignores timeout option)
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);

        // The fourth descriptor is what makes the header/body split structural.
        // It is opened only when asked for, so it exists exactly when
        // `buildCurlArgs` has pointed `--dump-header` at it.
        const childProcess: ChildProcess = spawn(command, args, {
            signal: abortController.signal,
            stdio: options.captureHeaders
                ? ["pipe", "pipe", "pipe", "pipe"]
                : ["pipe", "pipe", "pipe"],
        });

        // Chunks are concatenated once at close rather than decoded per chunk.
        // Per-chunk `.toString()` also corrupts VALID UTF-8 whose multi-byte
        // sequence straddles a chunk boundary, so this is two defects closed
        // by one change.
        const stdoutChunks: Buffer[] = [];
        const headerChunks: Buffer[] = [];
        let stderr = "";
        let stderrMemoryUsage = 0;
        let killed = false;

        // Cleanup function to release memory tracking
        const releaseRequestMemory = () => {
            releaseMemory(requestMemoryUsage);
            requestMemoryUsage = 0;
        };

        const abortWith = (message: string) => {
            killed = true;
            clearTimeout(timeoutId);
            releaseRequestMemory();
            childProcess.kill();
            reject(new Error(message));
        };

        /**
         * Charge bytes to the global pool and the per-request ceiling.
         *
         * One rule, one implementation, three streams. It was two near-copies
         * before the header descriptor arrived and would have become three —
         * and every copy is a place the pool and the ceiling can drift apart
         * while each site still reads as correct.
         *
         * @returns false when the caller must stop accumulating; the promise
         *   has already been rejected by then.
         */
        const accountFor = (dataSize: number): boolean => {
            if (!allocateMemory(dataSize)) {
                abortWith("Server memory limit reached due to concurrent requests. Please try again later.");
                return false;
            }
            requestMemoryUsage += dataSize;
            if (requestMemoryUsage > LIMITS.MAX_RESPONSE_SIZE) {
                abortWith(
                    `Response exceeded maximum processing size of ${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. ` +
                    `Consider using a more specific API endpoint or adding query parameters to reduce response size.`
                );
                return false;
            }
            return true;
        };

        childProcess.stdout?.on("data", (data: Buffer) => {
            if (killed) return; // Don't accumulate data after kill
            // data is already a Buffer, so .length gives byte count directly
            if (!accountFor(data.length)) return;
            stdoutChunks.push(data);
        });

        // The header descriptor is drained the moment it is opened. A pipe
        // nobody reads fills at the OS buffer and blocks cURL's write, which
        // would hang the request rather than fail it — so the handler is
        // attached here, not lazily where the bytes are wanted.
        //
        // No cap is applied here on purpose. The header channel's ceiling is
        // invariant 14's, enforced once in `extractHeaderChannel` where the
        // caller's `max_result_size` is also in hand; a second cap here would
        // truncate the count that the "truncated at X of Y" notice reports,
        // making the notice describe our own limit instead of what arrived.
        if (options.captureHeaders) {
            const headerStream = childProcess.stdio[HEADER_DUMP_FD] as Readable | null;
            headerStream?.on("data", (data: Buffer) => {
                if (killed) return;
                if (!accountFor(data.length)) return;
                headerChunks.push(data);
            });
        }

        childProcess.stderr?.on("data", (data: Buffer) => {
            if (killed) return; // Don't accumulate data after kill

            const dataSize = data.length;

            // Enforce the global pool and the per-request ceiling across every
            // stream, so a large stderr cannot buy extra room for the body.
            if (!accountFor(dataSize)) return;

            if (stderrMemoryUsage < LIMITS.MAX_RESPONSE_SIZE) {
                const dataStr = data.toString();
                stderr += dataStr;
                stderrMemoryUsage += dataSize;

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

        childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(timeoutId);
            releaseRequestMemory(); // Release memory tracking on completion
            if (!killed) {
                // Concat INSIDE the accounted window, then drop the chunk
                // references so only one full-size copy survives. No eager
                // `.toString()`: it cost a full decode (20MB on a 10MB
                // non-UTF-8 response, since U+FFFD forces a two-byte string)
                // and no production caller ever read it.
                const stdoutBytes = Buffer.concat(stdoutChunks);
                stdoutChunks.length = 0;
                // An empty capture and no capture collapse to `undefined`, so
                // "no header bytes" has one spelling rather than two. Invariant
                // 13 requires the caller to treat undetermined and absent the
                // same way; giving them one value is how that stops being a
                // rule a caller has to remember.
                const headerBytes = headerChunks.length > 0 ? Buffer.concat(headerChunks) : undefined;
                headerChunks.length = 0;
                resolve({
                    stdoutBytes,
                    headerBytes,
                    stderr,
                    // null code means process was killed by signal — report as failure (not 0)
                    exitCode: code ?? (signal ? 1 : 0),
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
