// src/lib/schema/generator.ts
// Generates MCP tools from API schema endpoint definitions.
//
// **Sanitisation contract.** Schemas reaching this module are
// pre-sanitised by the `z.preprocess()` step on `ApiSchemaValidator` in
// `src/lib/schema/validator.ts`. Every user-facing string field is already
// stripped of bidi/zero-width/Tags-block characters before reaching here.
// Do **not** re-sanitise.
//
// The single named exception is `renderJqFilterForDisplay()` below: the
// validator deliberately leaves `preset.jqFilter` raw so the engine
// receives the author's filter unchanged; only the human-readable copy
// interpolated into the tool description is cleaned. A test
// (`generator.ts has at most one sanitizeDescription call`) guards the
// boundary against drift.

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
import { hasDotSegment, LocalRefusalError, resolveBaseUrl, sanitizeDescription, safeHostname } from "../utils/index.js";
import { applyDefaultHeaders, ANY_HOST_POLICY, deriveHostPolicy } from "../config/index.js";
import { createWrapper } from "../response/post-processor.js";

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
    /**
     * Wrap YAML-driven tool responses in spotlighting sentinels.
     *
     * The response-side defence runs on every text part regardless of this flag —
     * the full `defendText` pipeline on non-JSON text, detection alone on a JSON
     * document, which is returned unchanged — and the flag only adds the
     * `applySpotlighting` step, never on an error result. Mirrors
     * `McpCurlConfig.enableSpotlighting` so the YAML path inherits the same
     * setting from `createApiServer({ config })` callers without a separate
     * knob.
     */
    enableSpotlighting?: boolean;
    /**
     * The hosts these tools may reach, in `McpCurlConfig.allowedHosts`'s form
     * and validated the same way: an invalid entry throws when the tools are
     * generated. Set, it wins over the caller's `extra.hostPolicy`; unset, a
     * tool takes the caller's, and with neither it may reach any host, which
     * is the library default for a caller that builds tools without a server.
     * `createApiServer` leaves it unset and passes the server's own policy at
     * call time. The SSRF gate still runs either way.
     */
    allowedHosts?: readonly string[] | "any";
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
            schema = schema.describe(param.description);
        }

        if (!param.required) {
            schema = schema.optional();
        }

        shape[param.name] = schema;
    }

    if (endpoint.response?.filterPresets?.length) {
        const presetNames = endpoint.response.filterPresets.map((p) => p.name);
        shape.filter_preset = buildStringEnum(presetNames)
            .optional()
            .describe("Apply a predefined response filter");
    }

    return z.object(shape);
}

/**
 * Build a string enum schema, using z.literal() for a single-element array
 * instead of z.enum() to produce a narrower single-value schema.
 */
function buildStringEnum(values: string[]): z.ZodTypeAny {
    if (values.length === 1) return z.literal(values[0]);
    return z.enum(values as [string, ...string[]]);
}

/**
 * Build a number union schema, using z.literal() for a single-element array
 * instead of z.union() to produce a narrower single-value schema.
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
 * A path parameter that would make a `.` or `..` path segment. Module-private:
 * `createToolHandler` turns it into an error result.
 */
/**
 * Build the full URL with path parameter substitution and query params.
 *
 * @param baseUrl - API base URL
 * @param path - Endpoint path with {param} placeholders
 * @param pathParams - Values for path parameters
 * @param queryParams - Query parameters to append
 * @returns Fully constructed URL
 * @throws LocalRefusalError (`LOCAL_REFUSED_PATH`) if a path parameter makes a `.` or `..` path segment.
 *   `encodeURIComponent` keeps a value inside one segment but leaves `.`
 *   alone, so `{id}` set to `..` would request the endpoint's parent.
 */
