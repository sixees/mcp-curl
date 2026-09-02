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
// PR-6b ships an internal defence-in-depth wrap (`createWrapper(config)` in
// `src/lib/response/post-processor.ts`) that the server applies automatically
// at four call sites (curl_execute / jq_query in tool-wrapper.ts, YAML
// createToolHandler in schema/generator.ts, custom-tool registration in
// extensible/mcp-curl-server.ts, and the hook short-circuit in
// extensible/hook-executor.ts) with idempotence via a module-private Symbol
// tag. **The wrap factory is intentionally not exported** — its
// `CallToolResult` shape is coupled to the MCP SDK. Library consumers interact
// with it via `enableSpotlighting` (see McpCurlConfig).
//
// What the wrap DOES to each text part is a separate question, and that half
// is exported: `defendText` (section 7) is the same pipeline, over a plain
// string. Callers building a non-MCP pipeline should call it rather than
// composing `sanitizeAndDetect` by hand — the composer is Step 2 of five, and
// the difference is whether markdown beacons and `<script>` blocks survive.
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
// file content, third-party API response) should defend + spotlight to honour
// the same trust boundary the server enforces on built-in tools.
//
// **`defendText(text, options)` is the whole pipeline, and it is what the
// built-in tools run.** Sanitise-and-detect is Step 2 of five; Steps 3-5 —
// markup comments, the `<script>`/`<style>` strip, markdown beacon
// removal and the numeric-entity re-detect — are what remove exfiltration
// beacons and script blocks. Reach for the lower-level composers below only
// when you specifically want one stage; if you want "the defence", it is this.
// See `ARCHITECTURE.md` invariant 1a for why the distinction has a name.
//
// Pass the origin's `contentType` when you know it. When you do not, pass
// `contentTypeUndetermined: true` rather than omitting it — that selects the
// STRICTEST grammar, so an unreadable content type can never be the way a
// stage gets switched off. Pass `decodeEntities: false` on any channel whose
// consumer does not itself decode HTML entities; the decode's output is what
// gets returned, so on such a channel it manufactures live markup from inert
// bytes.
//
// Among the lower-level composers, prefer `sanitizeAndDetect(text, label)`
// over hand-wiring `sanitizeResponse`
// + `detectInjectionPattern` + `logInjectionDetected`. Since PR-6b the
// helper detects on the **original** text *before* sanitisation: a malicious
// pattern that the sanitiser would otherwise strip (e.g. content inside a
// PR-7 HTML-script-strip pass) still lands in the per-host
// `[injection-defense]` log signal, and the returned text is the sanitised
// version. The trade-off is a small regression on invisible-char-split
// phrases (`Ig​nore` → the matcher does not see `Ignore`) — acceptable
// because the throttled log is observability only, not a content gate.
//
// PR-7 expanded `sanitizeResponse` to cover the full visual-space class
// (tabs, NBSP, en/em-spaces, NARROW NO-BREAK, MEDIUM MATHEMATICAL, IDEOGRAPHIC
// SPACE) at the same 50+ threshold, added a 20+ newline run rule, and added 8
// missing Unicode invisibles (U+061C ARABIC LETTER MARK, U+115F/1160 HANGUL
// fillers, U+180B–U+180E Mongolian invisibles, U+2800 BRAILLE PATTERN BLANK,
// U+3164 HANGUL FILLER, U+E0100–U+E01EF "Sneaky Bits" Variation Selectors
// Supplement). The named codepoint groups live in
// `src/lib/utils/unicode-attack-ranges.ts` so they read as a taxonomy rather
// than an opaque char-class string.
//
// Spotlight (when used directly) must key on `randomUUID()` per request /
// per message; nothing else gives the per-call entropy the sentinel
// boundary depends on. See docs/custom-tools.md.
export { defendText } from "./lib/response/index.js";
export type { DefendTextOptions } from "./lib/response/index.js";
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
