// src/lib/execution/command-executor.ts
// Execute allowed commands with memory tracking, timeout, and size limits

import { spawn, ChildProcess } from "child_process";
import { Readable } from "node:stream";
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
 * **macOS only, and the reason is the descriptor's TYPE rather than the path
 * syntax.** libuv backs an extra `"pipe"` stdio slot with `socketpair(2)`, so
 * fd 3 in the child is an `AF_UNIX` socket. macOS serves `/dev/fd/N` from
 * `fdescfs`, which dups the descriptor, so cURL can open it — measured here on
 * cURL 8.7.1. Linux resolves `/dev/fd` to `/proc/self/fd`, where the entry for
 * a socket is `socket:[inode]` and cannot be opened at all: cURL would exit 23
 * on every request. `platformSupportsHeaderDump` is the guard; do not assume
 * this path works anywhere the guard has not been extended to cover.
 *
 * The failure is at least loud: with no openable descriptor cURL exits 23 and
 * writes nothing to stdout, so a header block is never folded back onto the
 * body stream.
 */
export const HEADER_DUMP_PATH = `/dev/fd/${HEADER_DUMP_FD}`;

/**
 * Whether this host can serve {@link HEADER_DUMP_PATH}.
 *
 * Consulted before the flag is added rather than after cURL fails, so an
 * unsupported host loses the header channel and keeps its response body — the
 * "degrade legibly rather than assume" rule in `ARCHITECTURE.md` →
 * *Environments*. Without it the whole request fails on exit 23 and the caller
 * loses the body too, for a feature they merely asked to include.
 */
export function platformSupportsHeaderDump(): boolean {
    return process.platform === "darwin";
}

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
     *
     * Bounded at `LIMITS.MAX_HEADER_TEXT_BYTES`. What arrived beyond that is
     * counted in {@link headerBytesReceived} and dropped: no consumer can
     * return more than the cap, so retaining more only gives a hostile origin
     * a memory lever. A redirect chain was measured putting 2.5 MB on this
     * descriptor against a 64 KB usable ceiling.
     */
    headerBytes?: Buffer;
    /**
     * Total header bytes cURL wrote, including any past the retention bound.
     *
     * Separate from `headerBytes.length` precisely so the bound above does not
     * make the "truncated at X of Y" notice describe our own cap instead of
     * what the origin sent. Counting and retaining are different questions and
     * this is the field that keeps them apart.
     */
    headerBytesReceived?: number;
    /** Standard error from the command */
    stderr: string;
    /** Exit code (0 indicates success) */
    exitCode: number;
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
 * @returns CommandResult with stdout, the header block, stderr, and exitCode
 * @throws Error if command not allowed, timeout, memory limit, or size limit exceeded
 */
export async function executeCommand(
    command: AllowedCommand,
    args: string[],
    timeout: number = LIMITS.DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
    // Runtime guard: reject commands not in the allowlist (defense-in-depth for JS callers)
    if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) {
        throw new Error(`Command not allowed: ${command}. Only ${ALLOWED_COMMANDS.join(", ")} can be executed.`);
    }

    // Validate timeout: use default for invalid values
    if (!Number.isFinite(timeout) || timeout <= 0) {
        timeout = LIMITS.DEFAULT_TIMEOUT_MS;
    }

    // Whether to open the header descriptor is READ OFF THE ARGUMENTS, never
    // passed alongside them. Two sites deciding one thing is two sites that can
    // disagree — and they did: the args builder branched on a truthy
    // `include_headers` while the caller passed `=== true`, so an untyped
    // embedder sending `1` got cURL told to write to a descriptor nobody
    // opened. Derived here, the pipe exists exactly when cURL is told to use
    // it, and there is nothing left for a caller to get wrong.
    // Bound to the FLAG's own position, never a search of the whole list.
    // `--data-raw` and `-A` carry caller-supplied values verbatim, so a bare
    // `args.includes(HEADER_DUMP_PATH)` lets `data: "/dev/fd/3"` open a
    // descriptor cURL was never told to write to. Harmless today — one extra
    // socketpair, released on close — but a spawn decision should not rest on
    // no future parameter ever equalling one particular string.
    const dumpFlagIndex = args.indexOf("--dump-header");
    const captureHeaders = dumpFlagIndex !== -1 && args[dumpFlagIndex + 1] === HEADER_DUMP_PATH;

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
            stdio: captureHeaders
                ? ["pipe", "pipe", "pipe", "pipe"]
                : ["pipe", "pipe", "pipe"],
        });

        // Chunks are concatenated once at close rather than decoded per chunk.
        // Per-chunk `.toString()` also corrupts VALID UTF-8 whose multi-byte
        // sequence straddles a chunk boundary, so this is two defects closed
        // by one change.
        const stdoutChunks: Buffer[] = [];
        const headerChunks: Buffer[] = [];
        let headerBytesReceived = 0;
        let headerBytesRetained = 0;
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
        // Retention and acceptance are bounded SEPARATELY, and both are
        // bounded. They answer different questions: no consumer can return
        // more than MAX_HEADER_TEXT_BYTES, so retaining past it is pure memory
        // cost — but the count still has to describe what the origin sent, or
        // the "X of Y" notice reports our own cap back as though it were Y.
        // A redirect chain was measured putting 2.5 MB here against a 64 KB
        // usable ceiling.
        //
        // Discarded bytes are deliberately NOT charged to the memory pool:
        // they occupy no memory, and charging them aborts a request whose body
        // is fine with an error naming a size the response never had. But an
        // uncharged read is an UNBOUNDED read — the first version of this
        // returned before any accounting, leaving the abort timer (up to 300s
        // by schema) as the only limit, and leaving the global pool blind to a
        // header flood so concurrent requests felt no backpressure. So the
        // count carries its own ceiling.
        if (captureHeaders) {
            const headerStream = childProcess.stdio[HEADER_DUMP_FD];
            // `instanceof`, not a cast. Node types this slot as
            // `Readable | Writable | null`, and `.on("data")` typechecks on
            // both — so a wrong arm would attach a handler that never fires,
            // leave the descriptor undrained, and surface as a timeout blamed
            // on the remote. Narrowing makes that a named failure instead.
            if (headerStream instanceof Readable) {
                headerStream.on("data", (data: Buffer) => {
                    if (killed) return;
                    headerBytesReceived += data.length;

                    // The acceptance ceiling. Bounded by the same constant the
                    // body is, because that is what "this response is too big
                    // to process" means — but named separately, so the message
                    // says headers rather than blaming the body.
                    if (headerBytesReceived > LIMITS.MAX_RESPONSE_SIZE) {
                        abortWith(
                            `Response headers exceeded maximum processing size of ` +
                            `${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. The origin sent an ` +
                            `unreasonable header block, possibly across a redirect chain.`
                        );
                        return;
                    }

                    const room = LIMITS.MAX_HEADER_TEXT_BYTES - headerBytesRetained;
                    if (room <= 0) return;
                    const slice = data.length <= room ? data : data.subarray(0, room);
                    if (!accountFor(slice.length)) return;
                    headerChunks.push(slice);
                    headerBytesRetained += slice.length;
                });
            } else {
                // Never observed; reported rather than ignored, because the
                // silent form of this is a 30-second timeout blamed on the origin.
                abortWith(
                    "Internal error: the response-header descriptor was not readable. " +
                    "Retry without include_headers."
                );
            }
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
                    headerBytesReceived: headerBytes ? headerBytesReceived : undefined,
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
