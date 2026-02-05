import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiSchema, EndpointDefinition, AuthConfig, HttpMethod } from "./types.js";
import { type CurlExecuteResult } from "../tools/curl-execute.js";
/**
 * Error thrown when authentication is required but not available.
 */
export declare class AuthenticationError extends Error {
    constructor(message: string);
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
}
/**
 * Generate a Zod input schema from endpoint parameter definitions.
 *
 * @param endpoint - Endpoint definition with parameters
 * @returns Zod object schema for the endpoint
 */
export declare function generateInputSchema(endpoint: EndpointDefinition): z.ZodObject<z.ZodRawShape>;
/**
 * Build the full URL with path parameter substitution and query params.
 *
 * @param baseUrl - API base URL
 * @param path - Endpoint path with {param} placeholders
 * @param pathParams - Values for path parameters
 * @param queryParams - Query parameters to append
 * @returns Fully constructed URL
 */
export declare function buildUrl(baseUrl: string, path: string, pathParams: Record<string, unknown>, queryParams: Record<string, string>): string;
/**
 * Extract authentication headers and query params from environment variables.
 *
 * @param auth - Auth configuration from schema
 * @param override - Optional override values (for testing)
 * @returns Headers and query params to add to requests
 * @throws AuthenticationError if required auth is missing
 */
export declare function getAuthConfig(auth: AuthConfig | undefined, override?: Record<string, string>): {
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
export declare function getMethodAnnotations(method: HttpMethod): {
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
export declare function registerEndpointTools(server: McpServer, schema: ApiSchema, config?: GeneratorConfig): void;
/**
 * Generate tool definitions without registering them.
 * Useful for inspection or custom registration.
 *
 * @param schema - Validated API schema
 * @returns Array of tool definitions with handlers
 */
export declare function generateToolDefinitions(schema: ApiSchema, config?: GeneratorConfig): Array<{
    id: string;
    title: string;
    description: string;
    method: HttpMethod;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    handler: (params: Record<string, unknown>) => Promise<CurlExecuteResult>;
}>;
