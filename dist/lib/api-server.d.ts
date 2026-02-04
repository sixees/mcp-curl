import { McpCurlServer } from "./extensible/mcp-curl-server.js";
import type { GeneratorConfig } from "./schema/generator.js";
import type { McpCurlConfig } from "./types/public.js";
import type { ApiSchema } from "./schema/types.js";
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
export declare function createApiServer(options: CreateApiServerOptions): Promise<McpCurlServer>;
/**
 * Synchronous version of createApiServer for cases where schema is already loaded.
 * Use this when you have a pre-validated schema object.
 *
 * @param schema - Pre-validated API schema
 * @param options - Optional server configuration
 * @returns Configured McpCurlServer
 */
export declare function createApiServerSync(schema: ApiSchema, options?: Omit<CreateApiServerOptions, "definitionPath" | "definitionContent" | "schema">): McpCurlServer;
