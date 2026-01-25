#!/usr/bin/env node
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, {Request, Response, NextFunction} from "express";
import {Server} from "http";
import {z} from "zod";
import {spawn, ChildProcess} from "child_process";
import {randomUUID} from "crypto";

// Constants
const MAX_RESPONSE_SIZE = 2_000_000; // 2MB max response
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const SERVER_NAME = "curl-mcp-server";
const SERVER_VERSION = "1.0.0";

// Session tracking for HTTP transport
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

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

    // Output format for response info
    if (params.output_format) {
        args.push("-w", params.output_format);
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
    includeMetadata: boolean
): string {
    if (includeMetadata) {
        const output: Record<string, unknown> = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        if (stderr) {
            output.stderr = stderr;
        }
        return JSON.stringify(output, null, 2);
    }
    return stdout;
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

Returns:
  The HTTP response body, or JSON with metadata if include_metadata is true:
  {
    "success": boolean,
    "exit_code": number,
    "response": string,
    "stderr": string (if present)
  }

Examples:
  - Simple GET: { "url": "https://api.example.com/data" }
  - POST JSON: { "url": "https://api.example.com/users", "method": "POST", "headers": {"Content-Type": "application/json"}, "data": "{\\"name\\": \\"John\\"}" }
  - With auth: { "url": "https://api.example.com/secure", "bearer_token": "your-token-here" }

Error Handling:
  - Returns error message if cURL fails or times out
  - Exit code 0 indicates success
  - Non-zero exit codes indicate various cURL errors`,
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
                const output = formatResponse(
                    result.stdout,
                    result.stderr,
                    result.exitCode,
                    params.include_metadata
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

**Authenticated request:**
\`\`\`json
{
  "url": "https://api.example.com/protected",
  "bearer_token": "your-access-token"
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
