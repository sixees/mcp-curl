// src/lib/api-server.ts
// Factory function for creating API servers from YAML definitions

import { McpCurlServer } from "./extensible/mcp-curl-server.js";
import { loadApiSchema, loadApiSchemaFromString } from "./schema/loader.js";
import { generateToolDefinitions } from "./schema/generator.js";
import type { GeneratorConfig } from "./schema/generator.js";
import type { McpCurlConfig } from "./types/public.js";
import type { ApiSchema, HttpMethod } from "./schema/types.js";

/**
 * Get MCP tool annotations based on HTTP method.
 * Matches the logic in generator.ts registerEndpointTools.
 */
function getMethodAnnotations(method: HttpMethod) {
    return {
        readOnlyHint: method === "GET" || method === "HEAD" || method === "OPTIONS",
        destructiveHint: method === "DELETE",
        idempotentHint: method === "GET" || method === "PUT" || method === "HEAD" || method === "OPTIONS",
        openWorldHint: true,
    };
}

/**
 * Configure server with schema defaults and register tools.
 * Shared logic between sync and async factory functions.
 */
function configureServerFromSchema(
    server: McpCurlServer,
    schema: ApiSchema,
    options: Omit<CreateApiServerOptions, "definitionPath" | "definitionContent" | "schema">
): void {
    // Apply schema-derived configuration
    const schemaConfig: Partial<McpCurlConfig> = {
        baseUrl: schema.api.baseUrl,
    };

    if (schema.defaults?.headers) {
        schemaConfig.defaultHeaders = schema.defaults.headers;
    }

    if (schema.defaults?.timeout) {
        schemaConfig.defaultTimeout = schema.defaults.timeout;
    }

    // Merge with user-provided config (user config takes precedence)
    server.configure({
        ...schemaConfig,
        ...options.config,
    });

    // Disable default tools if requested
    if (options.disableCurlExecute) {
        server.disableCurlExecute();
    }

    if (options.disableJqQuery) {
        server.disableJqQuery();
    }

    // Generate and register custom tools from endpoints
    const generatorConfig: GeneratorConfig = {
        defaultHeaders: schema.defaults?.headers,
        timeout: schema.defaults?.timeout,
        ...options.generatorConfig,
    };

    const toolDefs = generateToolDefinitions(schema, generatorConfig);

    for (const toolDef of toolDefs) {
        server.registerCustomTool(
            toolDef.id,
            {
                title: toolDef.title,
                description: toolDef.description,
                inputSchema: toolDef.inputSchema,
                annotations: getMethodAnnotations(toolDef.method),
            },
            toolDef.handler
        );
    }
}

/**
 * Options for creating an API server from a schema definition.
 */
export interface CreateApiServerOptions {
    /** Path to YAML definition file */
    definitionPath?: string;
    /** YAML content as string (alternative to definitionPath) */
    definitionContent?: string;
    /** Pre-loaded schema (alternative to definitionPath/definitionContent) */
    schema?: ApiSchema;
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
export async function createApiServer(
    options: CreateApiServerOptions
): Promise<McpCurlServer> {
    // Load schema from the appropriate source
    let schema: ApiSchema;

    if (options.schema) {
        schema = options.schema;
    } else if (options.definitionPath) {
        schema = await loadApiSchema(options.definitionPath);
    } else if (options.definitionContent) {
        schema = loadApiSchemaFromString(options.definitionContent);
    } else {
        throw new Error(
            "Must provide one of: definitionPath, definitionContent, or schema"
        );
    }

    // Create server instance and configure from schema
    const server = new McpCurlServer();
    configureServerFromSchema(server, schema, options);

    return server;
}

/**
 * Synchronous version of createApiServer for cases where schema is already loaded.
 * Use this when you have a pre-validated schema object.
 *
 * @param schema - Pre-validated API schema
 * @param options - Optional server configuration
 * @returns Configured McpCurlServer
 */
export function createApiServerSync(
    schema: ApiSchema,
    options: Omit<CreateApiServerOptions, "definitionPath" | "definitionContent" | "schema"> = {}
): McpCurlServer {
    const server = new McpCurlServer();
    configureServerFromSchema(server, schema, options);

    return server;
}