export function buildUrl(
    baseUrl: string,
    path: string,
    pathParams: Record<string, unknown>,
    queryParams: Record<string, string>
): string {
    let resolvedPath = path;
    for (const [key, value] of Object.entries(pathParams)) {
        resolvedPath = resolvedPath.replace(
            `{${key}}`,
            encodeURIComponent(String(value))
        );
    }

    if (hasDotSegment(resolvedPath)) {
        throw new LocalRefusalError({ code: "LOCAL_REFUSED_PATH", reason: "path-parameter-dot-segment" });
    }

    const url = resolveBaseUrl(baseUrl, resolvedPath);

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

    if (auth.apiKey) {
        const value = override?.[auth.apiKey.envVar] ?? process.env[auth.apiKey.envVar];

        if (!value && auth.apiKey.required) {
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

    if (auth.bearer) {
        const value = override?.[auth.bearer.envVar] ?? process.env[auth.bearer.envVar];

        if (!value && auth.bearer.required) {
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

        if (value === undefined && paramDef.default !== undefined) {
            value = paramDef.default;
        }

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
    const presetName = params.filter_preset as string | undefined;
    if (presetName && endpoint.response?.filterPresets) {
        const preset = endpoint.response.filterPresets.find(
            (p) => p.name === presetName
        );
        if (preset) {
            return preset.jqFilter;
        }
        // Preset explicitly requested but not found - throw error
        const available = endpoint.response.filterPresets
            .map((p) => p.name)
            .join(", ");
        throw new Error(
            `Unknown filter preset "${presetName}". Available presets: ${available}`
        );
    }

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
    // Build the wrap once per handler — the spotlighting flag is server-scope
    // and identical across every invocation. The closure is cheap; this just
    // skips re-allocating it on every tool call.
    const wrap = createWrapper({ enableSpotlighting: config?.enableSpotlighting });
    const configPolicy =
        config?.allowedHosts === undefined ? undefined : deriveHostPolicy({ allowedHosts: config.allowedHosts });

    return async (params: Record<string, unknown>, extra?: CurlExecuteExtra): Promise<CurlExecuteResult> => {
        try {
            const { pathParams, queryParams, headerParams, bodyData } = separateParams(
                endpoint,
                params
            );

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

            const defaults = applyDefaultHeaders(mergedHeaders, undefined, config);
            const headers = defaults.headers;
            if (defaults.userAgent !== undefined) headers["User-Agent"] = defaults.userAgent;

            const jqFilter = resolveJqFilter(endpoint, params);

            const timeout = config?.timeout ?? schema.defaults?.timeout;

            // The generator config's allowLocalhost and allowedHosts win; the caller's
            // extra applies only where the config leaves them unset.
            const execExtra: CurlExecuteExtra = {
                ...extra,
                allowLocalhost: config?.allowLocalhost ?? extra?.allowLocalhost,
                hostPolicy: configPolicy ?? extra?.hostPolicy ?? ANY_HOST_POLICY,
            };
            const result = await executeCurlRequest(
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
            // Run the response-side defence on the YAML-tool result: the full
            // `defendText` pipeline on non-JSON text and detection alone on a
            // JSON document, which is returned unchanged. The wrap is
            // idempotent on already-wrapped results, and the request hostname
            // is the right per-call label here (rather than "custom" if the
            // result then flows through the registerToolsOnServer adapter).
            return wrap(result, safeHostname(url));
        } catch (error) {
            // A missing required credential is configuration the model can report back, so it returns as an error result; anything unrecognised is rethrown.
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

            if (error instanceof LocalRefusalError) {
                return {
                    content: [{ type: "text", text: error.message }],
                    isError: true,
                };
            }

            // Matched by message prefix, because `resolveJqFilter` throws a plain Error:
            // its "Unknown filter preset" wording is what this check depends on.
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
 * Render a `preset.jqFilter` for interpolation into LLM-visible description
 * text. The validator deliberately leaves `jqFilter` raw so the engine
 * receives the author's filter unchanged; this helper is the single point
 * where the human-readable copy gets cleaned, keeping the trust boundary
 * documented by structure rather than by per-callsite comments.
 */
function renderJqFilterForDisplay(jqFilter: string): string {
    return sanitizeDescription(jqFilter);
}

/**
 * Build tool description including parameter docs and filter presets.
 */
function buildToolDescription(endpoint: EndpointDefinition): string {
    const parts: string[] = [endpoint.description];

    if (endpoint.response?.filterPresets?.length) {
        parts.push("");
        parts.push("Available filter presets:");
        for (const preset of endpoint.response.filterPresets) {
            if (preset.description) {
                parts.push(`  - ${preset.name}: ${preset.description}`);
            } else {
                parts.push(`  - ${preset.name}: applies filter "${renderJqFilterForDisplay(preset.jqFilter)}"`);
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
                title: endpoint.title,
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
        title: endpoint.title,
        description: buildToolDescription(endpoint),
        method: endpoint.method,
        inputSchema: generateInputSchema(endpoint),
        handler: createToolHandler(schema, endpoint, config),
    }));
}
