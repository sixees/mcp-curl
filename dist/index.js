#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, mkdtemp, rm, chmod, readdir, stat } from "fs/promises";
// Constants
const MAX_RESPONSE_SIZE = 10_000_000; // 10MB max response for processing (jq_filter can reduce before output)
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const SERVER_NAME = "curl-mcp-server";
const SERVER_VERSION = "1.1.0";
const DEFAULT_MAX_RESULT_SIZE = 500_000; // 500KB default for AI agent responses
const TEMP_DIR_PREFIX = "mcp-curl-";
const ORPHAN_DIR_MIN_AGE_MS = 3600000; // 1 hour - only cleanup temp dirs older than this to avoid racing with other instances
const METADATA_SEPARATOR = "\n---MCP-CURL-METADATA---\n"; // Separator for extracting content-type
const ERROR_PREVIEW_LENGTH = 200; // Characters to show in error previews
const FILENAME_MAX_LENGTH = 50; // Max length for generated filenames
// Session tracking for HTTP transport
const sessions = new Map();
const MAX_SESSIONS = 100; // Limit concurrent sessions to prevent memory exhaustion
// Rate limiting with fixed time windows and periodic cleanup (avoids per-request timers)
const MAX_REQUESTS_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10000; // Sweep every 10 seconds
const rateLimitMap = new Map();
function checkRateLimit(clientId) {
    const now = Date.now();
    const entry = rateLimitMap.get(clientId);
    // Start new window if none exists or current window expired
    if (!entry || (now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(clientId, { count: 1, windowStart: now });
        return;
    }
    if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
        throw new Error(`Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute.`);
    }
    entry.count++;
}
// Single cleanup interval instead of O(n) per-request timers
const rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [clientId, entry] of rateLimitMap) {
        if ((now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
            rateLimitMap.delete(clientId);
        }
    }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
// Prevent interval from keeping process alive during shutdown
rateLimitCleanupInterval.unref();
// Shared temp directory for saved responses (lazily initialized, cleaned up on shutdown)
let sharedTempDir = null;
let tempDirPromise = null;
async function getOrCreateTempDir() {
    // Return cached promise to prevent race condition with concurrent requests
    if (tempDirPromise) {
        return tempDirPromise;
    }
    tempDirPromise = (async () => {
        const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
        await chmod(dir, 0o700); // Owner-only access
        sharedTempDir = dir;
        return dir;
    })();
    return tempDirPromise;
}
// Clean up orphaned temp directories from previous runs (handles crashes)
// Uses age-based cleanup to avoid racing with other live instances
async function cleanupOrphanedTempDirs() {
    try {
        const tempBase = tmpdir();
        const entries = await readdir(tempBase);
        const now = Date.now();
        for (const entry of entries) {
            if (entry.startsWith(TEMP_DIR_PREFIX)) {
                const dirPath = join(tempBase, entry);
                // Skip our current session's directory
                if (dirPath === sharedTempDir)
                    continue;
                try {
                    // Only delete directories older than threshold to avoid racing with other instances
                    const stats = await stat(dirPath);
                    const ageMs = now - stats.mtimeMs;
                    if (ageMs < ORPHAN_DIR_MIN_AGE_MS) {
                        continue; // Too recent, might belong to another live instance
                    }
                    await rm(dirPath, { recursive: true, force: true });
                }
                catch (error) {
                    // Log but don't fail - dir may have been deleted by another instance
                    console.error("Error cleaning up orphaned temp dir:", dirPath, error);
                }
            }
        }
    }
    catch (error) {
        // Log but don't crash - cleanup is best-effort
        console.error("Error during orphaned temp dir cleanup:", error);
    }
}
// Check if content-type indicates JSON
function isJsonContentType(contentType) {
    if (!contentType)
        return false;
    const ct = contentType.toLowerCase();
    return ct.includes("application/json") || ct.includes("+json");
}
// Maximum distance from end where we expect to find the metadata separator
// Content-type headers are typically short, so 200 chars is plenty
const MAX_METADATA_TAIL_LENGTH = 200;
// Parse curl response to extract body and content-type
function parseResponseWithMetadata(rawResponse) {
    // Only search for separator near the end to prevent spoofing via response body
    // containing the separator string
    const searchStart = Math.max(0, rawResponse.length - MAX_METADATA_TAIL_LENGTH);
    const tailSection = rawResponse.slice(searchStart);
    const separatorIndexInTail = tailSection.lastIndexOf(METADATA_SEPARATOR);
    if (separatorIndexInTail === -1) {
        return { body: rawResponse };
    }
    const separatorIndex = searchStart + separatorIndexInTail;
    const body = rawResponse.slice(0, separatorIndex);
    const contentType = rawResponse.slice(separatorIndex + METADATA_SEPARATOR.length).trim();
    return { body, contentType: contentType || undefined };
}
// Sanitize error messages to prevent information disclosure
function sanitizeErrorMessage(message, includeDetails) {
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
function createServer() {
    return new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });
}
// Helper function to execute a command
async function executeCommand(command, args, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
        // Use AbortController for process-level timeout (spawn ignores timeout option)
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);
        const childProcess = spawn(command, args, {
            signal: abortController.signal,
        });
        let stdout = "";
        let stderr = "";
        let killed = false;
        childProcess.stdout?.on("data", (data) => {
            stdout += data.toString();
            if (Buffer.byteLength(stdout, "utf8") > MAX_RESPONSE_SIZE && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                childProcess.kill();
                reject(new Error(`Response exceeded maximum processing size of ${MAX_RESPONSE_SIZE / 1_000_000}MB. ` +
                    `Consider using a more specific API endpoint or adding query parameters to reduce response size.`));
            }
        });
        childProcess.stderr?.on("data", (data) => {
            const stderrBytes = Buffer.byteLength(stderr, "utf8");
            if (stderrBytes < MAX_RESPONSE_SIZE) {
                stderr += data.toString();
                if (Buffer.byteLength(stderr, "utf8") > MAX_RESPONSE_SIZE) {
                    // Truncate efficiently using Buffer slice
                    const truncateMsg = "\n[stderr truncated]";
                    const maxBytes = MAX_RESPONSE_SIZE - Buffer.byteLength(truncateMsg, "utf8");
                    const buf = Buffer.from(stderr, "utf8").subarray(0, maxBytes);
                    stderr = buf.toString("utf8") + truncateMsg;
                }
            }
        });
        childProcess.on("close", (code) => {
            clearTimeout(timeoutId);
            if (!killed) {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            }
        });
        childProcess.on("error", (error) => {
            clearTimeout(timeoutId);
            // AbortError means our timeout triggered
            if (error.name === "AbortError") {
                reject(new Error(`Request timed out after ${timeout / 1000} seconds. ` +
                    `The server may be slow or unresponsive.`));
            }
            else {
                reject(error);
            }
        });
    });
}
// Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidSessionId(sessionId) {
    return sessionId !== undefined && UUID_REGEX.test(sessionId);
}
// Validate that a string doesn't contain CRLF characters (prevents header injection/smuggling)
function validateNoCRLF(value, fieldName) {
    if (value.includes("\r") || value.includes("\n")) {
        throw new Error(`Invalid ${fieldName}: contains newline characters. ` +
            `This could enable header injection attacks.`);
    }
}
// SSRF protection: block requests to private/internal networks
const BLOCKED_HOSTNAME_PATTERNS = [
    /^localhost$/i,
    /^127\.\d+\.\d+\.\d+$/, // IPv4 loopback
    /^10\.\d+\.\d+\.\d+$/, // Private Class A
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // Private Class B
    /^192\.168\.\d+\.\d+$/, // Private Class C
    /^169\.254\.\d+\.\d+$/, // Link-local
    /^0\.0\.0\.0$/, // All interfaces
    /^\[?::1]?$/, // IPv6 loopback
    /^\[?fe80:/i, // IPv6 link-local
    /^\[?fc00:/i, // IPv6 unique local
    /^\[?fd[0-9a-f]{2}:/i, // IPv6 unique local
    /\.local$/i, // mDNS
    /\.internal$/i, // Common internal TLD
    /\.corp$/i, // Corporate internal
    /\.lan$/i, // Local network
];
function validateUrlNotInternal(url) {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error(`Requests to internal/private networks are not allowed: ${hostname}`);
        }
    }
}
// Build cURL arguments from structured parameters
function buildCurlArgs(params) {
    const args = [];
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
    const metadataSuffix = METADATA_SEPARATOR.replace(/\n/g, "\\n") + "%{content_type}";
    if (params.output_format) {
        args.push("-w", params.output_format + metadataSuffix);
    }
    else {
        args.push("-w", metadataSuffix);
    }
    // URL must be last
    args.push(params.url);
    return args;
}
// Format the response for output
function formatResponse(stdout, stderr, exitCode, includeMetadata, fileSaveInfo) {
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
// Parse bracket notation: [], ["key"], [n], [n:m]
function parseBracketToken(filter, startIndex) {
    let i = startIndex + 1; // skip opening [
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket "[" in filter "${filter}"`);
    }
    // Check for iterate []
    if (filter[i] === "]") {
        return { token: { type: "iterate" }, newIndex: i + 1 };
    }
    // Check for string key ["key"] with escape sequence handling
    if (filter[i] === '"' || filter[i] === "'") {
        const quote = filter[i];
        i++; // skip opening quote
        let key = "";
        let foundClosingQuote = false;
        while (i < filter.length) {
            const ch = filter[i];
            // Handle escape sequences like \" or \'
            if (ch === "\\") {
                if (i + 1 < filter.length) {
                    key += filter[i + 1];
                    i += 2;
                    continue;
                }
                // Trailing backslash with no next char; append as-is
                key += ch;
                i++;
                continue;
            }
            // End of quoted string on unescaped matching quote
            if (ch === quote) {
                i++; // skip closing quote
                foundClosingQuote = true;
                break;
            }
            key += ch;
            i++;
        }
        // Check for missing closing quote first (more specific error)
        if (!foundClosingQuote) {
            throw new Error(`Missing closing quote ${quote} in filter "${filter}"`);
        }
        if (i >= filter.length || filter[i] !== "]") {
            throw new Error(`Missing closing bracket "]" after quoted key in filter "${filter}"`);
        }
        i++; // skip ]
        return { token: { type: "key", value: key }, newIndex: i };
    }
    // Parse number index or slice
    let numStr = "";
    let hasColon = false;
    while (i < filter.length && filter[i] !== "]") {
        if (filter[i] === ":")
            hasColon = true;
        numStr += filter[i];
        i++;
    }
    // Validate closing bracket exists
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket expression in filter "${filter}" at position ${startIndex}`);
    }
    i++; // skip ]
    if (hasColon) {
        const parts = numStr.split(":");
        if (parts.length > 2) {
            throw new Error(`Invalid slice "[${numStr}]" in filter "${filter}": only [start:end] format is supported`);
        }
        let start;
        if (parts[0]) {
            const parsedStart = parseInt(parts[0], 10);
            if (Number.isNaN(parsedStart)) {
                throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}"`);
            }
            start = parsedStart;
        }
        let end;
        if (parts[1]) {
            const parsedEnd = parseInt(parts[1], 10);
            if (Number.isNaN(parsedEnd)) {
                throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}"`);
            }
            end = parsedEnd;
        }
        return {
            token: { type: "slice", start, end },
            newIndex: i,
        };
    }
    // Simple index [n]
    const index = parseInt(numStr, 10);
    if (Number.isNaN(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}"`);
    }
    return { token: { type: "index", value: index }, newIndex: i };
}
// Limits to prevent DoS via complex jq filters
const MAX_JQ_FILTER_LENGTH = 500;
const MAX_JQ_TOKENS = 50;
// Parse a jq-like filter expression into tokens
function parseJqFilter(filter) {
    if (filter.length > MAX_JQ_FILTER_LENGTH) {
        throw new Error(`jq_filter exceeds maximum length of ${MAX_JQ_FILTER_LENGTH} characters`);
    }
    const tokens = [];
    let i = filter[0] === "." ? 1 : 0; // skip leading dot
    while (i < filter.length) {
        if (filter[i] === ".") {
            i++;
            continue;
        }
        if (filter[i] === "[") {
            const result = parseBracketToken(filter, i);
            tokens.push(result.token);
            if (tokens.length > MAX_JQ_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${MAX_JQ_TOKENS} path segments`);
            }
            i = result.newIndex;
            continue;
        }
        // Bare key
        let key = "";
        while (i < filter.length && filter[i] !== "." && filter[i] !== "[") {
            key += filter[i];
            i++;
        }
        if (key) {
            tokens.push({ type: "key", value: key });
            if (tokens.length > MAX_JQ_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${MAX_JQ_TOKENS} path segments`);
            }
        }
    }
    return tokens;
}
// Type guard for plain objects (not arrays or null)
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// Apply a jq-like filter to JSON data
function applyJqFilter(jsonString, filter) {
    let data;
    try {
        data = JSON.parse(jsonString);
    }
    catch (error) {
        // SyntaxError indicates invalid JSON
        if (error instanceof SyntaxError) {
            const preview = jsonString.slice(0, ERROR_PREVIEW_LENGTH);
            throw new Error(`Response is not valid JSON. Cannot apply jq_filter.\nPreview: ${preview}${jsonString.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
        }
        throw error; // Re-throw unexpected errors
    }
    const tokens = parseJqFilter(filter);
    // Reject empty or dots-only filters that produce no tokens
    if (tokens.length === 0) {
        throw new Error(`Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`);
    }
    for (const token of tokens) {
        if (data === null || data === undefined) {
            return "null";
        }
        switch (token.type) {
            case "key":
                // Key access only works on plain objects, not arrays or primitives
                if (!isRecord(data)) {
                    return "null";
                }
                data = data[token.value];
                break;
            case "index":
                if (Array.isArray(data)) {
                    // Support negative indices: -1 is last element, -2 is second-to-last, etc.
                    const idx = token.value < 0 ? data.length + token.value : token.value;
                    data = data[idx];
                }
                else {
                    return "null";
                }
                break;
            case "slice":
                if (Array.isArray(data)) {
                    data = data.slice(token.start, token.end);
                }
                else {
                    return "null";
                }
                break;
            case "iterate":
                if (!Array.isArray(data)) {
                    return "null";
                }
                // For iterate, we just keep the array as-is for now
                // (full jq would expand it, but for our purposes keeping array is fine)
                break;
        }
    }
    return JSON.stringify(data, null, 2);
}
// Windows reserved filenames that cannot be used as base names
const WINDOWS_RESERVED_BASENAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
// Create a safe filename base from arbitrary input
function createSafeFilenameBase(input, fallback = "response") {
    // Replace non-alphanumeric characters with underscores
    let base = input.replace(/[^a-zA-Z0-9]/g, "_");
    // Trim leading and trailing underscores to avoid names like "___"
    base = base.replace(/^_+|_+$/g, "");
    // Ensure we have a non-empty base
    if (!base) {
        base = fallback;
    }
    // Enforce maximum length
    base = base.slice(0, FILENAME_MAX_LENGTH);
    const upper = base.toUpperCase();
    // Avoid reserved or problematic base names across platforms
    if (WINDOWS_RESERVED_BASENAMES.has(upper) || upper === "." || upper === "..") {
        base = `${fallback}_${base}`.slice(0, FILENAME_MAX_LENGTH);
    }
    return base;
}
// Save response content to a temporary file
async function saveResponseToFile(content, url) {
    const tempDir = await getOrCreateTempDir();
    // Create a safe filename from URL (fall back to raw string if URL is invalid)
    let baseName;
    try {
        const urlObj = new URL(url);
        baseName = urlObj.hostname + urlObj.pathname;
    }
    catch (error) {
        // TypeError indicates invalid URL format; fall back to raw string
        if (error instanceof TypeError) {
            baseName = url;
        }
        else {
            throw error; // Re-throw unexpected errors
        }
    }
    const safeName = createSafeFilenameBase(baseName);
    const filename = `${safeName}_${Date.now()}.txt`;
    const filepath = join(tempDir, filename);
    await writeFile(filepath, content, { encoding: "utf-8", mode: 0o600 }); // Owner-only access
    return filepath;
}
async function processResponse(response, options) {
    let content = response;
    // Step 1: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const trimmed = content.trim();
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(`Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"}).\n` +
                    `Preview: ${content.slice(0, ERROR_PREVIEW_LENGTH)}${content.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
            }
            // Actually try to parse it to verify it's valid JSON
            try {
                JSON.parse(trimmed);
            }
            catch (error) {
                // SyntaxError indicates invalid JSON
                if (error instanceof SyntaxError) {
                    throw new Error(`Cannot apply jq_filter: Response does not appear to be valid JSON.\n` +
                        `Preview: ${content.slice(0, ERROR_PREVIEW_LENGTH)}${content.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
                }
                throw error; // Re-throw unexpected errors
            }
        }
        content = applyJqFilter(content, options.jqFilter);
    }
    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");
    // Step 3: Check if we need to save to file
    const shouldSave = options.saveToFile || contentBytes > maxSize;
    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url);
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
        .refine((url) => {
        const scheme = url.split(":")[0].toLowerCase();
        return ["http", "https"].includes(scheme);
    }, { message: "URL must use http or https scheme" })
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
        .describe("JSON path filter to extract specific data (e.g., '.data.items[0]', '.users[0:5]'). Applied after receiving full response but before max_result_size check."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
});
// Register all tools and resources on a server instance
function registerToolsAndResources(server) {
    // Register the structured cURL execution tool
    server.registerTool("curl_execute", {
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
  - jq_filter (string): JSON path filter to extract specific data (e.g., ".data.items[0]", ".users[0:5]")
  - max_result_size (number): Max bytes to return inline (default: 500KB, max: 1MB). Auto-saves to file when exceeded
  - save_to_file (boolean): Force save response to temp file. Returns filepath instead of content

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
  - Extract data: { "url": "https://api.github.com/repos/octocat/hello-world", "jq_filter": ".name" }
  - First 10 items: { "url": "https://api.example.com/items", "jq_filter": ".results[0:10]" }
  - Force file save: { "url": "https://api.example.com/large", "save_to_file": true }

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
  - Check ${TEMP_DIR_PREFIX}* in system temp dir if files persist after crash`,
        inputSchema: CurlExecuteSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            // Validate incompatible options: include_headers prepends HTTP headers to response,
            // making it non-JSON and breaking jq_filter parsing
            if (params.include_headers && params.jq_filter) {
                throw new Error("Cannot use jq_filter with include_headers. " +
                    "HTTP headers in the response make it non-JSON. " +
                    "Remove include_headers to use jq_filter, or remove jq_filter to see headers.");
            }
            // SSRF protection: block internal/private network requests
            validateUrlNotInternal(params.url);
            // Rate limit by target host to prevent abuse
            const targetHost = new URL(params.url).hostname;
            checkRateLimit(targetHost);
            const args = buildCurlArgs({
                ...params,
                silent: true,
            });
            const result = await executeCommand("curl", args, params.timeout * 1000);
            // Parse response to extract body and content-type
            const { body, contentType } = parseResponseWithMetadata(result.stdout);
            // Process response with filtering and size handling
            const processed = await processResponse(body, {
                url: params.url,
                jqFilter: params.jq_filter,
                maxResultSize: params.max_result_size,
                saveToFile: params.save_to_file,
                contentType,
            });
            const output = formatResponse(processed.content, result.stderr, result.exitCode, params.include_metadata, { savedToFile: processed.savedToFile, filepath: processed.filepath, message: processed.message });
            return {
                content: [
                    {
                        type: "text",
                        text: output,
                    },
                ],
            };
        }
        catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
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
    });
    // Register documentation resource
    server.registerResource("documentation", "curl://docs/api", {
        title: "cURL MCP Server Documentation",
        description: "API documentation and usage examples for the cURL MCP server",
        mimeType: "text/markdown",
    }, async () => ({
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

### Large Response Handling

Responses larger than \`max_result_size\` (default: 500KB) are automatically saved to a temp file.
This prevents issues with AI agent context limits while still allowing access to full data.

The response will include:
- \`saved_to_file: true\`
- \`filepath\`: Path to the saved response file

Use \`jq_filter\` to extract only the data you need, reducing response size:
- \`.key\` - Get object property
- \`.[n]\` - Get array element at index n
- \`.[n:m]\` - Array slice from n to m
- \`.["key"]\` - Bracket notation for keys with special chars

### Examples

**Simple GET request:**
\`\`\`json
{ "url": "https://api.github.com/users/octocat" }
\`\`\`

**POST with JSON body:**
\`\`\`json
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "data": "{\\"name\\": \\"John Doe\\"}"
}
\`\`\`

**Extract specific field:**
\`\`\`json
{
  "url": "https://api.github.com/repos/octocat/hello-world",
  "jq_filter": ".name"
}
\`\`\`

**Get first 10 items from array:**
\`\`\`json
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results[0:10]"
}
\`\`\`

**Force save to file:**
\`\`\`json
{
  "url": "https://api.example.com/large-response",
  "save_to_file": true
}
\`\`\`

### Common Exit Codes

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
    }));
    // Register API testing prompt
    server.registerPrompt("api-test", {
        title: "API Testing",
        description: "Test an API endpoint and analyze the response",
        argsSchema: {
            url: z.string().describe("The API endpoint URL to test"),
            method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
            description: z.string().optional().describe("What this API endpoint does"),
        },
    }, ({ url, method = "GET", description }) => ({
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
    }));
    // Register API discovery prompt
    server.registerPrompt("api-discovery", {
        title: "REST API Discovery",
        description: "Explore a REST API to discover available endpoints",
        argsSchema: {
            base_url: z.string().describe("Base URL of the API"),
            auth_token: z.string().optional().describe("Optional bearer token for authentication"),
        },
    }, ({ base_url, auth_token }) => ({
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
    }));
}
// HTTP server reference for graceful shutdown
let httpServer = null;
// Graceful shutdown handler
async function shutdown(signal) {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    // Close HTTP server if running
    if (httpServer) {
        await new Promise((resolve, reject) => {
            httpServer.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    // Close all active sessions
    for (const [sessionId, session] of sessions) {
        try {
            session.transport.close();
            await session.server.close();
        }
        catch {
            // Ignore errors during shutdown
        }
        sessions.delete(sessionId);
    }
    // Clean up temp directory
    if (sharedTempDir) {
        try {
            await rm(sharedTempDir, { recursive: true, force: true });
        }
        catch {
            // Ignore errors during cleanup
        }
    }
    process.exit(0);
}
// Register shutdown handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
// Run with stdio transport (default)
async function runStdio() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    const server = createServer();
    registerToolsAndResources(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("cURL MCP server running on stdio");
}
// Run with HTTP transport
async function runHTTP() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    const app = express();
    // Limit request body size to prevent DoS
    app.use(express.json({ limit: "1mb" }));
    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req, res) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            // Validate session ID format if provided
            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid session ID format" },
                });
                return;
            }
            // Check for existing session
            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId);
                await session.transport.handleRequest(req, res, req.body);
                return;
            }
            // Check session limit before creating new session
            if (sessions.size >= MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Server at capacity. Try again later." },
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
                sessions.set(transport.sessionId, { server, transport });
            }
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error("MCP request error:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                });
            }
        }
    });
    // GET /mcp - Handle SSE streams for existing sessions
    app.get("/mcp", async (req, res, next) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            if (!isValidSessionId(sessionId)) {
                res.status(400).json({ error: "Invalid or missing session ID" });
                return;
            }
            if (!sessions.has(sessionId)) {
                res.status(400).json({ error: "Session not found" });
                return;
            }
            const session = sessions.get(sessionId);
            await session.transport.handleRequest(req, res);
        }
        catch (error) {
            next(error);
        }
    });
    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req, res, next) => {
        const sessionId = req.headers["mcp-session-id"];
        if (isValidSessionId(sessionId) && sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            try {
                session.transport.close();
                await session.server.close();
            }
            catch (error) {
                next(error);
                return;
            }
            finally {
                sessions.delete(sessionId);
            }
        }
        res.status(200).end();
    });
    // Global error handler
    app.use((err, _req, res, _next) => {
        console.error("Unhandled error:", err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
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
}
else {
    runStdio().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
