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
//   7. Response-side defence helpers    — sanitize / detect / spotlight
//   8. URL validation helpers           — createHttpOnlyUrlSchema, safeHostname
//
// The server applies an internal defence-in-depth wrap (`createWrapper(config)`
// in `src/lib/response/post-processor.ts`) automatically, with idempotence via
// a module-private Symbol tag.
//
// **Do not enumerate the call sites here.** A list in this comment reads as
// complete while a registration path missing from it ships unwrapped, and
// nothing fails. The wrap is built at more than one seam, not only
// `extensible/tool-wrapper.ts`, so `rg -n 'createWrapper' src` is the thing to
// trust.
// **The wrap factory is intentionally not exported** — its
// `CallToolResult` shape is coupled to the MCP SDK. Library consumers interact
// with it via `enableSpotlighting` (see McpCurlConfig).
//
// The strip pipeline the wrap runs over a NON-JSON text part is not exported:
// a custom tool's output goes through the wrap, which is the supported way to
// get it. The lower-level helpers in section 7 are exported for callers that
// emit remote content outside an MCP tool result.
// No subpath exports — flat barrel + section comments is the convention.

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
    HostRateLimit,
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
export {
    sanitizeDescription,
    MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH,
    MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH,
} from "./lib/utils/index.js";

// 7. Response-side defence helpers — callers emitting external content (HTTP body,
// file content, third-party API response) outside an MCP tool result should
// sanitise + spotlight to honour the same trust boundary the server enforces on
// built-in tools. A custom tool's result needs none of this: the wrap detects
// on a JSON part and returns it unchanged, and runs every non-JSON part
// through the markup and markdown strip stages these helpers do not.
//
// Prefer `sanitizeAndDetect(text, label)` over hand-wiring `sanitizeResponse`
// + `detectInjectionPattern` + `logInjectionDetected`. The helper detects on
// the **original** text and on the sanitised form: a malicious pattern a later
// strip stage would erase still lands in the per-host `[injection-defense]`
// log signal, and so does a phrase an invisible character splits
// (`Ig​nore`), which only the sanitised form shows whole. The returned
// text is the sanitised version. The log is observability only, never a
// content gate.
//
// `sanitizeResponse`'s visual-space rule covers the full visual-space class
// (tabs, NBSP, en/em-spaces, NARROW NO-BREAK, MEDIUM MATHEMATICAL, IDEOGRAPHIC
// SPACE) at a 50+ character threshold, plus a separate 20+ newline run rule,
// and covers Unicode invisibles including U+061C ARABIC LETTER MARK,
// U+115F/1160 HANGUL fillers, U+180B–U+180E Mongolian invisibles, U+2800
// BRAILLE PATTERN BLANK, U+3164 HANGUL FILLER, and U+E0100–U+E01EF Variation
// Selectors Supplement. The named codepoint groups live in
// `src/lib/utils/unicode-attack-ranges.ts` so they read as a taxonomy rather
// than an opaque char-class string.
//
// Spotlight (when used directly) must key on `randomUUID()` per request /
// per message; nothing else gives the per-call entropy the sentinel
// boundary depends on. See docs/custom-tools.md.
export { applySpotlighting, sanitizeResponse, detectInjectionPattern } from "./lib/utils/index.js";
export { sanitizeAndDetect, logInjectionDetected } from "./lib/security/detection-logger.js";

// 8. URL validation helpers for custom tool authors that take URL parameters.
// Built-in tools and YAML schemas use these same helpers internally; exporting
// them keeps custom tools at parity without deep-importing.
//
// `safeHostname` is the malformed-URL-tolerant hostname extractor used in
// error paths and log labels — pair it with `sanitizeAndDetect(text,
// hostname)` in any custom non-MCP pipeline that emits external content; the
// same per-host throttle the server uses internally then keys correctly
// across both.
export { createHttpOnlyUrlSchema, safeHostname } from "./lib/utils/index.js";
export type { CreateHttpOnlyUrlSchemaOptions } from "./lib/utils/index.js";
