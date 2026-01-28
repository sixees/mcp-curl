#!/usr/bin/env node
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, {Request, Response, NextFunction} from "express";
import {Server} from "http";
import {z} from "zod";
import {spawn, ChildProcess} from "child_process";
import {randomUUID} from "crypto";
import {join, resolve, basename} from "path";
import {readFile, writeFile} from "fs/promises";

// Phase 1: Configuration and types
import {
    LIMITS,
    BYTES_PER_MB,
    SERVER,
    SESSION,
    TEMP_DIR,
    ENV,
    isWindowsReservedBasename,
} from "./lib/config/index.js";

import {
    generateMetadataSeparator,
    type Session,
    type ProcessResponseOptions,
    type ProcessedResponse,
} from "./lib/types/index.js";

// Phase 2: Files module
import {
    getOrCreateTempDir,
    cleanupOrphanedTempDirs,
    cleanupTempDir,
    resolveOutputDir,
    validateOutputDir,
} from "./lib/files/index.js";

// Phase 2: Security module
import {
    validateUrlAndResolveDns,
    checkRateLimits,
    startRateLimitCleanup,
    stopRateLimitCleanup,
    isValidSessionId,
    validateNoCRLF,
    validateFilePath,
} from "./lib/security/index.js";

// Phase 2: JQ module
import { applyJqFilter } from "./lib/jq/index.js";

// Phase 2: Utils module
import { getErrorMessage } from "./lib/utils/index.js";

// Session tracking for HTTP transport (Session type imported from lib/types)
const sessions = new Map<string, Session>();

// Periodically clean up idle sessions to prevent resource exhaustion
const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.lastActivity > SESSION.IDLE_TIMEOUT_MS) {
            try {
                session.transport.close();
            } catch (error) {
                console.error(`Warning: Error closing idle session ${id}:`, error);
            }
            sessions.delete(id);
        }
    }
}, SESSION.CLEANUP_INTERVAL_MS);

// Prevent interval from keeping process alive during shutdown
sessionCleanupInterval.unref();

// Start rate limit cleanup (encapsulated in security module)
const rateLimitCleanupInterval = startRateLimitCleanup();

// Check if the content-type indicates JSON
function isJsonContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const ct = contentType.toLowerCase();
    return ct.includes("application/json") || ct.includes("+json");
}

// Parse curl response to extract body and content-type
// The separator must be the same unique value used in the -w format string
function parseResponseWithMetadata(rawResponse: string, separator: string): { body: string; contentType?: string } {
    // Only search for separator near the end as a defense-in-depth measure
    // The unique per-request separator is the primary protection against injection
    const searchStart = Math.max(0, rawResponse.length - LIMITS.MAX_METADATA_TAIL_LENGTH);
    const tailSection = rawResponse.slice(searchStart);
    const separatorIndexInTail = tailSection.lastIndexOf(separator);

    if (separatorIndexInTail === -1) {
        return { body: rawResponse };
    }

    const separatorIndex = searchStart + separatorIndexInTail;
    const body = rawResponse.slice(0, separatorIndex);
    const contentType = rawResponse.slice(separatorIndex + separator.length).trim();
    return { body, contentType: contentType || undefined };
}

// Sanitize error messages to prevent information disclosure
function sanitizeErrorMessage(message: string, includeDetails: boolean): string {
    if (includeDetails) {
        return message;
    }
    // Remove response previews (could contain sensitive API data)
    let sanitized = message.replace(/\nPreview:[\s\S]*$/, "");
    // Remove file paths (could leak system information)
    sanitized = sanitized.replace(/\/[^\s:]+/g, "[PATH]");
    // Add hint about getting more details
    if (sanitized !== message) {
        sanitized += " (use include_metadata: true for details)";
    }
    return sanitized;
}

// Create a new MCP server instance
function createServer(): McpServer {
    return new McpServer({
        name: SERVER.NAME,
        version: SERVER.VERSION,
    });
}

/**
 * Global memory tracking for concurrent response handling.
 *
 * While each request is limited to LIMITS.MAX_RESPONSE_SIZE (10MB), multiple concurrent
 * requests could exhaust memory. This tracks total memory across all active
 * requests and rejects new data when the limit is reached.
 */
let totalResponseMemory = 0;

