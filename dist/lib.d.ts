export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities } from './api-server-2OaCkild.js';
export { A as ApiDefaults, a as ApiInfo, b as ApiSchema, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, C as CurlExecuteInput, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, J as JqQueryInput, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, r as registerEndpointTools } from './generator-Ctr639v0.js';
export { ApiSchemaLoadError, ApiSchemaValidationError, ApiSchemaValidator, loadApiSchema, loadApiSchemaFromString, validateApiSchema } from './lib/schema/index.js';
import { z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Zod schema for a URL restricted to http/https schemes.
 *
 * z.url() in Zod v4 accepts any WHATWG-valid URL (including javascript:, data:, ftp://);
 * the .refine() is the sole scheme enforcement at the schema layer. Uses the WHATWG URL
 * parser (matching how src/lib/security/ssrf.ts and Node fetch resolve URLs) so the schema
 * agrees with what the network layer will actually parse — a URL that string-splits to
 * "http:" but parses to a different scheme would otherwise pass the schema and surprise
 * the SSRF check.
 */
declare function httpOnlyUrl(description: string): z.ZodURL;

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
/**
 * Sanitize HTTP response content before returning to LLM.
 *
 * Single-pass sanitization:
 * 1. Unicode attack vectors (bidi overrides, zero-width chars, Tags block, etc.) → removed
 * 2. Whitespace-padding runs (50+ consecutive spaces) → collapsed to a single space
 *
 * Normal whitespace (\t, \n, \r) is preserved to maintain response formatting.
 *
 * Whitespace runs collapse to a single space (rather than a marker like
 * "[WHITESPACE REMOVED]") because callers may JSON.parse the sanitized output
 * (see response/processor.ts → applyJqFilterToParsed). Inserting a non-whitespace
 * marker into the middle of a JSON document — between tokens or inside a deeply
 * pretty-printed value — would break the parse. A single space preserves
 * JSON validity while still neutralising the padding attack (the hidden tail
 * is no longer hidden behind a wall of whitespace), and detectInjectionPattern
 * still fires on the collapsed content for observability.
 *
 * @param input - Response content to sanitize (null/undefined returns "")
 * @returns Sanitized content
 */
declare function sanitizeResponse(input: string | null | undefined): string;
/**
 * Scan content for prompt injection patterns.
 * Observability-only: never suppresses or modifies the content.
 *
 * Call this on sanitized content so that invisible-char-split phrases
 * (e.g., "Ig​nore" → "Ignore" after sanitizeResponse) are detectable.
 *
 * @param input - Content to scan (already sanitized)
 * @returns true if any injection pattern matched
 */
declare function detectInjectionPattern(input: string): boolean;
/**
 * Wrap response content with per-request trust-boundary sentinels (spotlighting).
 *
 * Uses opaque UUID-based delimiters that cannot appear naturally in text or markup,
 * preventing a hostile payload from terminating the sentinel region early.
 * XML-style tags (`<response>...</response>`) are NOT used because a payload containing
 * `</response>` would break out of the trusted region.
 *
 * Uses the caller-provided requestId (a fresh UUID per request, never a module-level constant)
 * to make cross-turn sentinel reuse attacks impractical.
 *
 * @param content - Response content to wrap
 * @param requestId - Unique identifier for this response (caller should pass randomUUID())
 * @returns Content wrapped in opaque sentinel delimiters
 */
declare function applySpotlighting(content: string, requestId: string): string;

export { MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH, applySpotlighting, detectInjectionPattern, httpOnlyUrl, sanitizeDescription, sanitizeResponse };
