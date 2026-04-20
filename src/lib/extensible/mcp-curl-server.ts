// src/lib/extensible/mcp-curl-server.ts
// Extensible MCP server class with fluent builder API

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";

import type {
    McpCurlConfig,
    TransportMode,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,
} from "../types/public.js";
import type { Hooks } from "./types.js";
import { createInstanceUtilities, type InstanceUtilities } from "./instance-utilities.js";
import { registerCurlToolWithHooks, registerJqToolWithHooks } from "./tool-wrapper.js";

import { createServer } from "../server/server-factory.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { executeCurlRequest } from "../tools/curl-execute.js";
import { executeJqQuery } from "../tools/jq-query.js";
import { cleanupOrphanedTempDirs, cleanupTempDir } from "../files/index.js";
import { startRateLimitCleanup, stopRateLimitCleanup, startInjectionCleanup, stopInjectionCleanup } from "../security/index.js";
import { sanitizeDescription, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "../utils/index.js";
import { createHttpApp, resolveHost, formatHostForUrl } from "../transports/http.js";
import { SessionManager } from "../session/index.js";
import { ENV, LIMITS, parsePort } from "../config/index.js";

/**
 * Metadata for a custom tool registration.
 */
export interface CustomToolMeta {
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
 * Stored custom tool definition.
 */
interface CustomToolDef {
    name: string;
    meta: CustomToolMeta;
    handler: ToolCallback<z.ZodObject<z.ZodRawShape>>;
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

const KNOWN_CONFIG_KEYS_ARRAY = [
    "baseUrl", "defaultHeaders", "defaultTimeout", "outputDir",
    "maxResultSize", "allowLocalhost", "port", "host",
    "authToken", "allowedOrigins", "defaultUserAgent", "defaultReferer",
    "enableSpotlighting",
] as const satisfies readonly (keyof McpCurlConfig)[];

// Compile-time check: fails if any McpCurlConfig key is missing from the array
type _AssertExhaustive = [Exclude<keyof McpCurlConfig, (typeof KNOWN_CONFIG_KEYS_ARRAY)[number]>] extends [never] ? true : never;
const _: _AssertExhaustive = true;

const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set(KNOWN_CONFIG_KEYS_ARRAY);

export class McpCurlServer {
    private _config: McpCurlConfig = {};
    private _frozenConfig: Readonly<McpCurlConfig> | null = null;
    private _hooks: Hooks = {
        beforeRequest: [],
        afterResponse: [],
        onError: [],
    };
    private _tools = {
        curl_execute: true,
        jq_query: true,
    };
    private _customTools: CustomToolDef[] = [];
    private _started = false;
    private _server: McpServer | null = null;
    private _httpServer: Server | null = null;
    private _sessionManager: SessionManager | null = null;
    private _rateLimitInterval: NodeJS.Timeout | null = null;
    private _injectionCleanupInterval: NodeJS.Timeout | null = null;
    private _utilities: InstanceUtilities | null = null;

    /**
     * Configure server options.
     * Must be called before start().
     *
     * @param config - Configuration options to merge
     * @returns this for chaining
     * @throws Error if called after start()
     */
    configure(config: Partial<McpCurlConfig>): this {
        this.ensureNotStarted("configure()");
        const picked: Partial<McpCurlConfig> = {};
        const knownKeysList = KNOWN_CONFIG_KEYS_ARRAY.join(", ");
        for (const key of Object.keys(config)) {
            if (KNOWN_CONFIG_KEYS.has(key)) {
                (picked as Record<string, unknown>)[key] = (config as Record<string, unknown>)[key];
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
    disableCurlExecute(): this {
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
    disableJqQuery(): this {
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
    beforeRequest(hook: BeforeRequestHook): this {
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
    afterResponse(hook: AfterResponseHook): this {
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
    onError(hook: OnErrorHook): this {
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
     * @param meta - Tool metadata (title, description, inputSchema). title and description
     *   are sanitized automatically. inputSchema field descriptions (.describe() strings)
     *   are NOT sanitized — callers must sanitize any field descriptions sourced from
     *   external input using sanitizeDescription() before registering.
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
    registerCustomTool(
        name: string,
        meta: CustomToolMeta,
        handler: ToolCallback<z.ZodObject<z.ZodRawShape>>
    ): this {
        this.ensureNotStarted("registerCustomTool()");

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
            throw new Error(
                `Invalid tool name "${name}": must start with a lowercase letter and contain only lowercase letters, digits, and underscores.`
            );
        }

        // Check for conflicts with built-in tools
        if (name === "curl_execute" || name === "jq_query") {
            throw new Error(
                `Cannot register custom tool "${name}": built-in tool names are reserved and cannot be overridden, even if disabled.`
            );
        }

        // Check for duplicate custom tools
        if (this._customTools.some((t) => t.name === name)) {
            throw new Error(`Custom tool "${name}" is already registered`);
        }

        // Store a sanitized defensive copy — never trust caller's object directly.
        // title and description are sanitized here. inputSchema field descriptions
        // (.describe() on individual Zod fields) are the caller's responsibility —
        // traversing arbitrary Zod v4 schemas safely is non-trivial. Callers should
        // apply sanitizeDescription() to any field descriptions sourced from external input.
        const sanitizedTitle = sanitizeDescription(meta.title);
        const sanitizedDesc = sanitizeDescription(meta.description);
        const truncatedDesc = sanitizedDesc.slice(0, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH);

        const sanitizedMeta: CustomToolMeta = {
            ...meta,
            title: sanitizedTitle,
            description: truncatedDesc,
        };

        // Warn only when sanitization itself caused truncation — not when the pre-existing
        // description was already longer than the sanitized result (e.g. attack chars removed).
        if (sanitizedDesc.length > MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH) {
            console.warn(
                `McpCurlServer.registerCustomTool("${name}"): description truncated to ${MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH} chars`
            );
        }

        this._customTools.push({ name, meta: sanitizedMeta, handler });
        return this;
    }

    /**
     * Get the current (frozen after start) configuration.
     * Returns a deep-frozen snapshot to prevent mutation of nested objects.
     *
     * @returns Readonly configuration object
     */
    getConfig(): Readonly<McpCurlConfig> {
        if (this._frozenConfig) return this._frozenConfig;
        return this.freezeConfig();
    }

    /**
     * Get config-aware utility methods for direct tool execution.
     * Utilities apply configuration defaults automatically.
     *
     * @returns Instance utilities object
     */
    utilities(): InstanceUtilities {
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
    getMcpServer(): McpServer | null {
        return this._server;
    }

    /**
     * Check if the server has been started.
     *
     * @returns true if started
     */
    isStarted(): boolean {
        return this._started;
    }

    /**
     * Start the server with the specified transport.
     * Configuration is frozen after this call.
     *
     * @param transport - Transport mode: "stdio" (default) or "http"
     * @throws Error if already started
     */
    async start(transport: TransportMode = "stdio"): Promise<void> {
        if (this._started) {
            throw new Error("Server is already running. Call shutdown() before starting again.");
        }
        this._started = true;
        this._frozenConfig = this.freezeConfig();

        try {
            // Clean up orphaned temp directories from previous runs
            await cleanupOrphanedTempDirs();

            // Start rate limit cleanup and injection detection cleanup
            this._rateLimitInterval = startRateLimitCleanup();
            this._injectionCleanupInterval = startInjectionCleanup();

            // Create and configure MCP server
            this._server = this.createConfiguredServer();

            // Start appropriate transport
            if (transport === "http") {
                await this.startHttp();
            } else {
                await this.startStdio();
            }
        } catch (error) {
            // Rollback state on failure to allow retry with new instance
            if (this._httpServer) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => resolve(), 5000);
                        this._httpServer!.close((err) => {
                            clearTimeout(timeout);
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                } catch {
                    // Best-effort close during rollback
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
            if (this._injectionCleanupInterval) {
                stopInjectionCleanup(this._injectionCleanupInterval);
                this._injectionCleanupInterval = null;
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
    async shutdown(): Promise<void> {
        if (!this._started) {
            return; // Nothing to shut down
        }
        console.error("Shutting down McpCurlServer...");

        // Close HTTP server if running with timeout
        if (this._httpServer) {
            const SHUTDOWN_TIMEOUT = 5000;
            let timeoutId: NodeJS.Timeout | undefined;

            try {
                await Promise.race([
                    new Promise<void>((resolve, reject) => {
                        this._httpServer!.close((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    }),
                    new Promise<void>((_, reject) => {
                        timeoutId = setTimeout(
                            () => reject(new Error("HTTP server shutdown timeout")),
                            SHUTDOWN_TIMEOUT
                        );
                    }),
                ]);
            } catch (error) {
                console.error("Warning: Error closing HTTP server:", error);
            } finally {
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                this._httpServer = null;
            }
        }

        // Close all active sessions (with error handling)
        if (this._sessionManager) {
            this._sessionManager.stopCleanup();
            try {
                await this._sessionManager.closeAll();
            } catch (error) {
                console.error("Warning: Error closing sessions:", error);
            }
        }

        // Close main MCP server
        if (this._server) {
            try {
                await this._server.close();
            } catch (error) {
                console.error("Warning: Error closing MCP server:", error);
            } finally {
                this._server = null;
            }
        }

        // Stop rate limit cleanup and injection detection cleanup
        if (this._rateLimitInterval) {
            stopRateLimitCleanup(this._rateLimitInterval);
        }
        if (this._injectionCleanupInterval) {
            stopInjectionCleanup(this._injectionCleanupInterval);
        }

        // Clean up temp directory (wrapped in try/finally to always reset state)
        try {
            await cleanupTempDir();
        } catch (error) {
            console.error("Warning: Error cleaning up temp directory:", error);
        } finally {
            // Reset state to allow potential reuse
            this._started = false;
            this._frozenConfig = null;
            this._utilities = null;
            this._rateLimitInterval = null;
            this._injectionCleanupInterval = null;
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
    private createConfiguredServer(): McpServer {
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
    private registerToolsOnServer(server: McpServer): void {
        const config = this._frozenConfig!;

        registerCurlToolWithHooks(server, {
            executor: executeCurlRequest,
            enabled: this._tools.curl_execute,
            config,
            hooks: this._hooks,
        });

        registerJqToolWithHooks(server, {
            executor: executeJqQuery,
            enabled: this._tools.jq_query,
            config,
            hooks: this._hooks,
        });

        // Register custom tools
        for (const { name, meta, handler } of this._customTools) {
            server.registerTool(name, meta, handler);
        }
    }

    /**
     * Start stdio transport.
     */
    private async startStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this._server!.connect(transport);
        console.error("cURL MCP server running on stdio");
    }

    /**
     * Start HTTP transport with session management.
     * Delegates to shared createHttpApp() for route setup, auth, and Origin validation.
     */
    private async startHttp(): Promise<void> {
        this._sessionManager = new SessionManager();
        this._sessionManager.startCleanup();

        const app = createHttpApp({
            createMcpServer: () => this.createConfiguredServer(),
            sessionManager: this._sessionManager,
            authToken: this._frozenConfig!.authToken ?? process.env[ENV.AUTH_TOKEN],
            allowedOrigins: this._frozenConfig!.allowedOrigins,
        });

        const port = this._frozenConfig!.port ?? parsePort(process.env[ENV.PORT], LIMITS.DEFAULT_HTTP_PORT);
        const host = resolveHost(this._frozenConfig!.host);

        return new Promise((resolve, reject) => {
            this._httpServer = app.listen(port, host);

            this._httpServer.on("listening", () => {
                console.error(`cURL MCP server running on http://${formatHostForUrl(host)}:${port}/mcp`);
                resolve();
            });

            this._httpServer.on("error", (err: NodeJS.ErrnoException) => {
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
    private freezeConfig(): Readonly<McpCurlConfig> {
        return Object.freeze({
            ...this._config,
            defaultHeaders: this._config.defaultHeaders
                ? Object.freeze({ ...this._config.defaultHeaders })
                : undefined,
            allowedOrigins: this._config.allowedOrigins
                ? Object.freeze([...this._config.allowedOrigins]) as readonly string[]
                : undefined,
        });
    }

    /**
     * Ensure server has not been started.
     * @throws Error if started
     */
    private ensureNotStarted(method: string): void {
        if (this._started) {
            throw new Error(`Cannot call ${method} after server has started`);
        }
    }
}