// Helper function to execute a command
async function executeCommand(
    command: string,
    args: string[],
    timeout: number = LIMITS.DEFAULT_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
        let killed = false;

        // Cleanup function to release memory tracking
        const releaseMemory = () => {
            totalResponseMemory -= requestMemoryUsage;
            requestMemoryUsage = 0;
        };

        childProcess.stdout?.on("data", (data: Buffer) => {
            const dataSize = Buffer.byteLength(data, "utf8");

            // Check global memory limit
            if (totalResponseMemory + dataSize > LIMITS.MAX_TOTAL_RESPONSE_MEMORY && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseMemory();
                childProcess.kill();
                reject(new Error(
                    "Server memory limit reached due to concurrent requests. Please try again later."
                ));
                return;
            }

            stdout += data.toString();
            requestMemoryUsage += dataSize;
            totalResponseMemory += dataSize;

            // Check per-request limit
            if (Buffer.byteLength(stdout, "utf8") > LIMITS.MAX_RESPONSE_SIZE && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseMemory();
                childProcess.kill();
                reject(new Error(
                    `Response exceeded maximum processing size of ${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. ` +
                    `Consider using a more specific API endpoint or adding query parameters to reduce response size.`
                ));
            }
        });

        childProcess.stderr?.on("data", (data: Buffer) => {
            const stderrBytes = Buffer.byteLength(stderr, "utf8");
            if (stderrBytes < LIMITS.MAX_RESPONSE_SIZE) {
                stderr += data.toString();
                if (Buffer.byteLength(stderr, "utf8") > LIMITS.MAX_RESPONSE_SIZE) {
                    // Truncate efficiently using Buffer slice
                    const truncateMsg = "\n[stderr truncated]";
                    const maxBytes = LIMITS.MAX_RESPONSE_SIZE - Buffer.byteLength(truncateMsg, "utf8");
                    const buf = Buffer.from(stderr, "utf8").subarray(0, maxBytes);
                    stderr = buf.toString("utf8") + truncateMsg;
                }
            }
        });

        childProcess.on("close", (code: number | null) => {
            clearTimeout(timeoutId);
            releaseMemory(); // Release memory tracking on completion
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
            releaseMemory(); // Release memory tracking on error
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

// Build cURL arguments from structured parameters
function buildCurlArgs(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: string;
    form?: Record<string, string>;
    output_format?: string;
    follow_redirects?: boolean;
    insecure?: boolean;
    timeout?: number;
    user_agent?: string;
    basic_auth?: string;
    bearer_token?: string;
    verbose?: boolean;
    include_headers?: boolean;
    max_redirects?: number;
    compressed?: boolean;
    silent?: boolean;
    // DNS pinning to prevent rebinding attacks (see validateUrlAndResolveDns)
    dnsResolve?: { hostname: string; port: number; resolvedIp: string };
    // Unique per-request separator for extracting metadata (prevents injection)
    metadataSeparator: string;
}): string[] {
    const args: string[] = [];

    // Method
    if (params.method) {
        args.push("-X", params.method.toUpperCase());
    }

    // Headers - validate against CRLF injection
    if (params.headers) {
        for (const [key, value] of Object.entries(params.headers)) {
            validateNoCRLF(key, "header name");
            validateNoCRLF(value, `header value for "${key}"`);
            args.push("-H", `${key}: ${value}`);
        }
    }

    // Data/body - use --data-raw to prevent @/< file reading (security: prevents local file exfiltration)
    if (params.data) {
        args.push("--data-raw", params.data);
    }

    // Form data - use --form-string to prevent @/< file reading (security: prevents local file exfiltration)
    if (params.form) {
        for (const [key, value] of Object.entries(params.form)) {
            args.push("--form-string", `${key}=${value}`);
        }
    }

    // Follow redirects
    if (params.follow_redirects !== false) {
        args.push("-L");
        if (params.max_redirects !== undefined) {
            args.push("--max-redirs", params.max_redirects.toString());
        }
    }

    // Insecure (skip SSL verification)
    if (params.insecure) {
        args.push("-k");
    }

    // Timeout
    if (params.timeout) {
        args.push("--max-time", params.timeout.toString());
    }

    // User agent - validate against CRLF injection
    if (params.user_agent) {
        validateNoCRLF(params.user_agent, "user_agent");
        args.push("-A", params.user_agent);
    }

    // Basic auth - validate against CRLF injection
    if (params.basic_auth) {
        validateNoCRLF(params.basic_auth, "basic_auth");
        args.push("-u", params.basic_auth);
    }

    // Bearer token - validate against CRLF injection
    if (params.bearer_token) {
        validateNoCRLF(params.bearer_token, "bearer_token");
        args.push("-H", `Authorization: Bearer ${params.bearer_token}`);
    }

    // Verbose mode
    if (params.verbose) {
        args.push("-v");
    }

    // Include response headers
    if (params.include_headers) {
        args.push("-i");
    }

    // Compressed response
    if (params.compressed) {
        args.push("--compressed");
    }

    // Silent mode (no progress)
    if (params.silent !== false) {
        args.push("-s");
    }

    // Output format for response info (custom format + metadata separator for content-type)
    // The separator is unique per-request to prevent response injection attacks
    const metadataSuffix = params.metadataSeparator.replace(/\n/g, "\\n") + "%{content_type}";
    if (params.output_format) {
        args.push("-w", params.output_format + metadataSuffix);
    } else {
        args.push("-w", metadataSuffix);
    }

    // DNS pinning with --resolve to prevent DNS rebinding attacks
    // Format: --resolve hostname:port:ip
    // This forces cURL to use our pre-validated IP instead of doing its own DNS lookup
    if (params.dnsResolve) {
        const { hostname, port, resolvedIp } = params.dnsResolve;
        args.push("--resolve", `${hostname}:${port}:${resolvedIp}`);
    }

    // URL must be last
    args.push(params.url);

    return args;
}

// Format the response for output
function formatResponse(
    stdout: string,
    stderr: string,
    exitCode: number,
    includeMetadata: boolean,
    fileSaveInfo?: { savedToFile: boolean; filepath?: string; message?: string }
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
            if (stderr) output.stderr = stderr;
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the message or fallback to filepath
        return fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
    }

    // Normal response
    if (includeMetadata) {
        const output: Record<string, unknown> = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        if (stderr) output.stderr = stderr;
        return JSON.stringify(output, null, 2);
    }
    return stdout;
}

// Create a safe filename base from arbitrary input
function createSafeFilenameBase(input: string, fallback = "response"): string {
    // Replace non-alphanumeric characters with underscores
    let base = input.replace(/[^a-zA-Z0-9]/g, "_");
    // Trim leading and trailing underscores to avoid names like "___"
    base = base.replace(/^_+|_+$/g, "");
    // Ensure we have a non-empty base
    if (!base) {
        base = fallback;
    }
    // Enforce maximum length
    base = base.slice(0, LIMITS.FILENAME_MAX_LENGTH);
    // Avoid reserved or problematic base names across platforms
    // (isWindowsReservedBasename handles case-insensitivity internally)
    if (isWindowsReservedBasename(base) || base === "." || base === "..") {
        base = `${fallback}_${base}`.slice(0, LIMITS.FILENAME_MAX_LENGTH);
    }
    return base;
}

// Save response content to a file (custom output dir or temp dir)
async function saveResponseToFile(content: string, url: string, outputDir?: string): Promise<string> {
    // Use custom output dir if provided, otherwise use temp dir
    const targetDir = outputDir ?? await getOrCreateTempDir();

    // Create a safe filename from URL (fall back to raw string if URL is invalid)
    let baseName: string;
    try {
        const urlObj = new URL(url);
        baseName = urlObj.hostname + urlObj.pathname;
    } catch (error) {
        // TypeError indicates invalid URL format; fall back to raw string
        if (error instanceof TypeError) {
            baseName = url;
        } else {
            throw error; // Re-throw unexpected errors
        }
    }
    const safeName = createSafeFilenameBase(baseName);
    const filename = `${safeName}_${Date.now()}.txt`;
    const filepath = join(targetDir, filename);

    await writeFile(filepath, content, { encoding: "utf-8", mode: 0o600 }); // Owner-only access
    return filepath;
}

// Process response with filtering and size handling (types imported from lib/types)
async function processResponse(
    response: string,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    let content = response;

    // Step 1: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const trimmed = content.trim();
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(
                    `Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"}).\n` +
                    `Preview: ${content.slice(0, LIMITS.ERROR_PREVIEW_LENGTH)}${content.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`
                );
            }
            // Actually try to parse it to verify it's valid JSON
            try {
                JSON.parse(trimmed);
            } catch (error) {
                // SyntaxError indicates invalid JSON
                if (error instanceof SyntaxError) {
                    throw new Error(
                        `Cannot apply jq_filter: Response does not appear to be valid JSON.\n` +
                        `Preview: ${content.slice(0, LIMITS.ERROR_PREVIEW_LENGTH)}${content.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`
                    );
                }
                throw error; // Re-throw unexpected errors
            }
        }
        content = applyJqFilter(content, options.jqFilter);
    }

    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");

    // Step 3: Check if we need to save to file
    const shouldSave = options.saveToFile || contentBytes > maxSize;

    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url, options.outputDir);
        // Keep content as actual response data, capped to maxSize for preview
        const displayContent = contentBytes > maxSize ? content.slice(0, maxSize) : content;
        return {
            content: displayContent,
            savedToFile: true,
            filepath,
            message: `Response (${contentBytes} bytes) saved to: ${filepath}`,
        };
    }

    return {
        content,
        savedToFile: false,
    };
}

