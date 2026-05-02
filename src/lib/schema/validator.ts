// src/lib/schema/validator.ts
// Zod schema for validating API definitions loaded from YAML.
//
// Sanitisation invariant (PR-6a / B9 + review fixes):
// `ApiSchemaValidator` wraps `RawApiSchema` in a `z.preprocess()` step that
// recursively sanitises every user-facing string field on the raw input
// BEFORE Zod validates structure. Three consequences:
//   1. Every public entry point — `loadApiSchema`, `loadApiSchemaFromString`,
//      `validateApiSchema`, AND the directly-re-exported
//      `ApiSchemaValidator.parse()` — yields a sanitised result. There is
//      ONE chokepoint instead of duplicate walkers.
//   2. Zod's own validation (e.g. `z.string().min(1)`) sees the sanitised
//      values, so a string of pure invisibles reduces to `""` and is
//      rejected naturally — no separate post-sanitise empty-string check
//      is required.
//   3. Cross-field error messages constructed downstream (path-param-not-
//      defined, duplicate-endpoint-ID, duplicate-preset-name) interpolate
//      sanitised strings, so attacker-controlled bidi/zero-width bytes
//      cannot leak through error logs.
//
// Cross-field checks that depend on parsed shape (duplicates, path-param
// definitions) live inside the schema's `.transform()` step so direct
// `ApiSchemaValidator.parse()` callers get them too — `validateApiSchema()`
// is now a thin error-shape adapter.

import { z } from "zod";
import type { ZodIssue } from "zod";
import type { ApiSchema } from "./types.js";
import { createHttpOnlyUrlSchema, sanitizeDescription } from "../utils/index.js";

/**
 * Regex for valid endpoint IDs.
 * Must be lowercase, start with a letter, and contain only letters, numbers, and underscores.
 */
const ENDPOINT_ID_REGEX = /^[a-z][a-z0-9_]*$/;

const ApiKeyAuthSchema = z.object({
    type: z.enum(["query", "header"]),
    name: z.string().min(1),
    envVar: z.string().min(1),
    required: z.boolean().default(true),
});

const BearerAuthSchema = z.object({
    envVar: z.string().min(1),
    required: z.boolean().default(true),
});

const AuthConfigSchema = z.object({
    apiKey: ApiKeyAuthSchema.optional(),
    bearer: BearerAuthSchema.optional(),
}).optional();

const ParameterSchema = z.object({
    name: z.string().min(1),
    in: z.enum(["path", "query", "header", "body"]),
    type: z.enum(["string", "number", "boolean", "integer"]),
    required: z.boolean().default(false),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
});

const ResponseConfigSchema = z.object({
    jqFilter: z.string().optional(),
    filterPresets: z.array(z.object({
        name: z.string().min(1),
        jqFilter: z.string().min(1),
        description: z.string().trim().min(1).max(500).optional(),
    })).optional(),
}).optional();

const EndpointSchema = z.object({
    id: z.string().regex(ENDPOINT_ID_REGEX, {
        message: "Endpoint ID must be lowercase, start with a letter, and contain only letters, numbers, and underscores",
    }),
    path: z.string().startsWith("/", {
        message: "Endpoint path must start with /",
    }),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    title: z.string().min(1),
    description: z.string().min(1),
    parameters: z.array(ParameterSchema).optional(),
    response: ResponseConfigSchema,
});

const ApiInfoSchema = z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    baseUrl: createHttpOnlyUrlSchema({ description: "Base URL of the API" }),
});

const ApiDefaultsSchema = z.object({
    timeout: z.number().int().min(1).max(300).optional(),
    headers: z.record(z.string(), z.string()).optional(),
}).optional();

const RawApiSchema = z.object({
    apiVersion: z.literal("1.0"),
    api: ApiInfoSchema,
    auth: AuthConfigSchema,
    defaults: ApiDefaultsSchema,
    endpoints: z.array(EndpointSchema).min(1, {
        message: "At least one endpoint must be defined",
    }),
});

type ParsedSchema = z.output<typeof RawApiSchema>;

// --- Sanitisation: single tolerant walker, run via z.preprocess() ---

/** Narrow `unknown` to a plain object, returning `null` for non-objects/arrays. */
function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Apply `sanitizeDescription()` in place to a known string field on `obj`. */
function sanitiseStringField(obj: Record<string, unknown>, key: string): void {
    const v = obj[key];
    if (typeof v === "string") obj[key] = sanitizeDescription(v);
}

