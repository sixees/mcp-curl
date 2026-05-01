// src/lib.ts
// Library entry point for programmatic usage of mcp-curl
//
// This module exports the extensible McpCurlServer class and all public types
// for building custom MCP servers with cURL capabilities.
//
// Public-barrel structure (kept flat for now; future PRs adding more security
// helpers should append within the relevant section, not invent new sections):
//
//   1. Server class                     — McpCurlServer + CustomToolMeta
//   2. Instance utilities               — createInstanceUtilities + types
//   3. API server factory               — createApiServer (YAML-driven)
//   4. Schema types + utilities         — ApiSchema, validators, loaders, generators
//   5. Public API types                 — McpCurlConfig, hooks, tool inputs
//   6. Sanitization helpers (metadata)  — sanitizeDescription
//   7. Response-side defence helpers    — sanitize / detect / spotlight / composer
//   8. URL validation helpers           — createHttpOnlyUrlSchema, safeHostname
//
// PR-6b will add `wrapWithDefence(handler)`. Decision recorded for that PR:
// `wrapWithDefence` becomes the canonical higher-level helper; the underlying
// primitives (`sanitizeResponse`, `detectInjectionPattern`, `applySpotlighting`,
// `sanitizeAndDetect`) stay public for callers needing finer-grained control,
// but the JSDoc for the primitives will point at `wrapWithDefence` as the
// recommended entry point. No subpath exports — flat barrel + section comments
// is the convention.

// 1. Main server class
export { McpCurlServer } from "./lib/extensible/index.js";
export type { CustomToolMeta } from "./lib/extensible/index.js";

// 2. Instance utilities for direct tool execution
export { createInstanceUtilities } from "./lib/extensible/index.js";
export type { InstanceUtilities, ExecuteRequestParams } from "./lib/extensible/index.js";

// 3. API server factory (creates servers from YAML schema definitions)
export { createApiServer, createApiServerSync } from "./lib/api-server.js";
export type { CreateApiServerOptions } from "./lib/api-server.js";

// 4. Schema types and utilities
export type {
    // Schema types
    ApiSchemaVersion,
    AuthConfig,
    ParameterLocation,
    ParameterType,
    EndpointParameter,
    ResponseConfig,
    HttpMethod,
    EndpointDefinition,
    ApiInfo,
    ApiDefaults,
    ApiSchema,
    // Generator config
    GeneratorConfig,
} from "./lib/schema/index.js";

export {
    // Validation
    ApiSchemaValidator,
    ApiSchemaValidationError,
    validateApiSchema,
    // Loading
    ApiSchemaLoadError,
    loadApiSchema,
    loadApiSchemaFromString,
    // Generation
    AuthenticationError,
    generateInputSchema,
    buildUrl,
    getAuthConfig,
    registerEndpointTools,
    generateToolDefinitions,
    // Tool annotations — exposes the method → readOnlyHint/destructiveHint/
    // idempotentHint mapping that built-in YAML tools use, so custom-tool
    // authors registering endpoints via `server.registerTool()` can replicate
    // the same MCP annotation semantics without deep-importing `schema/`.
    getMethodAnnotations,
} from "./lib/schema/index.js";

// 5. Public API types
export type {
    // Configuration
    McpCurlConfig,
    TransportMode,

    // Hook types
    HookContext,
    BeforeRequestResult,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,

    // Input types (for typing hook parameters)
    CurlExecuteInput,
    JqQueryInput,
} from "./lib/types/public.js";

// 6. Sanitization helpers (callers need these to defend against prompt injection
// in externally-sourced tool metadata — see docs/custom-tools.md).
export { sanitizeDescription, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "./lib/utils/index.js";

// 7. Response-side defence helpers — callers emitting external content (HTTP body,
// file content, third-party API response) should sanitise + spotlight to honour
// the same trust boundary the server enforces on built-in tools.
//
// Prefer `sanitizeAndDetect(text, label)` over hand-wiring `sanitizeResponse` +
// `detectInjectionPattern` + `logInjectionDetected` — it locks the
// sanitize → detect → log ordering invariant. Calling `detectInjectionPattern`
// on raw (un-sanitized) text silently degrades detection coverage because the
// matcher will not see invisible-char-split phrases like "Ig​nore" → "Ignore".
//
// Key spotlight by `randomUUID()` per request. See docs/custom-tools.md.
export { applySpotlighting, sanitizeResponse, detectInjectionPattern } from "./lib/utils/index.js";
export { sanitizeAndDetect, logInjectionDetected } from "./lib/security/detection-logger.js";

// 8. URL validation helpers for custom tool authors that take URL parameters.
// Built-in tools and YAML schemas use these same helpers internally; exporting
// them keeps custom tools at parity without deep-importing.
//
// `safeHostname` is the malformed-URL-tolerant hostname extractor used in error
// paths and log labels — PR-6b's `wrapWithDefence(result, hostname, config)`
// callers will need it to derive a per-request hostname without reimplementing
// the URL-parse-with-fallback pattern.
export { createHttpOnlyUrlSchema, safeHostname } from "./lib/utils/index.js";
export type { CreateHttpOnlyUrlSchemaOptions } from "./lib/utils/index.js";
