import {
  CURL_EXECUTE_TOOL_META,
  ENV,
  JqQuerySchema,
  LIMITS,
  SERVER,
  SESSION,
  applyDefaultHeaders,
  applyJqFilter,
  cleanupOrphanedTempDirs,
  cleanupTempDir,
  createSafeFilenameBase,
  executeCurlRequest,
  getErrorMessage,
  getOrCreateTempDir,
  isValidSessionId,
  parsePort,
  registerCurlExecuteTool,
  resolveBaseUrl,
  resolveOutputDir,
  safeStringCompare,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  validateFilePath,
  validateOutputDir
} from "./chunk-FBAV2EBE.js";

// src/lib/server/lifecycle.ts
var httpServer = null;
var sessionManager = null;
var rateLimitCleanupInterval = null;
function initializeLifecycle(sessions, rateLimitInterval) {
  sessionManager = sessions;
  rateLimitCleanupInterval = rateLimitInterval;
}
function setHttpServer(server) {
  httpServer = server;
}
async function shutdown(signal) {
  console.error(`
Received ${signal}, shutting down gracefully...`);
  let hasError = false;
  if (httpServer) {
    try {
      await new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (error) {
      console.error("Warning: Error closing HTTP server:", error);
      hasError = true;
    }
  }
  if (sessionManager) {
    sessionManager.stopCleanup();
    try {
      await sessionManager.closeAll();
    } catch (error) {
      console.error("Warning: Error closing sessions:", error);
      hasError = true;
    }
  }
  if (rateLimitCleanupInterval) {
    stopRateLimitCleanup(rateLimitCleanupInterval);
  }
  await cleanupTempDir();
  process.exit(hasError ? 1 : 0);
}
function registerShutdownHandlers() {
  process.on("SIGINT", () => {
    void shutdown("SIGINT").catch((error) => {
      console.error("Warning: Shutdown failed:", error);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").catch((error) => {
      console.error("Warning: Shutdown failed:", error);
      process.exit(1);
    });
  });
}

// src/lib/server/server-factory.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
function createServer() {
  return new McpServer({
    name: SERVER.NAME,
    version: SERVER.VERSION
  });
}

// src/lib/tools/jq-query.ts
import { readFile, writeFile } from "fs/promises";
import { join, basename } from "path";
var JQ_QUERY_TOOL_META = {
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
    openWorldHint: false
  }
};
async function executeJqQuery(params, _extra) {
  try {
    const validatedFilePath = await validateFilePath(params.filepath);
    const resolvedOutputDir = resolveOutputDir(params.output_dir);
    const validatedOutputDir = resolvedOutputDir ? await validateOutputDir(resolvedOutputDir) : void 0;
    const content = await readFile(validatedFilePath, { encoding: "utf-8" });
    const filtered = applyJqFilter(content, params.jq_filter);
    const maxSize = params.max_result_size ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(filtered, "utf8");
    const shouldSave = params.save_to_file || contentBytes > maxSize;
    if (shouldSave) {
      const sourceBasename = basename(validatedFilePath) || "query_result";
      const safeName = createSafeFilenameBase(sourceBasename, "query_result");
      const filename = `${safeName}_${Date.now()}.txt`;
      const targetDir = validatedOutputDir ?? await getOrCreateTempDir();
      const filepath = join(targetDir, filename);
      await writeFile(filepath, filtered, { encoding: "utf-8", mode: 384 });
      return {
        content: [
          {
            type: "text",
            text: `Result (${contentBytes} bytes) saved to: ${filepath}`
          }
        ]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: filtered
        }
      ]
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const errorClass = error instanceof Error ? error.constructor.name : "Error";
    console.error(`jq_query error: [${basename(params.filepath)}] ${errorClass}`);
    return {
      content: [
        {
          type: "text",
          text: `Error querying JSON file: ${errorMessage}`
        }
      ],
      isError: true
    };
  }
}
function registerJqQueryTool(server) {
  server.registerTool(
    "jq_query",
    JQ_QUERY_TOOL_META,
    async (params, extra) => executeJqQuery(params, extra)
  );
}