/**
 * Single tolerant walker that produces a deep clone of the raw input with
 * every user-facing string field sanitised. Returns the clone — the caller's
 * object is left untouched.
 *
 * Used as the function arg to `z.preprocess(sanitiseRawSchema, ...)`, so it
 * runs BEFORE any Zod validation. This means:
 *   - Zod's `min(1)` rejects strings that sanitise to `""`.
 *   - Zod issue messages quote the sanitised value, not raw attacker bytes.
 *   - Cross-field error messages (path-param-not-defined, etc.) see clean
 *     interpolated values.
 *
 * **Pure / clone-based.** `structuredClone` strips the prototype, defeating
 * `__proto__: {polluted: true}` payloads and obeying the project style guide
 * (rules 26 — pure functions / 52 — structured clone for untrusted data). The
 * clone is also what Zod ends up validating, so a caller who calls
 * `validateApiSchema(input)` and then re-uses `input` sees the original bytes
 * unchanged.
 *
 * **Tolerant by design:** any unexpected shape (non-object, missing keys,
 * wrong types) is left untouched — Zod will reject it with a normal
 * validation error downstream. The walker covers the SAME field set the
 * downstream MCP tool generator advertises to the LLM, plus `endpoint.id` /
 * `endpoint.path` (so cross-field error messages cannot echo raw bytes) and
 * `auth.apiKey.envVar` / `auth.bearer.envVar` (interpolated into the
 * `Missing required environment variable: …` message that
 * `generator.ts:createToolHandler` returns to the LLM on auth failure).
 *
 * **NOT sanitised:** machine-readable identifiers and engine-input strings:
 *   - `parameter.name` — used as object keys in input schemas and as URL
 *     parameter names; sanitising could change client semantics.
 *   - `preset.jqFilter` — the engine receives the raw filter; the
 *     human-readable interpolation in `generator.ts` sanitises at display
 *     time via `renderJqFilterForDisplay()`.
 *   - `api.name` and `api.version` — machine-readable identifier and
 *     version string; same rationale as `parameter.name`. Neither is
 *     interpolated into LLM-visible text.
 */
function sanitiseRawSchema(value: unknown): unknown {
    if (!asObject(value)) return value;

    // Deep clone first so callers' objects are never mutated and
    // attacker-controlled `__proto__` keys are stripped. structuredClone
    // throws DataCloneError on non-cloneable inputs (functions, symbols,
    // WeakMaps, …) — fall back to returning the original value so Zod can
    // emit its normal validation error downstream, preserving the
    // "Tolerant by design" contract.
    let root: Record<string, unknown>;
    try {
        root = structuredClone(value) as Record<string, unknown>;
    } catch {
        return value;
    }

    const api = asObject(root.api);
    if (api) {
        sanitiseStringField(api, "title");
        sanitiseStringField(api, "description");
    }

    const auth = asObject(root.auth);
    if (auth) {
        const apiKey = asObject(auth.apiKey);
        if (apiKey) sanitiseStringField(apiKey, "envVar");
        const bearer = asObject(auth.bearer);
        if (bearer) sanitiseStringField(bearer, "envVar");
    }

    if (Array.isArray(root.endpoints)) {
        for (const item of root.endpoints) {
            const ep = asObject(item);
            if (!ep) continue;
            sanitiseStringField(ep, "id");
            sanitiseStringField(ep, "path");
            sanitiseStringField(ep, "title");
            sanitiseStringField(ep, "description");

            if (Array.isArray(ep.parameters)) {
                for (const p of ep.parameters) {
                    const param = asObject(p);
                    if (param) sanitiseStringField(param, "description");
                }
            }

            const response = asObject(ep.response);
            if (response && Array.isArray(response.filterPresets)) {
                for (const p of response.filterPresets) {
                    const preset = asObject(p);
                    if (preset) {
                        sanitiseStringField(preset, "name");
                        sanitiseStringField(preset, "description");
                    }
                }
            }
        }
    }

    return root;
}

// --- Cross-field checks: live inside the schema so direct .parse() callers benefit ---

