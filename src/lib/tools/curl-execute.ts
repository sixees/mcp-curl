// src/lib/tools/curl-execute.ts
// Registers the curl_execute tool for making HTTP requests

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CurlExecuteSchema, type CurlExecuteInput } from "../server/schemas.js";
import { TEMP_DIR, LIMITS } from "../config/index.js";
import { generateMetadataSeparator } from "../types/index.js";
import { resolveOutputDir, validateOutputDir } from "../files/index.js";
import { validateUrlAndResolveDns, checkRateLimits } from "../security/index.js";
import { getErrorMessage, safeHostname, MARKDOWN_MIME } from "../utils/index.js";
import { executeCommand, buildCurlArgs } from "../execution/index.js";
import {
    parseResponseWithMetadata,
    sanitizeErrorMessage,
    formatResponse,
    processResponse,
    defendText,
    splitResponseHeaders,
} from "../response/index.js";

/** Tool result type returned by executeCurlRequest */
export interface CurlExecuteResult {
    [key: string]: unknown;
    content: [{ type: "text"; text: string }];
    isError?: boolean;
}

/** Extra context passed to tool handler */
export interface CurlExecuteExtra {
    sessionId?: string;
    /** Override env var for allowing localhost requests (from McpCurlConfig) */
    allowLocalhost?: boolean;
}

/**
 * Tool metadata for curl_execute.
 * Exported for use by McpCurlServer to register with hooks.
 */
export const CURL_EXECUTE_TOOL_META = {
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
  - user_agent (string): Custom User-Agent header (a browser-like default is sent automatically if not set; empty string disables)
  - basic_auth (string): Basic auth as "username:password"
  - bearer_token (string): Bearer token for Authorization header
  - verbose (boolean): Include verbose request/response details
  - include_headers (boolean): Report response headers. With include_metadata they
    arrive under a separate "headers" key; without it they are prefixed to the returned
    text followed by a blank line, so that result is NOT JSON-parseable. On both
    branches headers never reach the saved file and never reach jq_filter, which is
    what makes this safe to combine with save_to_file and jq_filter. Header text is
    capped at 64KB; truncation is reported via headers_truncated
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
    "response": string (the body alone — headers are NOT in here),
    "headers": string (response header text; present only with include_headers),
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
};

/**
 * Execute a cURL request with the given parameters.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated curl_execute parameters
 * @param extra - Additional context (sessionId for rate limiting)
 * @returns Tool result with response content
 */
