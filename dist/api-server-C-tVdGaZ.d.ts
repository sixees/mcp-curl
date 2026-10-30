import { ToolCallback, McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { C as CurlExecuteInput, J as JqQueryInput, s as CurlExecuteResult, G as GeneratorConfig, f as ApiSchema } from './generator-jrGWR0DG.js';

/**
 * An embedder-configured per-host limit: at most `max` requests to one host in
 * any `windowMs` span. Enforced as a sliding log, so it cannot be reset by the
 * fixed window's boundary or by the cleanup sweep.
 */
interface HostRateLimit {
    /** Requests admitted per host in any one window (positive integer) */
    readonly max: number;
    /** Window length in milliseconds (positive integer) */
    readonly windowMs: number;
    /**
     * Tighten the per-host count from the upstream's own figure. `remaining`
     * names a response header carrying the requests the upstream will still
     * admit in its window; after each response, the host that answered is
     * counted as having used at least `max − remaining`. It only ever tightens,
     * and an absent, empty or malformed value changes nothing.
     *
     * The name must be an HTTP field name (RFC 9110 token) without `%`. Reading
     * the header needs cURL 7.84 or later.
     */
    readonly syncFromHeaders?: {
        readonly remaining: string;
    };
}

/**
 * Configuration options for McpCurlServer.
 * These settings affect how all tool calls are processed.
 */
interface McpCurlConfig {
    /**
     * Base URL that a `url` starting with a single `/` is resolved against, in
     * `curl_execute` and `utilities().executeRequest`. An absolute URL passes
     * through unchanged: resolving against this URL does not limit hosts. But
     * with `allowedHosts` unset, the host list defaults to this URL's host alone,
     * so setting `baseUrl` refuses absolute URLs to any other host.
     */
    baseUrl?: string;
    /** Default headers for `curl_execute` and `utilities().executeRequest`; a request's own header of the same name wins */
    defaultHeaders?: Record<string, string>;
    /** Default timeout in seconds (1-300) for curl_execute */
    defaultTimeout?: number;
    /** Default output directory for saved responses */
    outputDir?: string;
    /** Default max result size in bytes before auto-saving to file */
    maxResultSize?: number;
    /** Allow localhost requests (overrides MCP_CURL_ALLOW_LOCALHOST env) */
    allowLocalhost?: boolean;
    /** HTTP transport port (default: 3000) */
    port?: number;
    /** HTTP transport bind address (default: "127.0.0.1") */
    host?: string;
    /** HTTP auth token (overrides MCP_AUTH_TOKEN env) */
    authToken?: string;
    /** Allowed origins for HTTP transport Origin header validation (default: localhost) */
    allowedOrigins?: readonly string[];
    /**
     * The hosts a request may go to, matched exactly, case-insensitively, with
     * trailing dots ignored. Entries are bare host names or IP literals (IPv6 in
     * brackets): no scheme, port, path, userinfo or wildcard, or `configure()`
     * throws. `"any"` allows every host; `[]` refuses every request.
     *
     * Unset, a server with a `baseUrl` may reach only the `baseUrl` host, and
     * `start()` throws if the `baseUrl` cannot give one; a server without a
     * `baseUrl` may reach any host. The list is checked against the request
     * URL's host before DNS, so a refused host is never resolved or contacted,
     * and again on every followed redirect hop's host. The SSRF gate applies on
     * top of this list either way.
     */
    allowedHosts?: readonly string[] | "any";
    /** Default User-Agent for all requests. Empty string disables. */
    defaultUserAgent?: string;
    /** Default Referer for all requests. Empty string disables. */
    defaultReferer?: string;
    /**
     * Per-host limit as a sliding window: at most `max` requests to any one
     * host in any `windowMs` span. Unset, each host gets the fixed default of
     * 60 per minute. `max` and `windowMs` must be positive integers, or
     * `configure()` throws. The per-client limit is not affected.
     *
     * Applied process-wide by `start()` and released only by this server's
     * `shutdown()` or failed `start()`, so it also counts `utilities()` calls,
     * YAML endpoint tools and any other server in the process. While one server
     * holds it, another's `start()` with a `rateLimit` throws. It is local
     * throttling, not quota accounting: the count starts again with the
     * process, and requests made elsewhere on the same credential are not seen
     * unless `syncFromHeaders` names the header carrying the upstream's own
     * remaining count.
     */
    rateLimit?: HostRateLimit;
    /**
     * Text appended to the built-in `curl_execute` description, after its
     * version line — for what the model needs to know about the API this server
     * fronts: path prefixes, body shapes, pagination, which status means quota.
     * Trusted config: `configure()` replaces each run of Unicode attack
     * codepoints with a space, trims, and throws if the result exceeds `MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH`; it is
     * never truncated. Keep it short — it is sent on every turn of every session.
     */
    curlExecuteDescriptionAppend?: string;
    /**
     * Wrap responses in per-request sentinel tags to resist prompt injection
     * (spotlighting). Independent of the always-on defence pass — see the
     * **defence-in-depth wrap** below.
     *
     * **Defence-in-depth wrap.** Every tool result returned by this
     * server — `curl_execute`, `jq_query`, YAML-driven endpoints registered
     * via `createApiServer()`, custom tools registered via
     * `registerCustomTool()`, and synthesised results returned by a
     * `beforeRequest` short-circuit hook — is routed through a single
     * post-processor wrap (`src/lib/response/post-processor.ts`). The wrap
     * runs the full response-side defence pipeline on each text content part,
     * under the strictest grammar (this boundary's content type is always
     * undetermined), then optionally spotlights the result:
     *
     *   1. **Detect** injection patterns against the **original** text and its
     *      sanitised form, and emit a throttled `[injection-defense]` log
     *      line per hostname. A JSON part is also tested on each escaped
     *      string token, decoded on its own.
     *   2. **Sanitise** the text (strip Unicode attack chars, collapse
     *      whitespace runs).
     *   3. **Strip** markup comments, `<script>`/`<style>` blocks and markdown
     *      beacons (image / link / dangerous-scheme). The wrap does not decode
     *      HTML entities: its output is what gets returned, and on a channel
     *      whose consumer does not decode, a decode would manufacture live
     *      markup from inert bytes. So an entity-encoded beacon or `<script>`
     *      block survives this stage.
     *   4. **Re-sanitise and re-detect** the stripped text, so a phrase the
     *      strip stage joined still reaches the `[injection-defense]` log.
     *   5. **Spotlight** the defended text (only when this flag is `true`)
     *      using a fresh per-message UUID.
     *
     * Steps 1-4 run regardless of this flag — only step 5
     * (spotlighting sentinels) is gated — except above `STRIP_PATH_MAX_BYTES`
     * (256 KB), where a part takes Steps 1-2 alone, **and on a text part that parses
     * as JSON, where the wrap detects but rewrites nothing — no Unicode
     * sanitise and no markup, comment or markdown-beacon strip.** A JSON
     * document is returned to the model as the origin wrote it, because the
     * payload is the agent's to interpret (`LESSONS.md` RC-49) and rewriting a
     * value inside one silently corrupts an API payload: `stripHtmlComments` pairs `<!--` in
     * one field with `-->` in a later one and deletes what lies between. The
     * trade is deliberate and it is not free — a beacon or a `javascript:`
     * link inside a JSON string value reaches the model. Weigh that before
     * leaving spotlighting off.
     *
     * **"As the origin wrote it" includes Unicode attack codepoints.** A JSON
     * document carrying a literal U+200B or U+202E comes back with it, and
     * nothing reports the codepoint itself: the injection-detection log fires
     * only where one splits an injection phrase. `curl_execute` reports the
     * exceptions it can see: `body_decode_lossy` for a non-UTF-8 origin, and
     * `savedMessage` naming which form an artefact holds — the sanitised one
     * only for a non-JSON body Step 2 changed; a JSON document, a leading
     * U+FEFF included, is always saved as the origin's octets. The
     * wrap is idempotent via a
     * module-private, non-enumerable `Symbol` tag with an own-property check
     * (so the tag cannot be forged from outside the wrap module and an
     * inherited tag on a wrapped prototype cannot bypass processing of
     * descendant content), and is fail-open: if any internal step throws it
     * returns the original result unchanged and emits a throttled
     * `[wrap-error]` log line, so defence-in-depth never becomes a
     * load-bearing failure mode for the handler boundary.
     */
    enableSpotlighting?: boolean;
}
/**
 * Context provided to hooks during tool execution.
 * Contains tool name, parameters, session info, and current config.
 */
interface HookContext<T = CurlExecuteInput | JqQueryInput> {
    /** Which tool is being executed */
    readonly tool: "curl_execute" | "jq_query";
    /** Tool parameters (may be modified by beforeRequest hooks) */
    params: T;
    /** Session ID for HTTP transport, undefined for stdio */
    readonly sessionId?: string;
    /** Current frozen configuration */
    readonly config: Readonly<McpCurlConfig>;
}
/**
 * Result type for beforeRequest hooks.
 * - void: continue with current params
 * - { params }: merge these params into current params
 * - { shortCircuit: true, response }: skip execution, return response immediately
 */
type BeforeRequestResult<T> = void | {
    params?: Partial<T>;
} | {
    shortCircuit: true;
    response: string;
    isError?: boolean;
};
/**
 * Hook called before tool execution.
 * Can modify params or short-circuit to return early.
 */
type BeforeRequestHook<T = CurlExecuteInput | JqQueryInput> = (ctx: HookContext<T>) => BeforeRequestResult<T> | Promise<BeforeRequestResult<T>>;
/**
 * Hook called once the tool returns, an `isError` result included; a tool
 * that throws reaches the onError hooks instead.
 * Receives the response for logging, metrics, caching, etc.
 *
 * `response` is the body, `content[0]`. `content` is every entry the tool
 * returns: `curl_execute` adds response header text and server-authored
 * notices as later entries, only when each has text, so a hook finds one by
 * matching its text rather than its index. A non-zero cURL exit can leave the
 * body empty with `isError` false, and its notice is in `content` alone. The
 * entries are frozen copies, so a hook cannot change the result it observes.
 */
type AfterResponseHook<T = CurlExecuteInput | JqQueryInput> = (ctx: HookContext<T> & {
    response: string;
    content: ReadonlyArray<{
        readonly type: "text";
        readonly text: string;
    }>;
    isError: boolean;
}) => void | Promise<void>;
/**
 * Hook called when tool execution throws an error.
 * Receives the error for logging or handling.
 */
type OnErrorHook<T = CurlExecuteInput | JqQueryInput> = (ctx: HookContext<T> & {
    error: Error;
}) => void | Promise<void>;
/**
 * Transport mode for the MCP server.
 * - stdio: Standard input/output (default, for CLI usage)
 * - http: HTTP/SSE transport (for web clients)
 */
type TransportMode = "stdio" | "http";

/** Tool result type returned by executeJqQuery */
interface JqQueryResult {
    [key: string]: unknown;
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
}
/** Extra context passed to tool handler */
interface JqQueryExtra {
    sessionId?: string;
}
/**
 * Execute a jq query on a JSON file.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated jq_query parameters
 * @param _extra - Additional context (sessionId, unused but kept for consistency)
 * @returns Tool result with query result content
 */
declare function executeJqQuery(params: JqQueryInput, _extra: JqQueryExtra): Promise<JqQueryResult>;

/**
 * Partial curl_execute input with optional path for baseUrl resolution.
 */
interface ExecuteRequestParams extends Partial<CurlExecuteInput> {
    /**
     * Path to append to `baseUrl` (alternative to `url`). A missing leading `/`
     * is added; after that it must start with a single `/`, contain no control
     * characters, and hold no `.` or `..` segment (literal or `%2e`-encoded), or
     * the call returns an error result. A leading `//`, `\` or `/\` is refused,
     * never joined.
     */
    path?: string;
}
/**
 * Instance utilities interface returned by McpCurlServer.utilities().
 */
interface InstanceUtilities {
    /**
     * Execute a cURL request with config defaults applied.
     * Takes an absolute `url`; with `baseUrl` configured, also a `url` starting
     * with `/` or a `path`, both resolved by `resolveRequestUrl`. A relative
     * value that starts `//`, `\` or `/\`, holds a control character, or holds
     * a `.` or `..` segment (literal or `%2e`-encoded) is refused with an error
     * result rather than requested.
     *
     * Rejects, rather than returning an error result, when `allowedHosts` is
     * unset, `baseUrl` cannot give a host and the call names an absolute `url`:
     * the configuration `start()` refuses with the same error, so it is reachable
     * only before `start()`, and a misconfigured server surfaces it to the
     * embedder, not the model. A relative `url` or a `path` against that
     * `baseUrl` gets `resolveRequestUrl`'s error result first and never reaches
     * the rejection.
     *
     * NOTE: This method calls executeCurlRequest directly and bypasses the hook
     * system (beforeRequest, afterResponse, onError). Use MCP tool invocation
     * if you need hooks to execute.
     */
    executeRequest(params: ExecuteRequestParams): Promise<CurlExecuteResult>;
    /**
     * Query a JSON file with config defaults applied.
     *
     * NOTE: This method calls executeJqQuery directly and bypasses the hook
     * system. Use MCP tool invocation if you need hooks to execute.
     */
    queryFile(filepath: string, jqFilter: string): Promise<JqQueryResult>;
}
/**
 * Create instance utilities that apply config defaults.
 *
 * @param config - Frozen server configuration
 * @returns Object with config-aware utility methods
 */
declare function createInstanceUtilities(config: Readonly<McpCurlConfig>): InstanceUtilities;

/**
 * Metadata for a custom tool registration.
 */
interface CustomToolMeta {
    /** Human-readable title */
    title: string;
    /** Description for LLM context */
    description: string;
    /** Zod schema for input validation */
    inputSchema: z.ZodObject<z.ZodRawShape>;
    /** Optional MCP tool annotations */
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
}
/**
 * Extensible MCP cURL server with fluent builder API.
 *
 * Provides hooks for request interception, configuration options,
 * and tool management.
 *
 * @example
 * ```typescript
 * const server = new McpCurlServer()
 *   .configure({ baseUrl: "https://api.example.com" })
 *   .beforeRequest((ctx) => {
 *     console.log("Request:", ctx.tool, ctx.params);
 *   });
 * await server.start("stdio");
 * ```
 */
declare class McpCurlServer {
    private _config;
    private _frozenConfig;
    private _hooks;
    private _tools;
    private _customTools;
    private _started;
    private _starting;
    private _shutdown;
    private _server;
    private _httpServer;
    private _sessionManager;
    private _rateLimitInterval;
    private _hostLimitHandle;
    private _injectionCleanupInterval;
    private _wrapErrorCleanupInterval;
    private _utilities;
    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start(), if `rateLimit` holds an unknown key, a
     *   `max` or `windowMs` that is not a positive integer, or a `syncFromHeaders`
     *   that is not `{ remaining: <header name> }`, if an `allowedHosts` entry is not a bare host name,
     *   or if `curlExecuteDescriptionAppend` exceeds `MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH`
     *   once sanitised
     */
    configure(config: Partial<McpCurlConfig>): this;
    /**
     * Disable the curl_execute tool.
     * When disabled, calls to curl_execute return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableCurlExecute(): this;
    /**
     * Disable the jq_query tool.
     * When disabled, calls to jq_query return an error.
     *
     * @returns this for chaining
     * @throws Error if called after start()
     */
    disableJqQuery(): this;
    /**
     * Register a beforeRequest hook.
     * Hooks run sequentially in registration order before tool execution.
     * Can modify params or short-circuit to return early.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    beforeRequest(hook: BeforeRequestHook): this;
    /**
     * Register an afterResponse hook.
     * Hooks run sequentially once the tool returns, an isError result included; a hook that throws is passed to the onError hooks.
     * Useful for logging, metrics, caching.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    afterResponse(hook: AfterResponseHook): this;
    /**
     * Register an onError hook.
     * Hooks run sequentially when tool execution or an afterResponse hook throws; the original error is still rethrown.
     * Useful for error logging and reporting.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    onError(hook: OnErrorHook): this;
    /**
     * Register a custom tool.
     * Custom tools are registered on the MCP server during start().
     * Use this to add API-specific tools generated from schema definitions.
     *
     * Note: Custom tools are NOT wrapped with beforeRequest/afterResponse/onError hooks.
     * If you need hook-like behavior, implement it within the handler function itself.
     * Their results do pass through the response defence wrap at start(): text parts are
     * sanitised and scanned for injection (a JSON part is scanned only), and spotlighted
     * when `enableSpotlighting` is set, under the "custom" hostname label.
     *
     * @param name - Tool name (must match /^[a-z][a-z0-9_]*$/)
     * @param meta - Tool metadata (title, description, inputSchema). title and description
     *   are sanitized automatically, and the description is truncated (with a warning) to
     *   `MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH` chars. **inputSchema field descriptions are also
     *   sanitised at every depth, to the walker's 100-level cap,** at registration time via the
     *   `sanitizeFieldDescriptionsDeep` helper. Recursion descends into
     *   `ZodObject` (`.shape` values), `ZodArray` (`.element`),
     *   `ZodUnion` (including `ZodDiscriminatedUnion`, which `instanceof
     *   ZodUnion` in Zod v4) options, `ZodTuple` items + rest, `ZodRecord` /
     *   `ZodMap` (key + value types), `ZodSet` value type, `ZodIntersection`
     *   left/right, `ZodPipe` (produced by `.transform()` / `.pipe()`)
     *   in/out, `ZodLazy` getter result, and through `ZodOptional` /
     *   `ZodDefault` / `ZodNullable` / `ZodReadonly` / `ZodCatch` /
     *   `ZodPromise` wrappers (via `.unwrap()`). `.refine()` / `.check()` /
     *   `.superRefine()` append checks in place in Zod v4 and do not wrap
     *   the schema, so descriptions placed before a refinement are sanitised
     *   on the underlying instance.
     *
     *   **Side effect:** the helper mutates `z.globalRegistry` entries on the
     *   passed-in schema *in place* (description metadata only — no parsing
     *   semantics change). Runtime invariants are preserved, including
     *   `.refine()` / `.check()` chains, `.strict()` / `.passthrough()`
     *   modes, `z.array().min()` / `.max()` / `.length()` / `.nonempty()`
     *   constraints, factory defaults on `ZodDefault`, and
     *   `ZodDiscriminatedUnion` discriminators. Callers need not sanitise field
     *   descriptions sourced from external input themselves; doing so is
     *   harmless (the walk is idempotent).
     * @param handler - Tool handler function
     * @returns this for chaining
     * @throws Error if called after start()
     * @throws Error if tool name conflicts with built-in tools
     * @throws Error if tool name format is invalid
     * @throws Error if the tool name is already registered
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
    registerCustomTool(name: string, meta: CustomToolMeta, handler: ToolCallback<z.ZodObject<z.ZodRawShape>>): this;
    /**
     * Get the current (frozen after start) configuration.
     * Returns a deep-frozen snapshot to prevent mutation of nested objects.
     *
     * @returns Readonly configuration object
     */
    getConfig(): Readonly<McpCurlConfig>;
    /**
     * Get config-aware utility methods for direct tool execution.
     * Utilities apply configuration defaults automatically.
     *
     * @returns Instance utilities object
     */
    utilities(): InstanceUtilities;
    /**
     * Get the underlying MCP server instance.
     * Returns null if not yet started.
     *
     * @returns MCP server or null
     */
    getMcpServer(): McpServer | null;
    /**
     * Inspect the registered custom tools (read-only). Returns the tool name
     * and metadata for each registered tool, omitting handler closures so
     * callers cannot accidentally invoke them.
     *
     * Useful for tests that need to assert what was registered (and what its
     * advertised title/description look like) without starting the server.
     *
     * Returned entries are fresh frozen copies — `meta` and `meta.annotations`
     * included — so nothing a caller does to them reaches the stored `meta` that
     * `start()` forwards to `server.registerTool`. `meta.inputSchema` is intentionally
     * shared by reference: Zod schema instances rely on internal mutable state
     * and freezing would break them; treat it as read-only by convention.
     */
    getRegisteredCustomTools(): ReadonlyArray<{
        readonly name: string;
        readonly meta: Readonly<CustomToolMeta>;
    }>;
    /**
     * Check if the server has been started.
     *
     * @returns true if started
     */
    isStarted(): boolean;
    /**
     * Start the server with the specified transport.
     * Configuration is frozen after this call.
     *
     * @param transport - Transport mode: "stdio" (default) or "http"
     * @throws Error if already started, or if `allowedHosts` is unset and `baseUrl`
     *   is not an absolute http(s) URL (the default host list cannot be derived);
     *   and, after rolling back, if the HTTP auth token is invalid, another server in
     *   the process already holds `rateLimit`, or the transport fails to come up
     *   (e.g. the HTTP port is in use)
     */
    start(transport?: TransportMode): Promise<void>;
    private launch;
    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     * Safe to call even if server was never started.
     */
    shutdown(): Promise<void>;
    private teardown;
    /**
     * Create a fully configured MCP server instance.
     * Registers resources, prompts, and tools with hooks applied.
     * Used by both main server initialization and HTTP session creation.
     *
     * @returns Configured McpServer instance
     */
    private createConfiguredServer;
    /**
     * Register the built-in tools, with hooks, and the custom tools, with the
     * defence wrap but no hooks, on a given server. A disabled built-in is still
     * registered and listed, without `curlExecuteDescriptionAppend`; only its
     * handler refuses.
     *
     * @param server - MCP server to register tools on
     */
    private registerToolsOnServer;
    /**
     * Start stdio transport.
     */
    private startStdio;
    /**
     * Start HTTP transport with session management.
     * Delegates to shared createHttpApp() for route setup, auth, and Origin validation.
     *
     * @param authToken - Pre-resolved bearer token (already passed through
     *   `validateAuthToken` in `launch()`). Passing the snapshot down avoids
     *   resolving the env var twice and guarantees the value the auth
     *   middleware closes over is the exact value that was validated.
     */
    private startHttp;
    /**
     * Deep-freeze the current config to prevent mutation of nested objects.
     */
    private freezeConfig;
    /**
     * Undo `start()`'s process-wide effects: the three cleanup intervals and
     * this server's host limit. Shared by the start rollback and `shutdown()`,
     * and safe to call when any of them was never set up.
     */
    private releaseProcessState;
    /**
     * Ensure server has not been started.
     * @throws Error if started
     */
    private ensureNotStarted;
}

/**
 * Base options shared by all schema source variants.
 */
interface ApiServerOptionsBase {
    /** Additional configuration to merge */
    config?: Partial<McpCurlConfig>;
    /** Disable the default curl_execute tool */
    disableCurlExecute?: boolean;
    /** Disable the default jq_query tool */
    disableJqQuery?: boolean;
    /**
     * Generator configuration for tool creation. Takes no `allowedHosts`: the
     * YAML tools take the server's own `config.allowedHosts`, so a generator
     * list here would be discarded rather than applied.
     */
    generatorConfig?: Omit<GeneratorConfig, "allowedHosts">;
}
/**
 * Load schema from a YAML file path.
 */
interface ApiServerFromPath extends ApiServerOptionsBase {
    /** Path to YAML definition file */
    definitionPath: string;
    /** YAML content - mutually exclusive with definitionPath */
    definitionContent?: never;
    /** Pre-loaded schema - mutually exclusive with definitionPath */
    schema?: never;
}
/**
 * Load schema from a YAML string.
 */
interface ApiServerFromContent extends ApiServerOptionsBase {
    /** Path - mutually exclusive with definitionContent */
    definitionPath?: never;
    /** YAML content as string */
    definitionContent: string;
    /** Pre-loaded schema - mutually exclusive with definitionContent */
    schema?: never;
}
/**
 * Use a pre-loaded and validated schema.
 */
interface ApiServerFromSchema extends ApiServerOptionsBase {
    /** Path - mutually exclusive with schema */
    definitionPath?: never;
    /** YAML content - mutually exclusive with schema */
    definitionContent?: never;
    /** Pre-loaded and validated API schema */
    schema: ApiSchema;
}
/**
 * Options for creating an API server from a schema definition.
 * Exactly one of definitionPath, definitionContent, or schema must be provided.
 */
type CreateApiServerOptions = ApiServerFromPath | ApiServerFromContent | ApiServerFromSchema;
/**
 * Create an MCP server from an API schema definition.
 *
 * This factory function:
 * 1. Loads and validates the YAML schema
 * 2. Creates a McpCurlServer instance
 * 3. Applies schema-derived configuration
 * 4. Registers endpoint tools
 *
 * @param options - Server creation options
 * @returns Configured McpCurlServer ready to start
 * @throws ApiSchemaLoadError if schema file cannot be read or parsed
 * @throws ApiSchemaValidationError if schema validation fails
 *
 * @example
 * ```typescript
 * // From YAML file
 * const server = await createApiServer({
 *   definitionPath: "./my-api.yaml",
 *   disableCurlExecute: true, // curl_execute stays listed but refuses every call
 * });
 * await server.start("stdio");
 *
 * // From string
 * const server = await createApiServer({
 *   definitionContent: yamlString,
 * });
 *
 * // With custom config
 * const server = await createApiServer({
 *   definitionPath: "./api.yaml",
 *   config: {
 *     maxResultSize: 1_000_000,
 *   },
 * });
 * ```
 */
declare function createApiServer(options: CreateApiServerOptions): Promise<McpCurlServer>;
/**
 * Synchronous version of createApiServer for cases where schema is already loaded.
 * Use this when you have a pre-validated schema object.
 *
 * @param schema - Pre-validated API schema
 * @param options - Optional server configuration
 * @returns Configured McpCurlServer
 */
declare function createApiServerSync(schema: ApiSchema, options?: ApiServerOptionsBase): McpCurlServer;

export { type AfterResponseHook as A, type BeforeRequestHook as B, type CreateApiServerOptions as C, type ExecuteRequestParams as E, type HookContext as H, type InstanceUtilities as I, type McpCurlConfig as M, type OnErrorHook as O, type TransportMode as T, type BeforeRequestResult as a, type CustomToolMeta as b, McpCurlServer as c, createApiServer as d, createApiServerSync as e, createInstanceUtilities as f, executeJqQuery as g, type HostRateLimit as h };