function reportDuplicateEndpointIds(schema: ParsedSchema, ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    schema.endpoints.forEach((endpoint, index) => {
        if (seen.has(endpoint.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate endpoint ID: ${endpoint.id}`,
                path: ["endpoints", index, "id"],
            });
        }
        seen.add(endpoint.id);
    });
}

function reportUndefinedPathParams(schema: ParsedSchema, ctx: z.RefinementCtx): void {
    schema.endpoints.forEach((endpoint, index) => {
        const pathParams = endpoint.path.match(/\{([^}]+)\}/g) || [];
        const definedPathParams = new Set(
            (endpoint.parameters ?? [])
                .filter((p) => p.in === "path")
                .map((p) => p.name)
        );

        for (const pathParam of pathParams) {
            const paramName = pathParam.slice(1, -1);
            if (!definedPathParams.has(paramName)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Path parameter {${paramName}} in endpoint "${endpoint.id}" is not defined in parameters`,
                    path: ["endpoints", index, "path"],
                });
            }
        }
    });
}

/**
 * Detect filter-preset name collisions. With the preprocess sanitiser
 * running first, `preset.name` is already sanitised by the time this fires,
 * so collisions like `"Summary"` colliding with `"​Summary"` are caught.
 */
function reportDuplicatePresetNames(schema: ParsedSchema, ctx: z.RefinementCtx): void {
    schema.endpoints.forEach((endpoint, endpointIndex) => {
        const presets = endpoint.response?.filterPresets;
        if (!presets || presets.length < 2) return;

        const seen = new Set<string>();
        presets.forEach((preset, presetIndex) => {
            if (seen.has(preset.name)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Endpoint "${endpoint.id}" has duplicate filter preset names after sanitization: "${preset.name}"`,
                    path: ["endpoints", endpointIndex, "response", "filterPresets", presetIndex, "name"],
                });
            }
            seen.add(preset.name);
        });
    });
}

/**
 * Complete API schema validator.
 *
 * **Runtime sanitisation invariant (PR-6a / B9):** the raw input is sanitised
 * by `z.preprocess(sanitiseRawSchemaInPlace, …)` BEFORE any Zod check fires.
 * Every public entry point that produces a parsed `ApiSchema` — including the
 * directly-re-exported `ApiSchemaValidator.parse()` — therefore yields a
 * sanitised result, and Zod's own error messages quote sanitised values.
 *
 * **Cross-field checks** (duplicate endpoint IDs, undefined path params,
 * duplicate filter-preset names after sanitisation) live inside the schema's
 * `.transform()` step so direct `.parse()` callers get them too. They are
 * surfaced via `ctx.addIssue` so the parse fails with a normal Zod error
 * (translated to `ApiSchemaValidationError` by `validateApiSchema()`).
 *
 * Downstream consumers MUST NOT re-sanitise — sanitation is the validator's
 * job. The TypeScript type does NOT carry this invariant; it is a runtime
 * property documented here.
 */
export const ApiSchemaValidator = z.preprocess(
    sanitiseRawSchema,
    RawApiSchema.transform((schema, ctx) => {
        reportDuplicateEndpointIds(schema, ctx);
        reportUndefinedPathParams(schema, ctx);
        reportDuplicatePresetNames(schema, ctx);
        return schema;
    })
);

/**
 * Validation error with detailed information.
 */
export class ApiSchemaValidationError extends Error {
    constructor(
        message: string,
        public readonly issues: ZodIssue[]
    ) {
        super(message);
        this.name = "ApiSchemaValidationError";
    }
}

/**
 * Validate parsed YAML against the API schema.
 *
 * Thin error-shape adapter: defers all sanitisation and cross-field checks to
 * `ApiSchemaValidator`. Returns a typed, sanitised `ApiSchema` on success;
 * throws `ApiSchemaValidationError` on failure.
 *
 * @param data - Parsed YAML data (unknown type)
 * @returns Validated, sanitised ApiSchema
 * @throws ApiSchemaValidationError if validation fails
 */
export function validateApiSchema(data: unknown): ApiSchema {
    const result = ApiSchemaValidator.safeParse(data);

    if (!result.success) {
        const messages = result.error.issues.map((issue) => {
            const path = issue.path.join(".");
            return `${path}: ${issue.message}`;
        });
        throw new ApiSchemaValidationError(
            `API schema validation failed:\n${messages.join("\n")}`,
            result.error.issues
        );
    }

    return result.data;
}
