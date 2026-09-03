// src/lib/tools/curl-execute.ts
// Registers the curl_execute tool for making HTTP requests

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CurlExecuteSchema, type CurlExecuteInput } from "../server/schemas.js";
import { TEMP_DIR, LIMITS } from "../config/index.js";
import { generateMetadataSeparator } from "../types/index.js";
import { resolveOutputDir, validateOutputDir } from "../files/index.js";
import { validateUrlAndResolveDns, checkRateLimits } from "../security/index.js";
import { getErrorMessage, safeHostname, MARKDOWN_MIME } from "../utils/index.js";
import { executeCommand, buildCurlArgs, platformSupportsHeaderDump } from "../execution/index.js";
import {
    parseResponseWithMetadata,
    sanitizeErrorMessage,
    formatResponse,
    processResponse,
    defendText,
    extractHeaderChannel,
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
    text followed by a blank line, so that result is NOT JSON-parseable. cURL writes
    the headers to their own descriptor, so they are never part of the body: they
    cannot reach the saved file or jq_filter, and combining this with save_to_file or
    jq_filter is safe unconditionally. Header text is capped at
    min(64KB, max_result_size); truncation is reported as headers_truncated under
    include_metadata, and as a leading [mcp-curl] notice otherwise. If headers were
    asked for and none arrived, that is reported as headers_undetermined (or a leading
    [mcp-curl] notice) rather than guessed at. Requires macOS; elsewhere no headers are
    captured and that is reported as headers_unsupported, which is a fact about the host
    and NOT a statement that the origin sent none. Note that response headers routinely
    carry credential material (Set-Cookie, and Authorization where an origin echoes it)
    and this text is returned verbatim
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
 * @param extra - Additional context (sessionId for rate limiting; allowLocalhost
 *   overrides the localhost SSRF guard for this call, from McpCurlConfig)
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
        // `executeCommand` reads the header descriptor's presence off `args`,
        // so nothing here has to agree with `buildCurlArgs` about it.
        const result = await executeCommand("curl", args, timeoutMs);

        let headerTruncated = false;
        let headerBytesReceived: number | undefined;
        let headerBytesReturned: number | undefined;

        // stdout is the body alone — cURL wrote the headers to their own
        // descriptor — so this strips the `-w` metadata suffix and nothing else.
        const parsed = parseResponseWithMetadata(result.stdoutBytes, metadataSeparator);
        const { contentType, metadataFound } = parsed;
        const body = parsed.body;

        // Defending and bounding the header text is one concern with one home —
        // see `extractHeaderChannel`. Every defect this channel has produced was
        // a composition defect, so the wiring has a name rather than living
        // inline here.
        //
        // No save_to_file / jq_filter refusal accompanies this any more, and its
        // absence is the point: the body reaching those two is body bytes on
        // every path, including the one where no header block arrived. The
        // refusal existed because the boundary could be undetermined *and the
        // headers would then still be on the front of the body*. There is no
        // such path now.
        let responseHeaders: string | undefined;
        let headersUndetermined = false;
        let headersUnsupported = false;
        if (params.include_headers && !platformSupportsHeaderDump()) {
            // "this host cannot" and "the origin sent none" are different facts
            // with different owners, and collapsing them tells a caller
            // auditing an origin's security headers that it sends none — on
            // every URL, permanently. The capability is known here and nowhere
            // downstream, so this is where the distinction has to be made.
            headersUnsupported = true;
        } else if (params.include_headers) {
            const channel = extractHeaderChannel(
                result.headerBytes,
                result.headerBytesReceived,
                params.url,
                params.max_result_size
            );
            responseHeaders = channel.responseHeaders;
            headersUndetermined = channel.undetermined;
            headerTruncated = channel.truncated;
            headerBytesReceived = channel.bytesReceived;
            headerBytesReturned = channel.bytesReturned;
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
                  contentTypeUndetermined: false,
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
                bytesReturned: headerBytesReturned,
                // The caller asked for headers and provably did not get them.
                // Reporting it is the point: silence is what made the pre-fix
                // corruption invisible, because the degraded path returned bytes
                // indistinguishable from the success path.
                undetermined: headersUndetermined,
                unsupported: headersUnsupported,
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