// src/lib/resources/documentation.ts
function registerDocumentationResource(server) {
  server.registerResource(
    "documentation",
    "curl://docs/api",
    {
      title: "cURL MCP Server Documentation",
      description: "API documentation and usage examples for the cURL MCP server",
      mimeType: "text/markdown"
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
- Per-client: 300 requests/minute total (HTTP: per session; stdio: shared single bucket)

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
`
      }]
    })
  );
}

// src/lib/resources/index.ts
function registerAllResources(server) {
  registerDocumentationResource(server);
}

// src/lib/prompts/api-test.ts
import { z } from "zod";
var apiTestUrlSchema = z.url().refine(
  (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
  { message: "URL must use http or https scheme" }
).describe("The API endpoint URL to test");
function registerApiTestPrompt(server) {
  server.registerPrompt(
    "api-test",
    {
      title: "API Testing",
      description: "Test an API endpoint and analyze the response",
      argsSchema: {
        url: apiTestUrlSchema,
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional().describe("HTTP method (default: GET)"),
        description: z.string().optional().describe("What this API endpoint does")
      }
    },
    ({ url, method = "GET", description }) => ({
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
4. Summarize what the response contains`
        }
      }]
    })
  );
}

// src/lib/prompts/api-discovery.ts
import { z as z2 } from "zod";
var apiDiscoveryBaseUrlSchema = z2.url().refine(
  (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
  { message: "Base URL must use http or https scheme" }
).describe("Base URL of the API");
function registerApiDiscoveryPrompt(server) {
  server.registerPrompt(
    "api-discovery",
    {
      title: "REST API Discovery",
      description: "Explore a REST API to discover available endpoints",
      argsSchema: {
        base_url: apiDiscoveryBaseUrlSchema,
        auth_token: z2.string().optional().describe("Optional bearer token for authentication")
      }
    },
    ({ base_url, auth_token }) => ({
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
4. Report what you discover about the API structure`
        }
      }]
    })
  );
}

// src/lib/prompts/index.ts
function registerAllPrompts(server) {
  registerApiTestPrompt(server);
  registerApiDiscoveryPrompt(server);
}

// src/lib/extensible/instance-utilities.ts
function createInstanceUtilities(config) {
  return {
    async executeRequest(params) {
      let url = params.url;
      if (!url && params.path && config.baseUrl) {
        url = resolveBaseUrl(config.baseUrl, params.path);
      }
      if (!url) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Must provide url or path (with baseUrl configured)"
            }
          ],
          isError: true
        };
      }
      const mergedHeaders = { ...config.defaultHeaders, ...params.headers };
      const defaults = applyDefaultHeaders(mergedHeaders, params.user_agent, config);
      const fullParams = {
        url,
        method: params.method,
        headers: defaults.headers,
        data: params.data,
        form: params.form,
        follow_redirects: params.follow_redirects ?? true,
        max_redirects: params.max_redirects,
        insecure: params.insecure ?? false,
        timeout: params.timeout ?? config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1e3,
        user_agent: defaults.userAgent,
        basic_auth: params.basic_auth,
        bearer_token: params.bearer_token,
        verbose: params.verbose ?? false,
        include_headers: params.include_headers ?? false,
        compressed: params.compressed ?? true,
        include_metadata: params.include_metadata ?? false,
        jq_filter: params.jq_filter,
        max_result_size: params.max_result_size ?? config.maxResultSize,
        save_to_file: params.save_to_file,
        output_dir: params.output_dir ?? config.outputDir
      };
      return executeCurlRequest(fullParams, { allowLocalhost: config.allowLocalhost });
    },
    async queryFile(filepath, jqFilter) {
      const params = {
        filepath,
        jq_filter: jqFilter,
        max_result_size: config.maxResultSize,
        output_dir: config.outputDir
      };
      return executeJqQuery(params, {});
    }
  };
}

// src/lib/transports/http.ts
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";

// src/lib/session/session-manager.ts
var SessionManager = class {
  /**
   * Create a new session manager with optional custom max sessions.
   * @param maxSessions - Maximum number of concurrent sessions (default: SESSION.MAX_SESSIONS)
   * @throws Error if maxSessions is not a positive integer
   */
  constructor(maxSessions = SESSION.MAX_SESSIONS) {
    this.maxSessions = maxSessions;
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new Error(`maxSessions must be a positive integer, got: ${maxSessions}`);
    }
  }
  sessions = /* @__PURE__ */ new Map();
  cleanupInterval = null;
  /**
   * Check if a session exists.
   */
  has(id) {
    return this.sessions.has(id);
  }
  /**
   * Get a session by ID.
   */
  get(id) {
    return this.sessions.get(id);
  }
  /**
   * Store a session.
   * @throws Error if session limit is reached
   */
  set(id, session) {
    if (!this.sessions.has(id) && this.sessions.size >= this.maxSessions) {
      throw new Error(`Session limit reached (max: ${this.maxSessions})`);
    }
    this.sessions.set(id, session);
  }
  /**
   * Delete a session.
   */
  delete(id) {
    this.sessions.delete(id);
  }
  /**
   * Get the number of active sessions.
   */
  get size() {
    return this.sessions.size;
  }
  /**
   * Iterate over all sessions.
   */
  entries() {
    return this.sessions.entries();
  }
  /**
   * Start periodic cleanup of idle sessions.
   * Sessions that exceed SESSION.IDLE_TIMEOUT_MS without activity are closed.
   */
  startCleanup() {
    if (this.cleanupInterval) {
      return;
    }
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.lastActivity > SESSION.IDLE_TIMEOUT_MS) {
          try {
            session.transport.close();
          } catch (error) {
            console.error(`Warning: Error closing idle session ${id} transport:`, error);
          }
          void session.server.close().catch((error) => {
            console.error(`Warning: Error closing idle session ${id} server:`, error);
          });
          this.sessions.delete(id);
        }
      }
    }, SESSION.CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }
  /**
   * Stop the cleanup interval.
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  /**
   * Close all active sessions gracefully.
   * Used during server shutdown.
   */
  async closeAll() {
    for (const [sessionId, session] of this.sessions) {
      try {
        session.transport.close();
      } catch (error) {
        console.error(`Warning: Error closing session ${sessionId} transport:`, error);
      }
      try {
        await session.server.close();
      } catch (error) {
        console.error(`Warning: Error closing session ${sessionId} server:`, error);
      }
      this.sessions.delete(sessionId);
    }
  }
};

// src/lib/tools/index.ts
function registerAllTools(server) {
  registerCurlExecuteTool(server);
  registerJqQueryTool(server);
}

// src/lib/server/registration.ts
function registerAllCapabilities(server) {
  registerAllTools(server);
  registerAllResources(server);
  registerAllPrompts(server);
}

// src/lib/extensible/mcp-curl-server.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/lib/extensible/hook-executor.ts
async function executeWithHooks(tool, params, config, hooks, sessionId, executor) {
  const ctx = {
    tool,
    params: { ...params },
    sessionId,
    config
  };
  for (const hook of hooks.beforeRequest) {
    const result = await hook(ctx);
    if (result) {
      if ("shortCircuit" in result && result.shortCircuit) {
        return {
          content: [{ type: "text", text: result.response }],
          isError: result.isError
        };
      }
      if ("params" in result && result.params) {
        ctx.params = { ...ctx.params, ...result.params };
      }
    }
  }
  try {
    const response = await executor(ctx.params, { sessionId, allowLocalhost: config.allowLocalhost });
    const responseText = response.content[0].text;
    for (const hook of hooks.afterResponse) {
      await hook({
        ...ctx,
        response: responseText,
        isError: !!response.isError
      });
    }
    return response;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    for (const hook of hooks.onError) {
      try {
        await hook({
          ...ctx,
          error: normalizedError
        });
      } catch (hookError) {
        const hookErrorName = hookError instanceof Error ? hookError.name : "UnknownError";
        console.error(`Warning: onError hook threw (${hookErrorName}) [suppressed to preserve original error]`);
      }
    }
    throw error;
  }
}

// src/lib/extensible/tool-wrapper.ts
function applySharedConfigDefaults(params, config) {
  if (config.outputDir && !params.output_dir) {
    params.output_dir = config.outputDir;
  }
  if (config.maxResultSize && !params.max_result_size) {
    params.max_result_size = config.maxResultSize;
  }
}
function applyConfigTransformsCurl(params, config) {
  const transformed = { ...params };
  if (config.baseUrl && !params.url.match(/^https?:\/\//i)) {
    transformed.url = resolveBaseUrl(config.baseUrl, params.url);
  }
  const mergedHeaders = { ...config.defaultHeaders, ...params.headers };
  const defaults = applyDefaultHeaders(mergedHeaders, transformed.user_agent, config);
  transformed.headers = defaults.headers;
  if (defaults.userAgent !== void 0) transformed.user_agent = defaults.userAgent;
  if (params.timeout === void 0) {
    transformed.timeout = config.defaultTimeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1e3;
  }
  applySharedConfigDefaults(transformed, config);
  return transformed;
}
function applyConfigTransformsJq(params, config) {
  const transformed = { ...params };
  applySharedConfigDefaults(transformed, config);
  return transformed;
}
function registerCurlToolWithHooks(server, options) {
  const { executor, enabled, config, hooks } = options;
  server.registerTool(
    "curl_execute",
    CURL_EXECUTE_TOOL_META,
    ((params, extra) => {
      if (!enabled) {
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: "Error: curl_execute tool is disabled"
            }
          ],
          isError: true
        });
      }
      const transformedParams = applyConfigTransformsCurl(params, config);
      return executeWithHooks(
        "curl_execute",
        transformedParams,
        config,
        hooks,
        extra?.sessionId,
        executor
      );
    })
  );
}
function registerJqToolWithHooks(server, options) {
  const { executor, enabled, config, hooks } = options;
  server.registerTool(
    "jq_query",
    JQ_QUERY_TOOL_META,
    ((params, extra) => {
      if (!enabled) {
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: "Error: jq_query tool is disabled"
            }
          ],
          isError: true
        });
      }
      const transformedParams = applyConfigTransformsJq(params, config);
      return executeWithHooks(
        "jq_query",
        transformedParams,
        config,
        hooks,
        extra?.sessionId,
        executor
      );
    })
  );
}

// src/lib/extensible/mcp-curl-server.ts
var KNOWN_CONFIG_KEYS_ARRAY = [
  "baseUrl",
  "defaultHeaders",
  "defaultTimeout",
  "outputDir",
  "maxResultSize",
  "allowLocalhost",
  "port",
  "host",
  "authToken",
  "allowedOrigins",
  "defaultUserAgent",
  "defaultReferer"
];
var KNOWN_CONFIG_KEYS = new Set(KNOWN_CONFIG_KEYS_ARRAY);
var McpCurlServer = class {
  _config = {};
  _frozenConfig = null;
  _hooks = {
    beforeRequest: [],
    afterResponse: [],
    onError: []
  };
  _tools = {
    curl_execute: true,
    jq_query: true
  };
  _customTools = [];
  _started = false;
  _server = null;
  _httpServer = null;
  _sessionManager = null;
  _rateLimitInterval = null;
  _utilities = null;
  /**
   * Configure server options.
   * Must be called before start().
   *
   * @param config - Configuration options to merge
   * @returns this for chaining
   * @throws Error if called after start()
   */
  configure(config) {
    this.ensureNotStarted("configure()");
    const picked = {};
    const knownKeysList = KNOWN_CONFIG_KEYS_ARRAY.join(", ");
    for (const key of Object.keys(config)) {
      if (KNOWN_CONFIG_KEYS.has(key)) {
        picked[key] = config[key];
      } else {
        console.warn(
          `McpCurlServer.configure(): unknown config key "${key}" ignored. Known keys: ${knownKeysList}`
        );
      }
    }
    this._config = { ...this._config, ...picked };
    return this;
  }
  /**
   * Disable the curl_execute tool.
   * When disabled, calls to curl_execute return an error.
   *
   * @returns this for chaining
   * @throws Error if called after start()
   */
  disableCurlExecute() {
    this.ensureNotStarted("disableCurlExecute()");
    this._tools.curl_execute = false;
    return this;
  }
  /**
   * Disable the jq_query tool.
   * When disabled, calls to jq_query return an error.
   *
   * @returns this for chaining
   * @throws Error if called after start()
   */
  disableJqQuery() {
    this.ensureNotStarted("disableJqQuery()");
    this._tools.jq_query = false;
    return this;
  }
  /**
   * Register a beforeRequest hook.
   * Hooks run sequentially in registration order before tool execution.
   * Can modify params or short-circuit to return early.
   *
   * @param hook - Hook function
   * @returns this for chaining
   * @throws Error if called after start()
   */
  beforeRequest(hook) {
    this.ensureNotStarted("beforeRequest()");
    this._hooks.beforeRequest.push(hook);
    return this;
  }
  /**
   * Register an afterResponse hook.
   * Hooks run sequentially after successful tool execution.
   * Useful for logging, metrics, caching.
   *
   * @param hook - Hook function
   * @returns this for chaining
   * @throws Error if called after start()
   */
  afterResponse(hook) {
    this.ensureNotStarted("afterResponse()");
    this._hooks.afterResponse.push(hook);
    return this;
  }
  /**
   * Register an onError hook.
   * Hooks run sequentially when tool execution throws.
   * Useful for error logging and reporting.
   *
   * @param hook - Hook function
   * @returns this for chaining
   * @throws Error if called after start()
   */
  onError(hook) {
    this.ensureNotStarted("onError()");
    this._hooks.onError.push(hook);
    return this;
  }
  /**
   * Register a custom tool.
   * Custom tools are registered on the MCP server during start().
   * Use this to add API-specific tools generated from schema definitions.
   *
   * Note: Custom tools are NOT wrapped with beforeRequest/afterResponse/onError hooks.
   * They are registered directly on the MCP server. If you need hook-like behavior,
   * implement it within the handler function itself.
   *
   * @param name - Tool name (must match /^[a-z][a-z0-9_]*$/)
   * @param meta - Tool metadata (title, description, inputSchema)
   * @param handler - Tool handler function
   * @returns this for chaining
   * @throws Error if called after start()
   * @throws Error if tool name conflicts with built-in tools
   * @throws Error if tool name format is invalid
   *
   * @example
   * ```typescript
   * server.registerCustomTool(
   *   "get_user",
   *   {
   *     title: "Get User",
   *     description: "Fetch user by ID",
   *     inputSchema: z.object({ id: z.string() }),
   *   },
   *   async (params) => {
   *     // Handle request
   *     return { content: [{ type: "text", text: "..." }] };
   *   }
   * );
   * ```
   */
  registerCustomTool(name, meta, handler) {
    this.ensureNotStarted("registerCustomTool()");
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(
        `Invalid tool name "${name}": must start with a lowercase letter and contain only lowercase letters, digits, and underscores.`
      );
    }
    if (name === "curl_execute" || name === "jq_query") {
      throw new Error(
        `Cannot register custom tool "${name}": built-in tool names are reserved and cannot be overridden, even if disabled.`
      );
    }
    if (this._customTools.some((t) => t.name === name)) {
      throw new Error(`Custom tool "${name}" is already registered`);
    }
    this._customTools.push({ name, meta, handler });
    return this;
  }
  /**
   * Get the current (frozen after start) configuration.
   * Returns a deep-frozen snapshot to prevent mutation of nested objects.
   *
   * @returns Readonly configuration object
   */
  getConfig() {
    if (this._frozenConfig) return this._frozenConfig;
    return this.freezeConfig();
  }
  /**
   * Get config-aware utility methods for direct tool execution.
   * Utilities apply configuration defaults automatically.
   *
   * @returns Instance utilities object
   */
  utilities() {
    if (!this._frozenConfig) {
      return createInstanceUtilities(this.getConfig());
    }
    if (!this._utilities) {
      this._utilities = createInstanceUtilities(this._frozenConfig);
    }
    return this._utilities;
  }
  /**
   * Get the underlying MCP server instance.
   * Returns null if not yet started.
   *
   * @returns MCP server or null
   */
  getMcpServer() {
    return this._server;
  }
  /**
   * Check if the server has been started.
   *
   * @returns true if started
   */
  isStarted() {
    return this._started;
  }
  /**
   * Start the server with the specified transport.
   * Configuration is frozen after this call.
   *
   * @param transport - Transport mode: "stdio" (default) or "http"
   * @throws Error if already started
   */
  async start(transport = "stdio") {
    if (this._started) {
      throw new Error("Server is already running. Call shutdown() before starting again.");
    }
    this._started = true;
    this._frozenConfig = this.freezeConfig();
    try {
      await cleanupOrphanedTempDirs();
      this._rateLimitInterval = startRateLimitCleanup();
      this._server = this.createConfiguredServer();
      if (transport === "http") {
        await this.startHttp();
      } else {
        await this.startStdio();
      }
    } catch (error) {
      if (this._httpServer) {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve(), 5e3);
            this._httpServer.close((err) => {
              clearTimeout(timeout);
              if (err) reject(err);
              else resolve();
            });
          });
        } catch {
        }
        this._httpServer = null;
      }
      if (this._sessionManager) {
        this._sessionManager.stopCleanup();
        this._sessionManager = null;
      }
      if (this._rateLimitInterval) {
        stopRateLimitCleanup(this._rateLimitInterval);
        this._rateLimitInterval = null;
      }
      this._server = null;
      this._started = false;
      this._frozenConfig = null;
      this._utilities = null;
      throw error;
    }
  }
  /**
   * Gracefully shutdown the server.
   * Closes all connections and cleans up resources.
   * Safe to call even if server was never started.
   */
  async shutdown() {
    if (!this._started) {
      return;
    }
    console.error("Shutting down McpCurlServer...");
    if (this._httpServer) {
      const SHUTDOWN_TIMEOUT = 5e3;
      let timeoutId;
      try {
        await Promise.race([
          new Promise((resolve, reject) => {
            this._httpServer.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("HTTP server shutdown timeout")),
              SHUTDOWN_TIMEOUT
            );
          })
        ]);
      } catch (error) {
        console.error("Warning: Error closing HTTP server:", error);
      } finally {
        if (timeoutId !== void 0) {
          clearTimeout(timeoutId);
        }
        this._httpServer = null;
      }
    }
    if (this._sessionManager) {
      this._sessionManager.stopCleanup();
      try {
        await this._sessionManager.closeAll();
      } catch (error) {
        console.error("Warning: Error closing sessions:", error);
      }
    }
    if (this._server) {
      try {
        await this._server.close();
      } catch (error) {
        console.error("Warning: Error closing MCP server:", error);
      } finally {
        this._server = null;
      }
    }
    if (this._rateLimitInterval) {
      stopRateLimitCleanup(this._rateLimitInterval);
    }
    try {
      await cleanupTempDir();
    } catch (error) {
      console.error("Warning: Error cleaning up temp directory:", error);
    } finally {
      this._started = false;
      this._frozenConfig = null;
      this._utilities = null;
      this._rateLimitInterval = null;
      this._sessionManager = null;
    }
  }
  /**
   * Create a fully configured MCP server instance.
   * Registers resources, prompts, and tools with hooks applied.
   * Used by both main server initialization and HTTP session creation.
   *
   * @returns Configured McpServer instance
   */
  createConfiguredServer() {
    const server = createServer();
    registerAllResources(server);
    registerAllPrompts(server);
    this.registerToolsOnServer(server);
    return server;
  }
  /**
   * Register tools with hooks applied on a given server.
   *
   * @param server - MCP server to register tools on
   */
  registerToolsOnServer(server) {
    const config = this._frozenConfig;
    registerCurlToolWithHooks(server, {
      executor: executeCurlRequest,
      enabled: this._tools.curl_execute,
      config,
      hooks: this._hooks
    });
    registerJqToolWithHooks(server, {
      executor: executeJqQuery,
      enabled: this._tools.jq_query,
      config,
      hooks: this._hooks
    });
    for (const { name, meta, handler } of this._customTools) {
      server.registerTool(name, meta, handler);
    }
  }
  /**
   * Start stdio transport.
   */
  async startStdio() {
    const transport = new StdioServerTransport();
    await this._server.connect(transport);
    console.error("cURL MCP server running on stdio");
  }
  /**
   * Start HTTP transport with session management.
   * Delegates to shared createHttpApp() for route setup, auth, and Origin validation.
   */
  async startHttp() {
    this._sessionManager = new SessionManager();
    this._sessionManager.startCleanup();
    const app = createHttpApp({
      createMcpServer: () => this.createConfiguredServer(),
      sessionManager: this._sessionManager,
      authToken: this._frozenConfig.authToken ?? process.env[ENV.AUTH_TOKEN],
      allowedOrigins: this._frozenConfig.allowedOrigins
    });
    const port = this._frozenConfig.port ?? parsePort(process.env[ENV.PORT], LIMITS.DEFAULT_HTTP_PORT);
    const host = resolveHost(this._frozenConfig.host);
    return new Promise((resolve, reject) => {
      this._httpServer = app.listen(port, host);
      this._httpServer.on("listening", () => {
        console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
        resolve();
      });
      this._httpServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
  }
  /**
   * Deep-freeze the current config to prevent mutation of nested objects.
   */
  freezeConfig() {
    return Object.freeze({
      ...this._config,
      defaultHeaders: this._config.defaultHeaders ? Object.freeze({ ...this._config.defaultHeaders }) : void 0,
      allowedOrigins: this._config.allowedOrigins ? Object.freeze([...this._config.allowedOrigins]) : void 0
    });
  }
  /**
   * Ensure server has not been started.
   * @throws Error if started
   */
  ensureNotStarted(method) {
    if (this._started) {
      throw new Error(`Cannot call ${method} after server has started`);
    }
  }
};

// src/lib/transports/http.ts
var DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/
];
var DEFAULT_HOST = "127.0.0.1";
function createOriginMiddleware(allowedOrigins) {
  const explicitOrigins = allowedOrigins ? [...allowedOrigins] : parseAllowedOriginsEnv();
  const useExplicitList = explicitOrigins !== null;
  const allowedOriginSet = useExplicitList ? new Set(explicitOrigins.map((o) => o.toLowerCase())) : null;
  return (req, res, next) => {
    const rawOrigin = req.headers.origin;
    if (!rawOrigin) {
      next();
      return;
    }
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (!origin) {
      next();
      return;
    }
    if (useExplicitList) {
      if (allowedOriginSet.has(origin.toLowerCase())) {
        next();
        return;
      }
    } else {
      if (DEFAULT_ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
        next();
        return;
      }
    }
    res.status(403).json({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Forbidden: Origin not allowed"
      }
    });
  };
}
function parseAllowedOriginsEnv() {
  const envValue = process.env[ENV.ALLOWED_ORIGINS];
  if (!envValue) return null;
  return envValue.split(",").map((o) => o.trim()).filter(Boolean);
}
function createAuthMiddleware(authToken) {
  return (req, res, next) => {
    if (!authToken) {
      next();
      return;
    }
    const authHeader = req.headers.authorization;
    const expectedHeader = `Bearer ${authToken}`;
    if (!authHeader || !safeStringCompare(authHeader, expectedHeader)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Unauthorized: Invalid or missing authentication token"
        }
      });
      return;
    }
    next();
  };
}
function createHttpApp(options) {
  const { createMcpServer, sessionManager: sessionManager2, authToken, allowedOrigins } = options;
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const originMiddleware = createOriginMiddleware(allowedOrigins);
  app.use("/mcp", originMiddleware);
  const authMiddleware = createAuthMiddleware(authToken);
  app.use("/mcp", authMiddleware);
  app.post("/mcp", async (req, res) => {
    try {
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (sessionId && !isValidSessionId(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid session ID format" }
        });
        return;
      }
      if (sessionId && sessionManager2.has(sessionId)) {
        const session = sessionManager2.get(sessionId);
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (sessionManager2.size >= SESSION.MAX_SESSIONS) {
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Server at capacity. Try again later." }
        });
        return;
      }
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessionManager2.has(sid)) {
          sessionManager2.delete(sid);
        }
      };
      await server.connect(transport);
      if (transport.sessionId) {
        sessionManager2.set(transport.sessionId, {
          server,
          transport,
          lastActivity: Date.now()
        });
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" }
        });
      }
    }
  });
  app.get("/mcp", async (req, res, next) => {
    try {
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!isValidSessionId(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid or missing session ID" }
        });
        return;
      }
      if (!sessionManager2.has(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Session not found" }
        });
        return;
      }
      const session = sessionManager2.get(sessionId);
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/mcp", async (req, res, next) => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (sessionId && !isValidSessionId(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid session ID format" }
      });
      return;
    }
    if (sessionId && sessionManager2.has(sessionId)) {
      const session = sessionManager2.get(sessionId);
      try {
        session.transport.close();
        await session.server.close();
      } catch (error) {
        next(error);
        return;
      } finally {
        sessionManager2.delete(sessionId);
      }
    }
    res.status(200).end();
  });
  app.use((err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" }
      });
    }
  });
  return app;
}
function formatHostForUrl(host) {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}
function resolveHost(configHost) {
  return configHost ?? process.env[ENV.HOST] ?? DEFAULT_HOST;
}
async function runHTTP() {
  await cleanupOrphanedTempDirs();
  const sessionManager2 = new SessionManager();
  sessionManager2.startCleanup();
  const rateLimitInterval = startRateLimitCleanup();
  initializeLifecycle(sessionManager2, rateLimitInterval);
  const app = createHttpApp({
    createMcpServer: () => {
      const server = createServer();
      registerAllCapabilities(server);
      return server;
    },
    sessionManager: sessionManager2,
    authToken: process.env[ENV.AUTH_TOKEN]
  });
  const port = parsePort(process.env.PORT, LIMITS.DEFAULT_HTTP_PORT);
  const host = resolveHost();
  const httpServer2 = app.listen(port, host);
  httpServer2.on("listening", () => {
    console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
  });
  httpServer2.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Error: Port ${port} is already in use`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });
  setHttpServer(httpServer2);
}

export {
  initializeLifecycle,
  registerShutdownHandlers,
  createServer,
  executeJqQuery,
  registerAllResources,
  registerAllPrompts,
  registerAllCapabilities,
  createInstanceUtilities,
  runHTTP,
  McpCurlServer
};
