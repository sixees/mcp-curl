// src/lib/schema/generator.ts
// Generates MCP tools from API schema endpoint definitions

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
    ApiSchema,
    EndpointDefinition,
    EndpointParameter,
    AuthConfig,
    HttpMethod,
} from "./types.js";
import { executeCurlRequest, type CurlExecuteResult, type CurlExecuteExtra } from "../tools/curl-execute.js";
import { resolveBaseUrl, sanitizeDescription } from "../utils/index.js";
import { applyDefaultHeaders } from "../config/index.js";

/**
 * Error thrown when authentication is required but not available.
 */
export class AuthenticationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthenticationError";
    }
}

/**
 * Configuration for generating endpoint tools.
 */
export interface GeneratorConfig {
    /** Override auth config (for testing) */
    authOverride?: Record<string, string>;
    /** Custom timeout to apply */
    timeout?: number;
    /** Default headers to merge */
    defaultHeaders?: Record<string, string>;
    /** Override base URL (takes precedence over schema.api.baseUrl) */
    baseUrl?: string;
    /** Allow localhost requests (propagated to curl executor) */
    allowLocalhost?: boolean;
    /** Default User-Agent for all requests. Empty string disables. */
    defaultUserAgent?: string;
    /** Default Referer for all requests. Empty string disables. */
    defaultReferer?: string;
}

/**
 * Generate a Zod input schema from endpoint parameter definitions.
 *
 * @param endpoint - Endpoint definition with parameters
 * @returns Zod object schema for the endpoint
 */
export function generateInputSchema(endpoint: EndpointDefinition): z.ZodObject<z.ZodRawShape> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const param of endpoint.parameters ?? []) {
        let schema: z.ZodTypeAny = createParamSchema(param);

        if (param.description) {
            schema = schema.describe(sanitizeDescription(param.description));
        }

        if (!param.required) {
            schema = schema.optional();
        }

        shape[param.name] = schema;
    }

    // Add optional filter_preset parameter if presets exist.
    // Sanitize preset names so the enum values are consistent with the description display
    // and resolveJqFilter lookup — prevents bidi/zero-width chars in schema-presented values.
    if (endpoint.response?.filterPresets?.length) {
        const presetNames = endpoint.response.filterPresets.map((p) => sanitizeDescription(p.name));
        const uniqueNames = new Set(presetNames);
        if (uniqueNames.size !== presetNames.length) {
            throw new Error(
                `Endpoint "${endpoint.id}" has duplicate filter preset names after sanitization`
            );
        }
        shape.filter_preset = buildStringEnum(presetNames)
            .optional()
            .describe("Apply a predefined response filter");
    }

    return z.object(shape);
}

/**
 * Build a string enum schema, falling back to z.literal() for single-element arrays
 * because z.enum() requires at least 2 elements.
 */
function buildStringEnum(values: string[]): z.ZodTypeAny {
    if (values.length === 1) return z.literal(values[0]);
    return z.enum(values as [string, ...string[]]);
}

/**
 * Build a number union schema, falling back to z.literal() for single-element arrays
 * because z.union() requires at least 2 elements.
 */
function buildNumberUnion(values: number[]): z.ZodTypeAny {
    if (values.length === 1) return z.literal(values[0]);
    return z.union(
        values.map((v) => z.literal(v)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]
    );
}

/**
 * Create a Zod schema for a single parameter based on its type.
 */
function createParamSchema(param: EndpointParameter): z.ZodTypeAny {
    // Handle enum first (applies to any base type)
    if (param.enum && param.enum.length > 0) {
        // Enum can be strings or numbers
        const firstValue = param.enum[0];
        if (typeof firstValue === "string") {
            return buildStringEnum(param.enum as string[]);
        } else {
            return buildNumberUnion(param.enum as number[]);
        }
    }

    // Base type schemas
    switch (param.type) {
        case "number":
            return z.number();
        case "integer":
            return z.number().int();
        case "boolean":
            return z.boolean();
        case "string":
        default:
            return z.string();
    }
}

/**
 * Build the full URL with path parameter substitution and query params.
 *
 * @param baseUrl - API base URL
 * @param path - Endpoint path with {param} placeholders
 * @param pathParams - Values for path parameters
 * @param queryParams - Query parameters to append
 * @returns Fully constructed URL
 */
export function buildUrl(
    baseUrl: string,
    path: string,
    pathParams: Record<string, unknown>,
    queryParams: Record<string, string>
): string {
    // Substitute path parameters
    let resolvedPath = path;
    for (const [key, value] of Object.entries(pathParams)) {
        resolvedPath = resolvedPath.replace(
            `{${key}}`,
            encodeURIComponent(String(value))
        );
    }

    const url = resolveBaseUrl(baseUrl, resolvedPath);

    // Append query parameters
    const queryEntries = Object.entries(queryParams);
    if (queryEntries.length === 0) {
        return url;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of queryEntries) {
        searchParams.append(key, value);
    }

    return `${url}?${searchParams.toString()}`;
}