// Schema for structured cURL execution
const CurlExecuteSchema = z.object({
    url: z.string()
        .url("Must be a valid URL")
        .refine(
            (url) => {
                const scheme = url.split(":")[0].toLowerCase();
                return ["http", "https"].includes(scheme);
            },
            { message: "URL must use http or https scheme" }
        )
        .describe("The URL to request"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .describe("HTTP method (defaults to GET, or POST if data is provided)"),
    headers: z.record(z.string())
        .optional()
        .describe("HTTP headers as key-value pairs (e.g., {\"Content-Type\": \"application/json\"})"),
    data: z.string()
        .optional()
        .describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
    form: z.record(z.string())
        .optional()
        .describe("Form data as key-value pairs (uses multipart/form-data)"),
    follow_redirects: z.boolean()
        .default(true)
        .describe("Follow HTTP redirects (default: true)"),
    max_redirects: z.number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Maximum number of redirects to follow"),
    insecure: z.boolean()
        .default(false)
        .describe("Skip SSL certificate verification (default: false)"),
    timeout: z.number()
        .int()
        .min(1)
        .max(300)
        .default(30)
        .describe("Request timeout in seconds (default: 30, max: 300)"),
    user_agent: z.string()
        .optional()
        .describe("Custom User-Agent header"),
    basic_auth: z.string()
        .optional()
        .describe("Basic authentication in format 'username:password'"),
    bearer_token: z.string()
        .optional()
        .describe("Bearer token for Authorization header"),
    verbose: z.boolean()
        .default(false)
        .describe("Include verbose output with request/response details"),
    include_headers: z.boolean()
        .default(false)
        .describe("Include response headers in output"),
    compressed: z.boolean()
        .default(true)
        .describe("Request compressed response and automatically decompress"),
    include_metadata: z.boolean()
        .default(false)
        .describe("Wrap response in JSON with metadata (exit code, success status)"),
    jq_filter: z.string()
        .optional()
        .describe("JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory."),
});

type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;

// Schema for jq_query tool (query JSON files without HTTP requests)
const JqQuerySchema = z.object({
    filepath: z.string()
        .describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
    jq_filter: z.string()
        .describe("JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save result to file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save result files (must exist and be writable)"),
});

type JqQueryInput = z.infer<typeof JqQuerySchema>;

// Register all tools and resources on a server instance
function registerToolsAndResources(server: McpServer): void {
    // Register the structured cURL execution tool
    server.registerTool(
        "curl_execute",
        {
            title: "Execute cURL Request",
            description: `Execute an HTTP request using cURL with structured parameters.

This tool provides a safe, structured way to make HTTP requests with common cURL options.
It handles URL encoding, header formatting, and response processing automatically.

Args:
  - url (string, required): The URL to request
  - method (string): HTTP method - GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
  - headers (object): HTTP headers as key-value pairs
  - data (string): Request body for POST/PUT/PATCH requests
  - form (object): Form data as key-value pairs (multipart/form-data)
  - follow_redirects (boolean): Follow HTTP redirects (default: true)
  - max_redirects (number): Maximum redirects to follow (0-50)
  - insecure (boolean): Skip SSL verification (default: false)
  - timeout (number): Request timeout in seconds (1-300, default: 30)
  - user_agent (string): Custom User-Agent header
  - basic_auth (string): Basic auth as "username:password"
  - bearer_token (string): Bearer token for Authorization header
  - verbose (boolean): Include verbose request/response details
  - include_headers (boolean): Include response headers in output
  - compressed (boolean): Request compressed response (default: true)
  - include_metadata (boolean): Wrap response in JSON with metadata
  - jq_filter (string): JSON path filter to extract specific data
  - max_result_size (number): Max bytes to return inline (default: 500KB, max: 1MB). Auto-saves to file when exceeded
  - save_to_file (boolean): Force save response to temp file. Returns filepath instead of content
  - output_dir (string): Custom directory to save files (overrides MCP_CURL_OUTPUT_DIR env var)

jq_filter Syntax:
  - .key - Object property access
  - .[n] or .n - Array index (non-negative only, e.g., .results.0)
  - .[n:m] - Array slice from index n to m
  - .["key"] - Bracket notation for special characters in keys
  - .a,.b,.c - Multiple comma-separated paths (returns array of values, max 20)

jq_filter Validation:
  - Unclosed quotes and brackets throw clear errors
  - Leading zeros in indices rejected (use .0 not .00)
  - Negative indices not supported (unlike real jq)
  - Indices must be within safe integer range

Returns:
  The HTTP response body, or JSON with metadata if include_metadata is true:
  {
    "success": boolean,
    "exit_code": number,
    "response": string,
    "stderr": string (if present),
    "saved_to_file": boolean (if response was saved),
    "filepath": string (path to saved file)
  }

Examples:
  - Simple GET: { "url": "https://api.example.com/data" }
  - POST JSON: { "url": "https://api.example.com/users", "method": "POST", "headers": {"Content-Type": "application/json"}, "data": "{\\"name\\": \\"John\\"}" }
  - With auth: { "url": "https://api.example.com/secure", "bearer_token": "your-token-here" }
  - Extract field: { "url": "https://api.github.com/repos/octocat/hello-world", "jq_filter": ".name" }
  - Multiple fields: { "url": "https://api.example.com/user", "jq_filter": ".name,.email,.id" }
  - Dot notation: { "url": "https://api.example.com/items", "jq_filter": ".results.0.name" }
  - Array slice: { "url": "https://api.example.com/items", "jq_filter": ".results[0:10]" }
  - Custom output: { "url": "https://api.example.com/large", "save_to_file": true, "output_dir": "/path/to/dir" }

Error Handling:
  - Returns error message if cURL fails or times out
  - Exit code 0 indicates success
  - Non-zero exit codes indicate various cURL errors
  - Invalid JSON with jq_filter returns error with response preview

Temp File Lifecycle:
  Files saved with save_to_file or auto-save are:
  - Stored in a secure temp directory (owner-only access: 0o700/0o600)
  - Deleted on graceful server shutdown (SIGINT/SIGTERM)
  - Orphaned files from crashed sessions are cleaned on next server start
  - Check ${TEMP_DIR.PREFIX}* in system temp dir if files persist after crash`,
            inputSchema: CurlExecuteSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
        },
        async (params: CurlExecuteInput) => {
            try {
                // Validate incompatible options: include_headers prepends HTTP headers to response,
                // making it non-JSON and breaking jq_filter parsing
                if (params.include_headers && params.jq_filter) {
                    throw new Error(
                        "Cannot use jq_filter with include_headers. " +
                        "HTTP headers in the response make it non-JSON. " +
                        "Remove include_headers to use jq_filter, or remove jq_filter to see headers."
                    );
                }

                // SSRF protection: validate URL and resolve DNS to prevent rebinding attacks
                // This returns the resolved IP which we pin with --resolve
                const dnsResult = await validateUrlAndResolveDns(params.url);

                // Rate limit by both target host and client to prevent abuse
                // Per-host: protects individual targets from being hammered
                // Per-client: prevents spreading requests across many hosts to bypass limits
                checkRateLimits(dnsResult.hostname);

                // Resolve and validate output directory (returns real path with symlinks resolved)
                const resolvedOutputDir = resolveOutputDir(params.output_dir);
                const validatedOutputDir = resolvedOutputDir
                    ? await validateOutputDir(resolvedOutputDir)
                    : undefined;

                // Generate unique separator for this request to prevent response injection
                const metadataSeparator = generateMetadataSeparator();

                const args = buildCurlArgs({
                    ...params,
                    silent: true,
                    dnsResolve: dnsResult,
                    metadataSeparator,
                });

                const result = await executeCommand("curl", args, params.timeout * 1000);

                // Parse response using the same unique separator
                const { body, contentType } = parseResponseWithMetadata(result.stdout, metadataSeparator);

                // Process response with filtering and size handling
                const processed = await processResponse(body, {
                    url: params.url,
                    jqFilter: params.jq_filter,
                    maxResultSize: params.max_result_size,
                    saveToFile: params.save_to_file,
                    contentType,
                    outputDir: validatedOutputDir,
                });

                const output = formatResponse(
                    processed.content,
                    result.stderr,
                    result.exitCode,
                    params.include_metadata,
                    {
                        savedToFile: processed.savedToFile,
                        filepath: processed.savedToFile ? processed.filepath : undefined,
                        message: processed.message,
                    }
                );

                return {
                    content: [
                        {
                            type: "text",
                            text: output,
                        },
                    ],
                };
            } catch (error) {
                const rawMessage = getErrorMessage(error);
                const errorMessage = sanitizeErrorMessage(rawMessage, params.include_metadata);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error executing cURL request: ${errorMessage}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Register the jq_query tool for querying JSON files
    server.registerTool(
        "jq_query",
        {
            title: "Query JSON File",
            description: `Query an existing JSON file with a jq-like filter expression.

This tool allows you to extract data from saved JSON files without making new HTTP requests.
Useful for:
- Extracting different fields from a large saved response
- Applying multiple queries to the same data
- Processing any local JSON file within allowed directories

Args:
  - filepath (string, required): Path to a JSON file to query
  - jq_filter (string, required): JSON path filter expression
  - max_result_size (number): Max bytes inline (default: 500KB, max: 1MB)
  - save_to_file (boolean): Force save result to file
  - output_dir (string): Custom directory to save result files

Filter Syntax:
  - .key - Get object property
  - .[n] - Get array element at index n (non-negative only, also .n with dot notation)
  - .[n:m] - Array slice from n to m
  - .["key"] - Bracket notation for keys with special chars
  - .name,.email - Multiple comma-separated paths (returns array of values, max 20)
  - Note: Negative indices not supported (unlike real jq)

Security:
  - Only files in these directories can be read:
    1. Our temp directory (files saved by curl_execute)
    2. MCP_CURL_OUTPUT_DIR environment variable path
    3. Current working directory and ALL subdirectories (broad - ensure cwd is safe)
  - Maximum file size: 10MB

Examples:
  - Extract name: { "filepath": "/path/to/response.txt", "jq_filter": ".name" }
  - Multiple fields: { "filepath": "/path/to/data.json", "jq_filter": ".name,.email,.id" }
  - Array slice: { "filepath": "/path/to/list.json", "jq_filter": ".items[0:5]" }`,
            inputSchema: JqQuerySchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (params: JqQueryInput) => {
            try {
                // Validate file path (security check)
                await validateFilePath(params.filepath);

                // Resolve and validate output directory if saving (returns real path with symlinks resolved)
                const resolvedOutputDir = resolveOutputDir(params.output_dir);
                const validatedOutputDir = resolvedOutputDir
                    ? await validateOutputDir(resolvedOutputDir)
                    : undefined;

                // Read the file
                const content = await readFile(resolve(params.filepath), { encoding: "utf-8" });

                // Apply jq filter
                const filtered = applyJqFilter(content, params.jq_filter);

                // Handle result size and file saving
                const maxSize = params.max_result_size ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
                const contentBytes = Buffer.byteLength(filtered, "utf8");
                const shouldSave = params.save_to_file || contentBytes > maxSize;

                if (shouldSave) {
                    // Generate a filename based on the source file
                    const sourceBasename = basename(params.filepath) || "query_result";
                    const safeName = createSafeFilenameBase(sourceBasename, "query_result");
                    const filename = `${safeName}_${Date.now()}.txt`;
                    const targetDir = validatedOutputDir ?? await getOrCreateTempDir();
                    const filepath = join(targetDir, filename);

                    await writeFile(filepath, filtered, { encoding: "utf-8", mode: 0o600 });

                    return {
                        content: [
                            {
                                type: "text",
                                text: `Result (${contentBytes} bytes) saved to: ${filepath}`,
                            },
                        ],
                    };
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: filtered,
                        },
                    ],
                };
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error querying JSON file: ${errorMessage}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Register documentation resource
    server.registerResource(
        "documentation",
        "curl://docs/api",
        {
            title: "cURL MCP Server Documentation",
            description: "API documentation and usage examples for the cURL MCP server",
            mimeType: "text/markdown",
        },
        async () => ({
            contents: [{
                uri: "curl://docs/api",
                mimeType: "text/markdown",
                text: `# cURL MCP Server API

## Tool: curl_execute

Execute HTTP requests with structured, validated parameters.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | Yes | - | The URL to request |
| method | string | No | GET | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| headers | object | No | - | HTTP headers as key-value pairs |
| data | string | No | - | Request body data |
| form | object | No | - | Form data as key-value pairs |
| timeout | number | No | 30 | Request timeout in seconds (1-300) |
| bearer_token | string | No | - | Bearer token for Authorization |
| basic_auth | string | No | - | Basic auth as "username:password" |
| follow_redirects | boolean | No | true | Follow HTTP redirects |
| include_headers | boolean | No | false | Include response headers |
| include_metadata | boolean | No | false | Return JSON with metadata |
| jq_filter | string | No | - | JSON path filter (e.g., ".data.items[0]") |
| max_result_size | number | No | 500KB | Max bytes inline before auto-save (max: 1MB) |
| save_to_file | boolean | No | false | Force save response to temp file |
| output_dir | string | No | - | Custom directory for saved files (overrides MCP_CURL_OUTPUT_DIR) |

### Large Response Handling

Responses larger than \`max_result_size\` (default: 500KB) are automatically saved to a file.
Files are saved to (in priority order):
1. \`output_dir\` parameter if provided
2. \`MCP_CURL_OUTPUT_DIR\` environment variable if set
3. System temp directory (cleaned up on shutdown)

### jq_filter Syntax

Extract data from JSON responses:
- \`.key\` - Get object property
- \`.[n]\` or \`.n\` - Get array element at index n (non-negative only)
- \`.[n:m]\` - Array slice from n to m
- \`.["key"]\` - Bracket notation for keys with special chars
- \`.name,.email\` - Multiple comma-separated paths (returns array of values, max 20)

**Validation:**
- Unclosed quotes and unmatched brackets throw clear errors
- Leading zeros in indices are rejected (use \`.0\` not \`.00\`)
- Negative indices are not supported (unlike real \`jq\`)
- Indices must be within JavaScript safe integer range

### Examples

**Simple GET request:**
\`\`\`json
{ "url": "https://api.github.com/users/octocat" }
\`\`\`

**Extract multiple fields:**
\`\`\`json
{
  "url": "https://api.github.com/users/octocat",
  "jq_filter": ".name,.email,.location"
}
\`\`\`

**Using dot notation for arrays:**
\`\`\`json
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results.0.name"
}
\`\`\`

**Save to custom directory:**
\`\`\`json
{
  "url": "https://api.example.com/large",
  "save_to_file": true,
  "output_dir": "/path/to/accessible/dir"
}
\`\`\`

## Tool: jq_query

Query existing JSON files with jq_filter without making new HTTP requests.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filepath | string | Yes | Path to JSON file (must be in allowed directory) |
| jq_filter | string | Yes | JSON path filter expression |
| max_result_size | number | No | Max bytes inline (default: 500KB) |
| save_to_file | boolean | No | Force save result to file |
| output_dir | string | No | Directory for saved result files |

### Security

Files can only be read from:
- Our temp directory (files saved by curl_execute)
- MCP_CURL_OUTPUT_DIR path
- Current working directory and all subdirectories

**Note:** The cwd permission is broad. Ensure the server's working directory doesn't contain sensitive files.

### Example

\`\`\`json
{
  "filepath": "/path/to/saved_response.txt",
  "jq_filter": ".users[0:5].name"
}
\`\`\`

## Security

### Network Protection
- **SSRF Prevention**: Blocks private IPs, IPv4-mapped IPv6, internal TLDs
- **DNS Rebinding Prevention**: DNS resolved before validation, cURL pinned via \`--resolve\`
- **Protocol Whitelist**: Only http:// and https:// allowed
- **Localhost**: Blocked by default (set MCP_CURL_ALLOW_LOCALHOST=true with port restrictions)

### Rate Limits
- Per-hostname: 60 requests/minute
- Per-client: 300 requests/minute total

### Resource Limits
- Max response for processing: 10MB
- Max inline result: 1MB (default 500KB)
- Global memory limit: 100MB across concurrent requests
- JQ parsing timeout: 100ms
- Request timeout: 30 seconds (configurable up to 300s)

### File Security
- Symlinks resolved via realpath() before validation
- Path traversal (\`..\`) blocked
- jq_query restricted to temp dir, MCP_CURL_OUTPUT_DIR, and cwd

## Common Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 6 | Could not resolve host |
| 7 | Failed to connect |
| 28 | Operation timeout |
| 35 | SSL connect error |
| 52 | Empty reply from server |
`,
            }],
        })
    );

    // Register API testing prompt
    server.registerPrompt(
        "api-test",
        {
            title: "API Testing",
            description: "Test an API endpoint and analyze the response",
            argsSchema: {
                url: z.string().describe("The API endpoint URL to test"),
                method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
                description: z.string().optional().describe("What this API endpoint does"),
            },
        },
        ({url, method = "GET", description}) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Test the following API endpoint:

URL: ${url}
Method: ${method}
${description ? `Description: ${description}` : ""}

Please:
1. Make the request using curl_execute
2. Analyze the response structure
3. Report the status and any errors
4. Summarize what the response contains`,
                },
            }],
        })
    );

    // Register API discovery prompt
    server.registerPrompt(
        "api-discovery",
        {
            title: "REST API Discovery",
            description: "Explore a REST API to discover available endpoints",
            argsSchema: {
                base_url: z.string().describe("Base URL of the API"),
                auth_token: z.string().optional().describe("Optional bearer token for authentication"),
            },
        },
        ({base_url, auth_token}) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Explore the REST API at: ${base_url}

${auth_token ? `Use bearer token for authentication: ${auth_token}` : "No authentication token provided."}

Please:
1. Try common discovery endpoints (/api, /api/v1, /health, /swagger.json, /openapi.json)
2. Check for available methods using OPTIONS requests
3. Look for API documentation endpoints
4. Report what you discover about the API structure`,
                },
            }],
        })
    );
}

// HTTP server reference for graceful shutdown
let httpServer: Server | null = null;

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);

    // Close HTTP server if running
    if (httpServer) {
        try {
            await new Promise<void>((resolve, reject) => {
                httpServer!.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            console.error("Warning: Error closing HTTP server:", error);
        }
    }

    // Close all active sessions
    for (const [sessionId, session] of sessions) {
        try {
            session.transport.close();
            await session.server.close();
        } catch (error) {
            console.error(`Warning: Error closing session ${sessionId} during shutdown:`, error);
        }
        sessions.delete(sessionId);
    }

    // Stop cleanup intervals
    clearInterval(sessionCleanupInterval);
    stopRateLimitCleanup(rateLimitCleanupInterval);

    // Clean up temp directory (handles errors internally)
    await cleanupTempDir();

    process.exit(0);
}

// Register shutdown handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Run with stdio transport (default)
async function runStdio(): Promise<void> {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();

    const server = createServer();
    registerToolsAndResources(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("cURL MCP server running on stdio");
}

/**
 * Authentication middleware for HTTP transport.
 *
 * When MCP_AUTH_TOKEN is set, all HTTP requests must include a matching
 * Bearer token in the Authorization header. This prevents unauthorized
 * clients from accessing the MCP server when running in HTTP mode.
 *
 * Usage: Set MCP_AUTH_TOKEN=your-secret-token in the environment.
 */
function createAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    const authToken = process.env[ENV.AUTH_TOKEN];

    return (req: Request, res: Response, next: NextFunction): void => {
        // If no token configured, allow all requests (backward compatible)
        if (!authToken) {
            next();
            return;
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${authToken}`) {
            res.status(401).json({
                jsonrpc: "2.0",
                error: {
                    code: -32600,
                    message: "Unauthorized: Invalid or missing authentication token",
                },
            });
            return;
        }

        next();
    };
}

// Run with HTTP transport
async function runHTTP(): Promise<void> {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();

    const app = express();
    // Limit request body size to prevent DoS
    app.use(express.json({ limit: "1mb" }));

    // Apply authentication middleware to all /mcp routes when token is configured
    const authMiddleware = createAuthMiddleware();
    app.use("/mcp", authMiddleware);

    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req: Request, res: Response) => {
        try {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;

            // Validate session ID format if provided
            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {code: -32600, message: "Invalid session ID format"},
                });
                return;
            }

            // Check for existing session
            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId)!;
                session.lastActivity = Date.now(); // Update activity timestamp
                await session.transport.handleRequest(req, res, req.body);
                return;
            }

            // Check session limit before creating new session
            if (sessions.size >= SESSION.MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: "2.0",
                    error: {code: -32603, message: "Server at capacity. Try again later."},
                });
                return;
            }

            // Create new session
            const server = createServer();
            registerToolsAndResources(server);

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
            });

            // Track session when initialized
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && sessions.has(sid)) {
                    sessions.delete(sid);
                }
            };

            await server.connect(transport);

            // Store session after connection
            if (transport.sessionId) {
                sessions.set(transport.sessionId, {
                    server,
                    transport,
                    lastActivity: Date.now(),
                });
            }

            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error("MCP request error:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {code: -32603, message: "Internal server error"},
                });
            }
        }
    });

    // GET /mcp - Handle SSE streams for existing sessions
    app.get("/mcp", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;
            if (!isValidSessionId(sessionId)) {
                res.status(400).json({error: "Invalid or missing session ID"});
                return;
            }
            if (!sessions.has(sessionId)) {
                res.status(400).json({error: "Session not found"});
                return;
            }
            const session = sessions.get(sessionId)!;
            session.lastActivity = Date.now(); // Update activity timestamp
            await session.transport.handleRequest(req, res);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (isValidSessionId(sessionId) && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            try {
                session.transport.close();
                await session.server.close();
            } catch (error) {
                next(error);
                return;
            } finally {
                sessions.delete(sessionId);
            }
        }
        res.status(200).end();
    });

    // Global error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error("Unhandled error:", err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: {code: -32603, message: "Internal server error"},
            });
        }
    });

    const port = parseInt(process.env.PORT || "3000");
    httpServer = app.listen(port, () => {
        console.error(`cURL MCP server running on http://localhost:${port}/mcp`);
    });
}

// Main entry point
const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "http") {
    runHTTP().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
} else {
    runStdio().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