export async function executeCurlRequest(
    params: CurlExecuteInput,
    extra: CurlExecuteExtra = {}
): Promise<CurlExecuteResult> {
    try {
        // Validate basic_auth format if provided
        if (params.basic_auth && !params.basic_auth.includes(":")) {
            throw new Error("basic_auth must be in 'username:password' format");
        }

        // SSRF protection: validate URL and resolve DNS to prevent rebinding attacks
        // This returns the resolved IP which we pin with --resolve
        const dnsResult = await validateUrlAndResolveDns(params.url, {
            allowLocalhost: extra.allowLocalhost,
        });

        // Rate limit by both target host and client to prevent abuse
        // Per-host: protects individual targets from being hammered
        // Per-client: prevents spreading requests across many hosts to bypass limits
        // For HTTP transport, extra.sessionId identifies the client; for stdio it's undefined (uses default)
        checkRateLimits(dnsResult.hostname, extra.sessionId);

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

        // Use timeout from params, or fall back to system default
        const timeoutMs = (params.timeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1000) * 1000;
        const result = await executeCommand("curl", args, timeoutMs);

        let headerTruncated = false;
        let headerBytesReceived: number | undefined;

        // Parse response using the same unique separator. Byte-exact: the
        // header boundary below is a WIRE byte count, and `result.stdout` is a
        // lossy UTF-8 view of those bytes.
        const parsed = parseResponseWithMetadata(result.stdoutBytes, metadataSeparator);
        const { contentType, headerBytes, metadataFound } = parsed;

        // `-i` prepends the header block to the body on stdout. Split it off
        // before anything touches the body, at the offset cURL reported.
        let responseHeaders: string | undefined;
        let headersUndetermined = false;
        let body = parsed.body;
        if (params.include_headers) {
            const split = splitResponseHeaders(parsed.bodyBytes, headerBytes);
            body = split.body;
            headersUndetermined = split.headerText === undefined;
            if (split.headerText) {
                // Same pipeline as the body, not a shorter one (invariant 1a).
                // Markdown = the strictest grammar, so every strip stage runs.
                // `decodeEntities: false` because that stage is ADDITIVE and its
                // result is returned: decoding a header would hand the model a
                // live instruction the origin only ever sent as inert text.
                const defended = defendText(split.headerText, {
                    contentType: MARKDOWN_MIME,
                    hostname: safeHostname(params.url),
                    decodeEntities: false,
                });
                // Re-cap AFTER defence: `[link removed]` is longer than some of
                // the forms it replaces, so capping only before it lets the
                // documented ceiling be exceeded. Also honour the caller's
                // inline budget — this text is returned inline even when the
                // body went to a file, so `max_result_size` never bounded it.
                const inlineCeiling = Math.min(
                    LIMITS.MAX_HEADER_TEXT_BYTES,
                    params.max_result_size ?? LIMITS.DEFAULT_MAX_RESULT_SIZE
                );
                responseHeaders = Buffer.byteLength(defended, "utf8") > inlineCeiling
                    ? Buffer.from(defended, "utf8").subarray(0, inlineCeiling).toString("utf8")
                    : defended;
                headerTruncated = split.truncated === true
                    || Buffer.byteLength(defended, "utf8") > inlineCeiling;
                headerBytesReceived = split.headerBytesReceived;
            }
        }

        // The body is only PROVEN clean when the boundary was determined. When
        // it was not, the header block is still on the front of it — so the two
        // operations that turn it into a durable or parsed artefact are refused
        // rather than performed on unproven bytes. That is what makes the
        // "headers never reach the saved file or the jq_filter input" guarantee
        // true on every path instead of only the happy one, and it is invariant
        // 13's "claim nothing" applied to the body as well as to the headers.
        if (headersUndetermined && (params.save_to_file || params.jq_filter)) {
            throw new Error(
                "Response header boundary could not be determined, so the body cannot be " +
                "separated from the header block. Refusing save_to_file/jq_filter rather " +
                "than writing or filtering unseparated bytes. Retry without include_headers " +
                "to operate on the raw response."
            );
        }

        // Process response with filtering and size handling
        const processed = await processResponse(body, {
            url: params.url,
            jqFilter: params.jq_filter,
            maxResultSize: params.max_result_size,
            saveToFile: params.save_to_file,
            contentType,
            contentTypeUndetermined: !metadataFound,
            outputDir: validatedOutputDir,
        });

        // cURL stderr is remote-influenced — under `verbose` it carries the
        // origin's own response headers — and reached the model with no
        // pipeline at all. Not a shorter one: none. Same treatment as the
        // header channel, so the two text channels stay symmetric.
        const defendedStderr = result.stderr
            ? defendText(result.stderr, {
                  contentType: MARKDOWN_MIME,
                  hostname: safeHostname(params.url),
                  decodeEntities: false,
              })
            : result.stderr;

        const output = formatResponse(
            processed.content,
            defendedStderr,
            result.exitCode,
            params.include_metadata,
            {
                savedToFile: processed.savedToFile,
                filepath: processed.savedToFile ? processed.filepath : undefined,
                message: processed.message,
            },
            responseHeaders,
            {
                truncated: headerTruncated,
                bytesReceived: headerBytesReceived,
                // The caller asked for headers and provably did not get them.
                // Reporting it is the point: silence is what made the pre-fix
                // corruption invisible, because the degraded path returned bytes
                // indistinguishable from the success path.
                undetermined: params.include_headers && headersUndetermined,
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
        const hostname = safeHostname(params.url);
        const errorClass = error instanceof Error ? error.constructor.name : "Error";
        console.error(`curl_execute error: [${hostname}] ${errorClass}`);
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

/**
 * Registers the curl_execute tool on the MCP server.
 * This tool provides safe, structured HTTP request execution.
 */
export function registerCurlExecuteTool(server: McpServer): void {
    server.registerTool(
        "curl_execute",
        CURL_EXECUTE_TOOL_META,
        (params: CurlExecuteInput, extra: CurlExecuteExtra) =>
            executeCurlRequest(params, extra)
    );
}