/**
 * Extract authentication headers and query params from environment variables.
 *
 * @param auth - Auth configuration from schema
 * @param override - Optional override values (for testing)
 * @returns Headers and query params to add to requests
 * @throws AuthenticationError if required auth is missing
 */
export function getAuthConfig(
    auth: AuthConfig | undefined,
    override?: Record<string, string>
): { headers: Record<string, string>; queryParams: Record<string, string> } {
    const headers: Record<string, string> = {};
    const queryParams: Record<string, string> = {};

    if (!auth) {
        return { headers, queryParams };
    }

    // Handle API key auth
    if (auth.apiKey) {
        const value = override?.[auth.apiKey.envVar] ?? process.env[auth.apiKey.envVar];
        const isRequired = auth.apiKey.required !== false;

        if (!value && isRequired) {
            throw new AuthenticationError(
                `Missing required environment variable: ${auth.apiKey.envVar}`
            );
        }

        if (value) {
            if (auth.apiKey.type === "header") {
                headers[auth.apiKey.name] = value;
            } else {
                queryParams[auth.apiKey.name] = value;
            }
        }
    }

    // Handle bearer token auth
    if (auth.bearer) {
        const value = override?.[auth.bearer.envVar] ?? process.env[auth.bearer.envVar];
        const isRequired = auth.bearer.required !== false;

        if (!value && isRequired) {
            throw new AuthenticationError(
                `Missing required environment variable: ${auth.bearer.envVar}`
            );
        }

        if (value) {
            headers["Authorization"] = `Bearer ${value}`;
        }
    }

    return { headers, queryParams };
}

/**
 * Separate endpoint parameters by their location.
 *
 * @param endpoint - Endpoint definition
 * @param params - Parameter values from tool call
 * @returns Parameters grouped by location
 */
function separateParams(
    endpoint: EndpointDefinition,
    params: Record<string, unknown>
): {
    pathParams: Record<string, unknown>;
    queryParams: Record<string, string>;
    headerParams: Record<string, string>;
    bodyData: string | undefined;
} {
    const pathParams: Record<string, unknown> = {};
    const queryParams: Record<string, string> = {};
    const headerParams: Record<string, string> = {};
    const bodyParams: Record<string, unknown> = {};

    for (const paramDef of endpoint.parameters ?? []) {
        let value = params[paramDef.name];

        // Apply default if value is undefined
        if (value === undefined && paramDef.default !== undefined) {
            value = paramDef.default;
        }

        // Skip if still undefined
        if (value === undefined) {
            continue;
        }

        switch (paramDef.in) {
            case "path":
                pathParams[paramDef.name] = value;
                break;
            case "query":
                queryParams[paramDef.name] = String(value);
                break;
            case "header":
                headerParams[paramDef.name] = String(value);
                break;
            case "body":
                bodyParams[paramDef.name] = value;
                break;
        }
    }

    // Build body data from collected body parameters
    let bodyData: string | undefined;
    const bodyKeys = Object.keys(bodyParams);
    if (bodyKeys.length === 1) {
        // Single body param: use its value directly (backward compatible)
        const value = bodyParams[bodyKeys[0]];
        bodyData = typeof value === "string" ? value : JSON.stringify(value);
    } else if (bodyKeys.length > 1) {
        // Multiple body params: aggregate into a single JSON object
        bodyData = JSON.stringify(bodyParams);
    }

    return { pathParams, queryParams, headerParams, bodyData };
}

/**
 * Determine the jq filter to apply based on params and endpoint config.
 * @throws Error if an explicit preset name is provided but not found
 */
function resolveJqFilter(
    endpoint: EndpointDefinition,
    params: Record<string, unknown>
): string | undefined {
    // Check for filter preset selection
    const presetName = params.filter_preset as string | undefined;
    if (presetName && endpoint.response?.filterPresets) {
        // Compare sanitized names — the enum was built from sanitized names so the
        // LLM-supplied value is always a sanitized string, not the raw YAML value.
        const preset = endpoint.response.filterPresets.find(
            (p) => sanitizeDescription(p.name) === presetName
        );
        if (preset) {
            return preset.jqFilter;
        }
        // Preset explicitly requested but not found - throw error
        const available = endpoint.response.filterPresets
            .map((p) => sanitizeDescription(p.name))
            .join(", ");
        throw new Error(
            `Unknown filter preset "${presetName}". Available presets: ${available}`
        );
    }

    // Fall back to default filter
    return endpoint.response?.jqFilter;
}

/**
 * Create a tool handler for an endpoint.
 *
 * @param schema - Full API schema
 * @param endpoint - Endpoint definition
 * @param config - Generator configuration
 * @returns Tool handler function
 */
