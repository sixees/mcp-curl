#!/usr/bin/env node
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, {Request, Response, NextFunction} from "express";
import {Server} from "http";
import {z} from "zod";
import {spawn, ChildProcess} from "child_process";
import {randomUUID} from "crypto";
import {tmpdir} from "os";
import {join} from "path";
import {writeFile, mkdtemp, rm} from "fs/promises";

// Constants
const MAX_RESPONSE_SIZE = 4_000_000; // 4MB max response
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const SERVER_NAME = "curl-mcp-server";
const SERVER_VERSION = "1.0.0";
const DEFAULT_MAX_RESULT_SIZE = 500_000; // 500KB default for AI agent responses
const TEMP_DIR_PREFIX = "mcp-curl-";
const METADATA_SEPARATOR = "\n---MCP-CURL-METADATA---\n"; // Separator for extracting content-type

// Session tracking for HTTP transport
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// Shared temp directory for saved responses (lazily initialized, cleaned up on shutdown)
let sharedTempDir: string | null = null;

async function getOrCreateTempDir(): Promise<string> {
    if (!sharedTempDir) {
        sharedTempDir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    }
    return sharedTempDir;
}

// Check if content-type indicates JSON
function isJsonContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const ct = contentType.toLowerCase();
    return ct.includes("application/json") || ct.includes("+json");
}

// Parse curl response to extract body and content-type
function parseResponseWithMetadata(rawResponse: string): { body: string; contentType?: string } {
    const separatorIndex = rawResponse.lastIndexOf(METADATA_SEPARATOR);
    if (separatorIndex === -1) {
        return { body: rawResponse };
    }
    const body = rawResponse.slice(0, separatorIndex);
    const contentType = rawResponse.slice(separatorIndex + METADATA_SEPARATOR.length).trim();
    return { body, contentType: contentType || undefined };
}

// Create a new MCP server instance
function createServer(): McpServer {
    return new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });
}

