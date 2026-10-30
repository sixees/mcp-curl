import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
* Input schema for the curl_execute tool on a server with no `baseUrl`.
* `CurlExecuteBaseUrlSchema` extends it for a server with one, so a relative
* `url` is accepted only where something resolves it.
*/
declare const CurlExecuteSchema: z.ZodObject<{
    url: z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>;
    method: z.ZodOptional<z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
        HEAD: "HEAD";
        OPTIONS: "OPTIONS";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    data: z.ZodOptional<z.ZodString>;
    form: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    follow_redirects: z.ZodDefault<z.ZodBoolean>;
    max_redirects: z.ZodOptional<z.ZodNumber>;
    insecure: z.ZodDefault<z.ZodBoolean>;
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
}, z.core.$strip>;
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
}, z.core.$strip>;
/** Inferred TypeScript type from JqQuerySchema */
type JqQueryInput = z.infer<typeof JqQuerySchema>;

/**
 * The hosts a request URL may name. `"any"` is the explicit opt-out; a list is
 * matched exactly after {@link canonicalHost}, and an empty list refuses every
 * request. `executeCurlRequest` checks it on the request URL and on every
 * followed redirect hop, before DNS.
 */
type HostPolicy = {
    readonly kind: "any";
} | {
    readonly kind: "list";
    readonly hosts: ReadonlySet<string>;
};
/**
 * The policy a server enforces. An explicit `allowedHosts` wins; left unset,
 * a server with a `baseUrl` may name only that host in a request URL, and one
 * without a `baseUrl` may name any host. The same list gates every followed
 * redirect hop. A `baseUrl` that cannot give a host throws
 * rather than yielding an empty or open list. The message does not echo the
 * `baseUrl`, which may carry credentials.
 */
declare function deriveHostPolicy(config: {
    readonly baseUrl?: string;
    readonly allowedHosts?: readonly string[] | "any";
}): HostPolicy;

/** Tool result type returned by executeCurlRequest */
interface CurlExecuteResult {
    [key: string]: unknown;
    /**
     * One entry per remote-controlled region, never one entry spanning two.
     *
     * `content[0]` is the body (or the server-authored saved-to-file message) on
     * every branch. After it, in this order and each only when present, come the
     * response header text and the server-authored notices — header truncation,
     * undetermined or unsupported headers, a lossy UTF-8 decode, a non-zero exit
     * code. Both are plain-branch only: under `include_metadata` the headers
     * travel in the envelope's `headers` key and the notices in its own fields.
     * ARCHITECTURE.md invariant 13; the wrap defends each entry independently,
     * which is what keeps invariant 16 true.
     */
    content: Array<{
        type: "text";
        text: string;
    }>;
    /** Set on a non-zero cURL exit, a local refusal and a thrown error. */
    isError?: boolean;
}
/** Extra context passed to tool handler */
interface CurlExecuteExtra {
    sessionId?: string;
    /** Override env var for allowing localhost requests (from McpCurlConfig) */
    allowLocalhost?: boolean;
    /**
     * The hosts this call may reach. `executeWithHooks` and
     * `InstanceUtilities.executeRequest` pass `deriveHostPolicy(config)`; a
     * generated YAML tool passes its generator config's `allowedHosts`, else
     * the caller's policy, else `"any"`; `createApiServer` supplies the
     * server's policy as that caller. `executor-call-sites.test.ts` checks only that
     * every call names a defined `hostPolicy` — what it evaluates to is the
     * behavioural tests' to show. A direct caller that passes none gets
     * `"any"`: that is the documented library default, and the SSRF gate
     * still runs.
     */
    hostPolicy?: HostPolicy;
}
/**
 * Execute a cURL request with the given parameters. The one executor every
 * entry point reaches: the registered `curl_execute` tool (through
 * `executeWithHooks`), `InstanceUtilities.executeRequest`, and generated
 * YAML tools.
 *
 * @param params - Validated curl_execute parameters
 * @param extra - Additional context (sessionId for rate limiting; allowLocalhost
 *   overrides the localhost SSRF guard for this call, from McpCurlConfig;
 *   hostPolicy is the host list checked on every hop's host before DNS,
 *   `"any"` when absent)
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
        /** Whether auth is required. Validator applies `default(true)` so the
         * runtime value is always a boolean. */
        required: boolean;
    };
    /** Bearer token authentication */
    bearer?: {
        /** Environment variable name containing the bearer token */
        envVar: string;
        /** Whether auth is required. Validator applies `default(true)` so the
         * runtime value is always a boolean. */
        required: boolean;
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
    /** Whether the parameter is required. Validator applies `default(false)`
     * so the runtime value is always a boolean. */
    required: boolean;
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
        /** Human-readable description for LLM context */
        description?: string;
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
    /**
     * Wrap YAML-driven tool responses in spotlighting sentinels.
     *
     * The response-side defence runs on every text part regardless of this flag —
     * the full `defendText` pipeline on non-JSON text, detection alone on a JSON
     * document, which is returned unchanged — and the flag only adds the
     * `applySpotlighting` step, on every result but this server's own error
     * text (`docs/architecture/architecture.md` → *Spotlighting*). Mirrors
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
declare function generateInputSchema(endpoint: EndpointDefinition): z.ZodObject<z.ZodRawShape>;
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

export { type ApiDefaults as A, type CurlExecuteInput as C, type EndpointDefinition as E, type GeneratorConfig as G, type HostPolicy as H, type JqQueryInput as J, type ParameterLocation as P, type ResponseConfig as R, CurlExecuteSchema as a, JqQuerySchema as b, type ApiInfo as c, deriveHostPolicy as d, executeCurlRequest as e, type ApiSchema as f, type ApiSchemaVersion as g, type AuthConfig as h, AuthenticationError as i, type EndpointParameter as j, type HttpMethod as k, type ParameterType as l, buildUrl as m, generateInputSchema as n, generateToolDefinitions as o, getAuthConfig as p, getMethodAnnotations as q, registerEndpointTools as r, type CurlExecuteResult as s };
