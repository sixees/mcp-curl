export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities } from './api-server-2OaCkild.js';
export { A as ApiDefaults, a as ApiInfo, b as ApiSchema, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, C as CurlExecuteInput, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, J as JqQueryInput, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, r as registerEndpointTools } from './generator-Ctr639v0.js';
export { ApiSchemaLoadError, ApiSchemaValidationError, ApiSchemaValidator, loadApiSchema, loadApiSchemaFromString, validateApiSchema } from './lib/schema/index.js';
import '@modelcontextprotocol/sdk/server/mcp.js';
import 'zod';

/**
 * Maximum length for custom tool descriptions.
 * Clients (OpenAI-compatible) truncate descriptions beyond ~1024 chars;
 * staying under 1000 provides a safe margin.
 */
declare const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;
/**
 * Sanitize a string for use in tool metadata or prompt templates.
 * Strips dangerous Unicode attack vectors (bidi overrides, zero-width chars, soft hyphen,
 * variation selectors, Tags block) while preserving normal whitespace (\t, \n, \r, space)
 * and all printable characters.
 *
 * @param input - String to sanitize (null/undefined returns "")
 * @returns Sanitized string with attack characters replaced by space
 */
declare function sanitizeDescription(input: string | null | undefined): string;

export { MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH, sanitizeDescription };