function createToolHandler(
    schema: ApiSchema,
    endpoint: EndpointDefinition,
    config?: GeneratorConfig
): (params: Record<string, unknown>, extra?: CurlExecuteExtra) => Promise<CurlExecuteResult> {
    return async (params: Record<string, unknown>, extra?: CurlExecuteExtra): Promise<CurlExecuteResult> => {
        try {
            // Separate parameters by location
            const { pathParams, queryParams, headerParams, bodyData } = separateParams(
                endpoint,
                params
            );

            // Get auth configuration
            const auth = getAuthConfig(schema.auth, config?.authOverride);

            // Build URL with path params and query params (including auth query params)
            // config.baseUrl takes precedence over schema.api.baseUrl to support staging/proxy redirects
            const url = buildUrl(
                config?.baseUrl ?? schema.api.baseUrl,
                endpoint.path,
                pathParams,
                { ...queryParams, ...auth.queryParams }
            );

            // Merge headers: defaults -> schema defaults -> auth -> endpoint params
            const mergedHeaders: Record<string, string> = {
                ...config?.defaultHeaders,
                ...schema.defaults?.headers,
                ...auth.headers,
                ...headerParams,
            };

            // Apply default User-Agent and Referer
            const defaults = applyDefaultHeaders(mergedHeaders, undefined, config);
            const headers = defaults.headers;
            if (defaults.userAgent !== undefined) headers["User-Agent"] = defaults.userAgent;

            // Determine jq filter
            const jqFilter = resolveJqFilter(endpoint, params);

            // Determine timeout
            const timeout = config?.timeout ?? schema.defaults?.timeout;

            // Execute the request using the existing curl executor
            // Merge allowLocalhost from config with extra context
            const execExtra: CurlExecuteExtra = {
                ...extra,
                allowLocalhost: config?.allowLocalhost ?? extra?.allowLocalhost,
            };
            return await executeCurlRequest(
                {
                    url,
                    method: endpoint.method,
                    headers: Object.keys(headers).length > 0 ? headers : undefined,
                    data: bodyData,
                    timeout,
                    jq_filter: jqFilter,
                    // Required fields with standard defaults
                    follow_redirects: true,
                    insecure: false,
                    verbose: false,
                    include_headers: false,
                    compressed: true,
                    include_metadata: false,
                },
                execExtra
            );
        } catch (error) {
            // Handle authentication errors gracefully
            if (error instanceof AuthenticationError) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Authentication error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }

            // Handle filter preset errors gracefully
            if (error instanceof Error && error.message.startsWith("Unknown filter preset")) {
                return {
                    content: [
                        {
                            type: "text",
                            text: error.message,
                        },
                    ],
                    isError: true,
                };
            }

            // Re-throw other errors
            throw error;
        }
    };
}

/**
 * Get MCP tool annotations based on HTTP method.
 * Indicates to clients the nature of the tool operation.
 *
 * @param method - HTTP method of the endpoint
 * @returns MCP tool annotations object
 */
export function getMethodAnnotations(method: HttpMethod) {
    return {
        readOnlyHint: method === "GET" || method === "HEAD" || method === "OPTIONS",
        destructiveHint: method === "DELETE",
        idempotentHint: method === "GET" || method === "PUT" || method === "HEAD" || method === "OPTIONS",
        openWorldHint: true,
    };
}

/**
 * Build tool description including parameter docs and filter presets.
 */
function buildToolDescription(endpoint: EndpointDefinition): string {
    const parts: string[] = [sanitizeDescription(endpoint.description)];

    // Document filter presets if available
    if (endpoint.response?.filterPresets?.length) {
        parts.push("");
        parts.push("Available filter presets:");
        for (const preset of endpoint.response.filterPresets) {
            const presetName = sanitizeDescription(preset.name);
            if (preset.description) {
                parts.push(`  - ${presetName}: ${sanitizeDescription(preset.description)}`);
            } else {
                parts.push(`  - ${presetName}: applies filter "${sanitizeDescription(preset.jqFilter)}"`);
            }
        }
    }

    return parts.join("\n");
}

/**
 * Register all endpoints from an API schema as MCP tools.
 *
 * @param server - MCP server instance
 * @param schema - Validated API schema
 * @param config - Optional generator configuration
 */
export function registerEndpointTools(
    server: McpServer,
    schema: ApiSchema,
    config?: GeneratorConfig
): void {
    for (const endpoint of schema.endpoints) {
        const inputSchema = generateInputSchema(endpoint);
        const handler = createToolHandler(schema, endpoint, config);

        server.registerTool(
            endpoint.id,
            {
                title: sanitizeDescription(endpoint.title),
                description: buildToolDescription(endpoint),
                inputSchema,
                annotations: getMethodAnnotations(endpoint.method),
            },
            handler
        );
    }
}

/**
 * Generate tool definitions without registering them.
 * Useful for inspection or custom registration.
 *
 * @param schema - Validated API schema
 * @returns Array of tool definitions with handlers
 */
export function generateToolDefinitions(
    schema: ApiSchema,
    config?: GeneratorConfig
): Array<{
    id: string;
    title: string;
    description: string;
    method: HttpMethod;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    handler: (params: Record<string, unknown>, extra?: CurlExecuteExtra) => Promise<CurlExecuteResult>;
}> {
    return schema.endpoints.map((endpoint) => ({
        id: endpoint.id,
        title: sanitizeDescription(endpoint.title),
        description: buildToolDescription(endpoint),
        method: endpoint.method,
        inputSchema: generateInputSchema(endpoint),
        handler: createToolHandler(schema, endpoint, config),
    }));
}
