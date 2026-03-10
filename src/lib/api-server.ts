// src/lib/api-server.ts
// Factory function for creating API servers from YAML definitions

import { McpCurlServer } from "./extensible/mcp-curl-server.js";
import { loadApiSchema, loadApiSchemaFromString } from "./schema/loader.js";
import { generateToolDefinitions, getMethodAnnotations } from "./schema/generator.js";
import type { GeneratorConfig } from "./schema/generator.js";
import type { McpCurlConfig } from "./types/public.js";
import type { ApiSchema } from "./schema/types.js";

/**
 * Configure server with schema defaults and register tools.
 * Shared logic between sync and async factory functions.
 */
function configureServerFromSchema(
    server: McpCurlServer,
    schema: ApiSchema,
    options: ApiServerOptionsBase
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
    // Merge user config overrides (baseUrl, allowLocalhost) into generator config
    const mergedConfig = { ...schemaConfig, ...options.config };
    const generatorConfig: GeneratorConfig = {
        defaultHeaders: schema.defaults?.headers,
        timeout: schema.defaults?.timeout,
        baseUrl: mergedConfig.baseUrl,
        allowLocalhost: mergedConfig.allowLocalhost,
        defaultUserAgent: mergedConfig.defaultUserAgent,
        defaultReferer: mergedConfig.defaultReferer,
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
export type CreateApiServerOptions =
    | ApiServerFromPath
    | ApiServerFromContent
    | ApiServerFromSchema;

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
    options: ApiServerOptionsBase = {}
): McpCurlServer {
    const server = new McpCurlServer();
    configureServerFromSchema(server, schema, options);

    return server;
}
