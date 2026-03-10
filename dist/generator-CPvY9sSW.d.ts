import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Schema for structured cURL execution.
 * Validates all parameters for the curl_execute tool.
 */
declare const CurlExecuteSchema: z.ZodObject<{
    url: z.ZodEffects<z.ZodString, string, string>;
    method: z.ZodOptional<z.ZodEnum<["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    data: z.ZodOptional<z.ZodString>;
    form: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    follow_redirects: z.ZodDefault<z.ZodBoolean>;
    max_redirects: z.ZodOptional<z.ZodNumber>;
    insecure: z.ZodDefault<z.ZodBoolean>;
    /**
     * Request timeout in seconds.
     * Optional - if not provided, defaults are applied in this order:
     * 1. McpCurlConfig.defaultTimeout (if configured)
     * 2. LIMITS.DEFAULT_TIMEOUT_MS / 1000 (30 seconds)
     *
     * Note: This field intentionally has no .default() to distinguish between
     * "user explicitly passed 30" vs "user didn't provide a value".
     */
    timeout: z.ZodOptional<z.ZodNumber>;
    user_agent: z.ZodOptional<z.ZodString>;
    basic_auth: z.ZodOptional<z.ZodString>;
    bearer_token: z.ZodOptional<z.ZodString>;
    verbose: z.ZodDefault<z.ZodBoolean>;
    include_headers: z.ZodDefault<z.ZodBoolean>;
    compressed: z.ZodDefault<z.ZodBoolean>;
    include_metadata: z.ZodDefault<z.ZodBoolean>;
    jq_filter: z.ZodOptional<z.ZodString>;
    max_result_size: z.ZodOptional<z.ZodNumber>;
    save_to_file: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    follow_redirects: boolean;
    insecure: boolean;
    verbose: boolean;
    include_headers: boolean;
    compressed: boolean;
    include_metadata: boolean;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
    headers?: Record<string, string> | undefined;
    data?: string | undefined;
    form?: Record<string, string> | undefined;
    max_redirects?: number | undefined;
    timeout?: number | undefined;
    user_agent?: string | undefined;
    basic_auth?: string | undefined;
    bearer_token?: string | undefined;
    jq_filter?: string | undefined;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}, {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | undefined;
    headers?: Record<string, string> | undefined;
    data?: string | undefined;
    form?: Record<string, string> | undefined;
    follow_redirects?: boolean | undefined;
    max_redirects?: number | undefined;
    insecure?: boolean | undefined;
    timeout?: number | undefined;
    user_agent?: string | undefined;
    basic_auth?: string | undefined;
    bearer_token?: string | undefined;
    verbose?: boolean | undefined;
    include_headers?: boolean | undefined;
    compressed?: boolean | undefined;
    include_metadata?: boolean | undefined;
    jq_filter?: string | undefined;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}>;
/** Inferred TypeScript type from CurlExecuteSchema */
type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;
/**
 * Schema for jq_query tool (query JSON files without HTTP requests).
 */
declare const JqQuerySchema: z.ZodObject<{
    filepath: z.ZodString;
    jq_filter: z.ZodString;
    max_result_size: z.ZodOptional<z.ZodNumber>;
    save_to_file: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    jq_filter: string;
    filepath: string;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}, {
    jq_filter: string;
    filepath: string;
    max_result_size?: number | undefined;
    save_to_file?: boolean | undefined;
    output_dir?: string | undefined;
}>;
/** Inferred TypeScript type from JqQuerySchema */
type JqQueryInput = z.infer<typeof JqQuerySchema>;

/** Tool result type returned by executeCurlRequest */
interface CurlExecuteResult {
    [key: string]: unknown;
    content: [{
        type: "text";
        text: string;
    }];
    isError?: boolean;
}
/** Extra context passed to tool handler */
interface CurlExecuteExtra {
    sessionId?: string;
    /** Override env var for allowing localhost requests (from McpCurlConfig) */
    allowLocalhost?: boolean;
}
/**
 * Execute a cURL request with the given parameters.
 * This is the core handler logic extracted for reuse by McpCurlServer.
 *
 * @param params - Validated curl_execute parameters
 * @param extra - Additional context (sessionId for rate limiting)
 * @returns Tool result with response content
 */
declare function executeCurlRequest(params: CurlExecuteInput, extra?: CurlExecuteExtra): Promise<CurlExecuteResult>;

/**
 * API Schema version for forward compatibility.
 * New versions can introduce breaking changes with migration support.
 */
type ApiSchemaVersion = "1.0";
/**
 * Authentication configuration for API requests.
 * Supports API key (query/header) and bearer token auth.
 * All values are injected from environment variables.
 */
interface AuthConfig {
    /** API key authentication */
    apiKey?: {
        /** Where to place the API key */
        type: "query" | "header";
        /** Parameter or header name (e.g., "key", "X-API-Key") */
        name: string;
        /** Environment variable name containing the API key */
        envVar: string;
        /** Whether auth is required (default: true) */
        required?: boolean;
    };
    /** Bearer token authentication */
    bearer?: {
        /** Environment variable name containing the bearer token */
        envVar: string;
        /** Whether auth is required (default: true) */
        required?: boolean;
    };
}
/**
 * Where a parameter is placed in the HTTP request.
 */
type ParameterLocation = "path" | "query" | "header" | "body";
/**
 * Supported parameter types for endpoints.
 */
type ParameterType = "string" | "number" | "boolean" | "integer";
/**
 * Single parameter definition for an endpoint.
 */
interface EndpointParameter {
    /** Parameter name */
    name: string;
    /** Where to place this parameter */
    in: ParameterLocation;
    /** Parameter type for validation */
    type: ParameterType;
    /** Whether the parameter is required (default: false) */
    required?: boolean;
    /** Description for LLM context */
    description?: string;
    /** Default value if not provided */
    default?: string | number | boolean;
    /** Allowed values (creates enum constraint) */
    enum?: (string | number)[];
}
/**
 * Response processing configuration for an endpoint.
 */
interface ResponseConfig {
    /** Default jq filter to apply to responses */
    jqFilter?: string;
    /** Named filter presets users can select */
    filterPresets?: Array<{
        /** Preset name for selection */
        name: string;
        /** jq filter expression */
        jqFilter: string;
    }>;
}
/**
 * HTTP methods supported by endpoints.
 */
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
/**
 * Single endpoint definition that generates an MCP tool.
 */
interface EndpointDefinition {
    /** Tool name (lowercase with underscores, e.g., "get_user") */
    id: string;
    /** URL path with {param} placeholders (e.g., "/users/{id}") */
    path: string;
    /** HTTP method */
    method: HttpMethod;
    /** Human-readable title for the tool */
    title: string;
    /** Description providing LLM context */
    description: string;
    /** Parameter definitions */
    parameters?: EndpointParameter[];
    /** Response processing configuration */
    response?: ResponseConfig;
}
/**
 * API metadata in the schema.
 */
interface ApiInfo {
    /** Machine-readable API name */
    name: string;
    /** Human-readable API title */
    title: string;
    /** Description for LLM context */
    description: string;
    /** API version string */
    version: string;
    /** Base URL for all endpoints */
    baseUrl: string;
}
/**
 * Default settings applied to all endpoints.
 */
interface ApiDefaults {
    /** Default request timeout in seconds */
    timeout?: number;
    /** Default headers for all requests */
    headers?: Record<string, string>;
}
/**
 * Complete API schema definition.
 * This is the root structure of a YAML API definition file.
 */
interface ApiSchema {
    /** Schema version for compatibility */
    apiVersion: ApiSchemaVersion;
    /** API metadata */
    api: ApiInfo;
    /** Authentication configuration */
    auth?: AuthConfig;
    /** Default settings */
    defaults?: ApiDefaults;
    /** Endpoint definitions */
    endpoints: EndpointDefinition[];
}

/**
 * Error thrown when authentication is required but not available.
 */
declare class AuthenticationError extends Error {
    constructor(message: string);
}
/**
 * Configuration for generating endpoint tools.
 */
interface GeneratorConfig {
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
declare function generateInputSchema(endpoint: EndpointDefinition): z.ZodObject<z.ZodRawShape>;
/**
 * Build the full URL with path parameter substitution and query params.
 *
 * @param baseUrl - API base URL
 * @param path - Endpoint path with {param} placeholders
 * @param pathParams - Values for path parameters
 * @param queryParams - Query parameters to append
 * @returns Fully constructed URL
 */
declare function buildUrl(baseUrl: string, path: string, pathParams: Record<string, unknown>, queryParams: Record<string, string>): string;
/**
 * Extract authentication headers and query params from environment variables.
 *
 * @param auth - Auth configuration from schema
 * @param override - Optional override values (for testing)
 * @returns Headers and query params to add to requests
 * @throws AuthenticationError if required auth is missing
 */
declare function getAuthConfig(auth: AuthConfig | undefined, override?: Record<string, string>): {
    headers: Record<string, string>;
    queryParams: Record<string, string>;
};
/**
 * Get MCP tool annotations based on HTTP method.
 * Indicates to clients the nature of the tool operation.
 *
 * @param method - HTTP method of the endpoint
 * @returns MCP tool annotations object
 */
declare function getMethodAnnotations(method: HttpMethod): {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
};
/**
 * Register all endpoints from an API schema as MCP tools.
 *
 * @param server - MCP server instance
 * @param schema - Validated API schema
 * @param config - Optional generator configuration
 */
declare function registerEndpointTools(server: McpServer, schema: ApiSchema, config?: GeneratorConfig): void;
/**
 * Generate tool definitions without registering them.
 * Useful for inspection or custom registration.
 *
 * @param schema - Validated API schema
 * @returns Array of tool definitions with handlers
 */
declare function generateToolDefinitions(schema: ApiSchema, config?: GeneratorConfig): Array<{
    id: string;
    title: string;
    description: string;
    method: HttpMethod;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    handler: (params: Record<string, unknown>, extra?: CurlExecuteExtra) => Promise<CurlExecuteResult>;
}>;

export { type ApiDefaults as A, type CurlExecuteInput as C, type EndpointDefinition as E, type GeneratorConfig as G, type HttpMethod as H, type JqQueryInput as J, type ParameterLocation as P, type ResponseConfig as R, type ApiInfo as a, type ApiSchema as b, type ApiSchemaVersion as c, type AuthConfig as d, AuthenticationError as e, type EndpointParameter as f, type ParameterType as g, buildUrl as h, generateInputSchema as i, generateToolDefinitions as j, getAuthConfig as k, CurlExecuteSchema as l, JqQuerySchema as m, executeCurlRequest as n, type CurlExecuteResult as o, getMethodAnnotations as p, registerEndpointTools as r };