// Helper function to execute a command
async function executeCommand(
    command: string,
    args: string[],
    timeout: number = DEFAULT_TIMEOUT
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const childProcess: ChildProcess = spawn(command, args, {
            timeout,
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        childProcess.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
            if (stdout.length > MAX_RESPONSE_SIZE && !killed) {
                killed = true;
                childProcess.kill();
                reject(new Error(`Response exceeded maximum size of ${MAX_RESPONSE_SIZE} bytes`));
            }
        });

        childProcess.stderr?.on("data", (data: Buffer) => {
            if (stderr.length < MAX_RESPONSE_SIZE) {
                stderr += data.toString();
                if (stderr.length > MAX_RESPONSE_SIZE) {
                    stderr = stderr.slice(0, MAX_RESPONSE_SIZE) + "\n[stderr truncated]";
                }
            }
        });

        childProcess.on("close", (code: number | null) => {
            if (!killed) {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            }
        });

        childProcess.on("error", (error: Error) => {
            reject(error);
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
}): string[] {
    const args: string[] = [];

    // Method
    if (params.method) {
        args.push("-X", params.method.toUpperCase());
    }

    // Headers
    if (params.headers) {
        for (const [key, value] of Object.entries(params.headers)) {
            args.push("-H", `${key}: ${value}`);
        }
    }

    // Data/body
    if (params.data) {
        args.push("-d", params.data);
    }

    // Form data
    if (params.form) {
        for (const [key, value] of Object.entries(params.form)) {
            args.push("-F", `${key}=${value}`);
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

    // User agent
    if (params.user_agent) {
        args.push("-A", params.user_agent);
    }

    // Basic auth
    if (params.basic_auth) {
        args.push("-u", params.basic_auth);
    }

    // Bearer token
    if (params.bearer_token) {
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
    } else {
        args.push("-w", metadataSuffix);
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
    fileSaveInfo?: { savedToFile: boolean; filepath?: string }
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
                message: "Response saved to file. Read the file to access contents.",
            };
            if (stderr) output.stderr = stderr;
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the filepath (consistent with not requesting metadata)
        return `Response saved to: ${fileSaveInfo.filepath}`;
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

// Token types for jq filter parsing
type JqToken =
    | { type: "key"; value: string }
    | { type: "index"; value: number }
    | { type: "slice"; start?: number; end?: number }
    | { type: "iterate" };

// Parse bracket notation: [], ["key"], [n], [n:m]
function parseBracketToken(filter: string, startIndex: number): { token: JqToken; newIndex: number } {
    let i = startIndex + 1; // skip opening [

    // Check for iterate []
    if (filter[i] === "]") {
        return { token: { type: "iterate" }, newIndex: i + 1 };
    }

    // Check for string key ["key"] with escape sequence handling
    if (filter[i] === '"' || filter[i] === "'") {
        const quote = filter[i];
        i++; // skip opening quote
        let key = "";
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
                break;
            }
            key += ch;
            i++;
        }
        if (i < filter.length && filter[i] === "]") i++; // skip ]
        return { token: { type: "key", value: key }, newIndex: i };
    }

    // Parse number index or slice
    let numStr = "";
    let hasColon = false;
    while (i < filter.length && filter[i] !== "]") {
        if (filter[i] === ":") hasColon = true;
        numStr += filter[i];
        i++;
    }
    i++; // skip ]

    if (hasColon) {
        const parts = numStr.split(":");
        let start: number | undefined;
        if (parts[0]) {
            const parsedStart = parseInt(parts[0], 10);
            if (Number.isNaN(parsedStart)) {
                throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}"`);
            }
            start = parsedStart;
        }
        let end: number | undefined;
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

// Parse a jq-like filter expression into tokens
function parseJqFilter(filter: string): JqToken[] {
    const tokens: JqToken[] = [];
    let i = filter[0] === "." ? 1 : 0; // skip leading dot

    while (i < filter.length) {
        if (filter[i] === ".") {
            i++;
            continue;
        }

        if (filter[i] === "[") {
            const result = parseBracketToken(filter, i);
            tokens.push(result.token);
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
        }
    }

    return tokens;
}

// Apply a jq-like filter to JSON data
function applyJqFilter(jsonString: string, filter: string): string {
    let data: unknown;
    try {
        data = JSON.parse(jsonString);
    } catch {
        const preview = jsonString.slice(0, 200);
        throw new Error(
            `Response is not valid JSON. Cannot apply jq_filter.\nPreview: ${preview}${jsonString.length > 200 ? "..." : ""}`
        );
    }

    const tokens = parseJqFilter(filter);

    for (const token of tokens) {
        if (data === null || data === undefined) {
            return "null";
        }

        switch (token.type) {
            case "key":
                if (typeof data !== "object") {
                    return "null";
                }
                if (data === null) {
                    return "null";
                }
                data = (data as Record<string, unknown>)[token.value];
                break;

            case "index":
                if (Array.isArray(data)) {
                    const idx = token.value < 0 ? data.length + token.value : token.value;
                    data = data[idx];
                } else {
                    return "null";
                }
                break;

            case "slice":
                if (Array.isArray(data)) {
                    data = data.slice(token.start, token.end);
                } else {
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

// Save response content to a temporary file
async function saveResponseToFile(content: string, url: string): Promise<string> {
    const tempDir = await getOrCreateTempDir();

    // Create a safe filename from URL (fall back to raw string if URL is invalid)
    let safeName: string;
    try {
        const urlObj = new URL(url);
        safeName = (urlObj.hostname + urlObj.pathname)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .slice(0, 50);
    } catch {
        safeName = url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50) || "response";
    }
    const filename = `${safeName}_${Date.now()}.txt`;
    const filepath = join(tempDir, filename);

    await writeFile(filepath, content, "utf-8");
    return filepath;
}

// Process response with filtering and size handling
interface ProcessResponseOptions {
    url: string;
    jqFilter?: string;
    maxResultSize?: number;
    saveToFile?: boolean;
    contentType?: string;
}

interface ProcessedResponse {
    content: string;
    savedToFile: boolean;
    filepath?: string;
}

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
                    `Preview: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`
                );
            }
        }
        content = applyJqFilter(content, options.jqFilter);
    }

    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? DEFAULT_MAX_RESULT_SIZE;

    // Step 3: Check if we need to save to file
    const shouldSave = options.saveToFile || content.length > maxSize;

    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url);
        return {
            content: `Response (${content.length} bytes) saved to: ${filepath}`,
            savedToFile: true,
            filepath,
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
        .describe("JSON path filter to extract specific data (e.g., '.data.items[0]', '.users[0:5]'). Applied before size checks."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(4_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
});

type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;

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
  - jq_filter (string): JSON path filter to extract specific data (e.g., ".data.items[0]", ".users[0:5]")
  - max_result_size (number): Max bytes to return inline (default: 500KB). Auto-saves to file when exceeded
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
  - Invalid JSON with jq_filter returns error with response preview`,
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

                const output = formatResponse(
                    processed.content,
                    result.stderr,
                    result.exitCode,
                    params.include_metadata,
                    { savedToFile: processed.savedToFile, filepath: processed.filepath }
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
                const errorMessage = error instanceof Error ? error.message : String(error);
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
| max_result_size | number | No | 500KB | Max bytes inline before auto-save to file |
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
        await new Promise<void>((resolve, reject) => {
            httpServer!.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Close all active sessions
    for (const [sessionId, session] of sessions) {
        try {
            session.transport.close();
            await session.server.close();
        } catch {
            // Ignore errors during shutdown
        }
        sessions.delete(sessionId);
    }

    // Clean up temp directory
    if (sharedTempDir) {
        try {
            await rm(sharedTempDir, { recursive: true, force: true });
        } catch {
            // Ignore errors during cleanup
        }
    }

    process.exit(0);
}

// Register shutdown handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Run with stdio transport (default)
async function runStdio(): Promise<void> {
    const server = createServer();
    registerToolsAndResources(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("cURL MCP server running on stdio");
}

// Run with HTTP transport
async function runHTTP(): Promise<void> {
    const app = express();
    app.use(express.json());

    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req: Request, res: Response) => {
        try {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;

            // Check for existing session
            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId)!;
                await session.transport.handleRequest(req, res, req.body);
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
                sessions.set(transport.sessionId, {server, transport});
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
            const sessionId = req.headers["mcp-session-id"] as string;
            if (!sessionId || !sessions.has(sessionId)) {
                res.status(400).json({error: "Invalid or missing session ID"});
                return;
            }
            const session = sessions.get(sessionId)!;
            await session.transport.handleRequest(req, res);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.headers["mcp-session-id"] as string;
        if (sessionId && sessions.has(sessionId)) {
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
