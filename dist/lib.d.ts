export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities } from './api-server-BgqSkYkj.js';
export { A as ApiDefaults, a as ApiInfo, b as ApiSchema, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, C as CurlExecuteInput, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, J as JqQueryInput, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, r as registerEndpointTools } from './generator-BE50DdFe.js';
export { ApiSchemaLoadError, ApiSchemaValidationError, ApiSchemaValidator, loadApiSchema, loadApiSchemaFromString, validateApiSchema } from './lib/schema/index.js';
import { z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Options for `createHttpOnlyUrlSchema`.
 */
interface CreateHttpOnlyUrlSchemaOptions {
    /**
     * Caller-facing description registered with Zod's `.describe()`. Surfaced to
     * MCP clients via `globalRegistry`, so phrase it in terms of *what the URL
     * is for* (e.g. "Base URL of the API"), not in terms of the scheme rule —
     * the scheme rule is enforced by this helper and shouldn't leak into every
     * call-site description.
     */
    description?: string;
    /**
     * Custom validation error message returned when the URL parses but uses a
     * disallowed scheme. Defaults to "URL must use http or https scheme".
     */
    message?: string;
}
/**
 * Create a Zod schema for a URL restricted to the http/https allowlist.
 *
 * Strict HTTP/HTTPS-only by design — the allowlist is the single source of
 * truth in `config/security/url-schemes.ts`, shared with the DNS layer
 * (`security/ssrf.ts`) and the cURL transport (`execution/curl-args-builder.ts`).
 * **Do not relax this helper to add `mailto:`, `data:`, etc. under pressure.**
 * If a different allowlist is ever needed, add a separate
 * `createUrlSchemaWithSchemes(allowedSchemes, options)` factory rather than
 * widening the strict default — defence-in-depth across three layers depends
 * on this list staying narrow.
 *
 * Validation logic:
 * - `z.url()` accepts any WHATWG-valid URL (including `javascript:`, `data:`,
 *   `ftp://`); the `.refine()` is the sole scheme enforcement at the schema
 *   layer.
 * - Uses the WHATWG URL parser (matching `security/ssrf.ts` and Node fetch),
 *   so the schema agrees with what the network layer will actually parse — a
 *   URL that string-splits to "http:" but parses to a different scheme would
 *   otherwise pass the schema and surprise the SSRF check.
 *
 * Return type is pinned to `z.ZodType<string>` rather than the inferred
 * `ZodEffects<ZodURL>` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * @param options - Optional `description` (default: "URL (http or https)") and `message`.
 * @returns A Zod schema validating a string is an http/https URL.
 */
declare function createHttpOnlyUrlSchema(options?: CreateHttpOnlyUrlSchemaOptions): z.ZodType<string>;

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

export { type CreateHttpOnlyUrlSchemaOptions, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH, applySpotlighting, createHttpOnlyUrlSchema, detectInjectionPattern, sanitizeDescription, sanitizeResponse };
