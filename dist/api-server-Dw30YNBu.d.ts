import { ToolCallback, McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { C as CurlExecuteInput, J as JqQueryInput, o as CurlExecuteResult, G as GeneratorConfig, b as ApiSchema } from './generator-D_8nKMrh.js';

/**
 * Configuration options for McpCurlServer.
 * These settings affect how all tool calls are processed.
 */
interface McpCurlConfig {
    /** Base URL prepended to relative URLs in curl_execute */
    baseUrl?: string;
    /** Default headers added to all curl_execute requests */
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
 * Hook called after successful tool execution.
 * Receives the response for logging, metrics, caching, etc.
 */
type AfterResponseHook<T = CurlExecuteInput | JqQueryInput> = (ctx: HookContext<T> & {
    response: string;
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
    /** Path to append to baseUrl (alternative to url) */
    path?: string;
}
/**
 * Instance utilities interface returned by McpCurlServer.utilities().
 */
interface InstanceUtilities {
    /**
     * Execute a cURL request with config defaults applied.
     * Can use `path` with `baseUrl` or provide a full `url`.
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
 * and tool management while maintaining backward compatibility.
 *
 * @example
 * ```typescript
 * const server = new McpCurlServer()
 *   .configure({ baseUrl: "https://api.example.com" })
 *   .beforeRequest((ctx) => {
 *     console.log("Request:", ctx.tool, ctx.params);
 *   })
 *   .start("stdio");
 * ```
 */
declare class McpCurlServer {
    private _config;
    private _frozenConfig;
    private _hooks;
    private _tools;
    private _customTools;
    private _started;
    private _server;
    private _httpServer;
    private _sessionManager;
    private _rateLimitInterval;
    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start()
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
     * Hooks run sequentially after successful tool execution.
     * Useful for logging, metrics, caching.
     *
     * @param hook - Hook function
     * @returns this for chaining
     * @throws Error if called after start()
     */
    afterResponse(hook: AfterResponseHook): this;
    /**
     * Register an onError hook.
     * Hooks run sequentially when tool execution throws.
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
     * @throws Error if already started
     */
    start(transport?: TransportMode): Promise<void>;
    /**
     * Gracefully shutdown the server.
     * Closes all connections and cleans up resources.
     * Safe to call even if server was never started.
     */
    shutdown(): Promise<void>;
    /**
     * Create a fully configured MCP server instance.
     * Registers resources, prompts, and tools with hooks applied.
     * Used by both main server initialization and HTTP session creation.
     *
     * @returns Configured McpServer instance
     */
    private createConfiguredServer;
    /**
     * Register tools with hooks applied on a given server.
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
     */
    private startHttp;
    /**
     * Deep-freeze the current config to prevent mutation of nested objects.
     */
    private freezeConfig;
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
    /** Generator configuration for tool creation */
    generatorConfig?: GeneratorConfig;
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
 *   disableCurlExecute: true, // Only expose generated tools
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

export { type AfterResponseHook as A, type BeforeRequestHook as B, type CreateApiServerOptions as C, type ExecuteRequestParams as E, type HookContext as H, type InstanceUtilities as I, type McpCurlConfig as M, type OnErrorHook as O, type TransportMode as T, type BeforeRequestResult as a, type CustomToolMeta as b, McpCurlServer as c, createApiServer as d, createApiServerSync as e, createInstanceUtilities as f, executeJqQuery as g };
