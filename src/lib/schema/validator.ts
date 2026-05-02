// src/lib/schema/validator.ts
// Zod schema for validating API definitions loaded from YAML.
//
// Sanitisation invariant (PR-6a / B9): the exported `ApiSchemaValidator` runs
// `sanitizeDescription()` on every user-facing string field via a `.transform()`
// step. Every entry point that produces a parsed `ApiSchema` — `loadApiSchema`,
// `loadApiSchemaFromString`, `validateApiSchema`, AND the public re-export of
// `ApiSchemaValidator.parse()` — therefore yields a pre-sanitised schema. The
// downstream tool generator relies on this and does NOT re-sanitise.

import { z } from "zod";
import type { ZodIssue } from "zod";
import type { ApiSchema } from "./types.js";
import { createHttpOnlyUrlSchema, sanitizeDescription } from "../utils/index.js";

/**
 * Regex for valid endpoint IDs.
 * Must be lowercase, start with a letter, and contain only letters, numbers, and underscores.
 */
const ENDPOINT_ID_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * API key authentication configuration schema.
 */
const ApiKeyAuthSchema = z.object({
    type: z.enum(["query", "header"]),
    name: z.string().min(1),
    envVar: z.string().min(1),
    required: z.boolean().default(true),
});

/**
 * Bearer token authentication configuration schema.
 */
const BearerAuthSchema = z.object({
    envVar: z.string().min(1),
    required: z.boolean().default(true),
});

/**
 * Complete authentication configuration schema.
 */
const AuthConfigSchema = z.object({
    apiKey: ApiKeyAuthSchema.optional(),
    bearer: BearerAuthSchema.optional(),
}).optional();

/**
 * Endpoint parameter schema.
 */
const ParameterSchema = z.object({
    name: z.string().min(1),
    in: z.enum(["path", "query", "header", "body"]),
    type: z.enum(["string", "number", "boolean", "integer"]),
    required: z.boolean().default(false),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
});

/**
 * Response configuration schema.
 */
const ResponseConfigSchema = z.object({
    jqFilter: z.string().optional(),
    filterPresets: z.array(z.object({
        name: z.string().min(1),
        jqFilter: z.string().min(1),
        description: z.string().trim().min(1).max(500).optional(),
    })).optional(),
}).optional();

/**
 * Single endpoint definition schema.
 */
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

/**
 * API metadata schema.
 */
const ApiInfoSchema = z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    baseUrl: createHttpOnlyUrlSchema({ description: "Base URL of the API" }),
});

/**
 * Default settings schema.
 */
const ApiDefaultsSchema = z.object({
    timeout: z.number().int().min(1).max(300).optional(),
    headers: z.record(z.string(), z.string()).optional(),
}).optional();

/**
 * Raw (pre-transform) API schema shape. The exported `ApiSchemaValidator`
 * wraps this with a `.transform()` step that sanitises every user-facing string.
 */
const RawApiSchema = z.object({
    apiVersion: z.literal("1.0"),
    api: ApiInfoSchema,
    auth: AuthConfigSchema,
    defaults: ApiDefaultsSchema,
    endpoints: z.array(EndpointSchema).min(1, {
        message: "At least one endpoint must be defined",
    }),
});

type RawApiSchemaType = z.infer<typeof RawApiSchema>;

/**
 * Mutate the validated schema in place, replacing every user-facing string
 * field with its sanitised form. Called by `ApiSchemaValidator`'s `.transform()`
 * step so every parse path produces a sanitised result, including the public
 * re-exported `ApiSchemaValidator.parse()` (closes the bypass identified by
 * PR-6a / B9).
 *
 * `api.title` / `api.description` are sanitised defensively — they are not
 * currently consumed in tool advertisement, but the cost is near-zero since the
 * validator runs once at startup.
 */
function sanitizeApiSchemaInPlace(schema: RawApiSchemaType): RawApiSchemaType {
    schema.api.title = sanitizeDescription(schema.api.title);
    schema.api.description = sanitizeDescription(schema.api.description);

    for (const endpoint of schema.endpoints) {
        endpoint.title = sanitizeDescription(endpoint.title);
        endpoint.description = sanitizeDescription(endpoint.description);

        if (endpoint.parameters) {
            for (const parameter of endpoint.parameters) {
                if (parameter.description !== undefined) {
                    parameter.description = sanitizeDescription(parameter.description);
                }
            }
        }

        const presets = endpoint.response?.filterPresets;
        if (presets) {
            for (const preset of presets) {
                preset.name = sanitizeDescription(preset.name);
                if (preset.description !== undefined) {
                    preset.description = sanitizeDescription(preset.description);
                }
            }
        }
    }

    return schema;
}

/**
 * Detect filter-preset name collisions that emerge only after sanitisation.
 * E.g. "Summary" and "​Summary" both sanitise to "Summary" and would
 * silently dispatch to the wrong jq filter at runtime. Runs INSIDE the same
 * `.transform()` step that sanitises, so the comparison sees post-sanitise
 * values; collisions are surfaced via `ctx.addIssue` so the parse fails with a
 * normal `ApiSchemaValidationError`.
 */
function reportDuplicatePresetNames(
    schema: RawApiSchemaType,
    ctx: z.RefinementCtx
): void {
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
 * **Sanitisation contract (PR-6a / B9):** the schema runs `sanitizeDescription()`
 * on every user-facing string field via a `.transform()` step before returning.
 * Consumers MUST NOT re-sanitise downstream — the type carries the invariant.
 * The public re-export means even consumers who bypass `validateApiSchema()` and
 * call `ApiSchemaValidator.parse(rawObject)` directly receive a sanitised result.
 *
 * The same `.transform()` step also reports filter-preset name collisions that
 * emerge only after sanitisation — `seen` is keyed on the post-sanitise name,
 * so e.g. `"Summary"` colliding with `"​Summary"` is surfaced as a
 * validation error rather than silently dispatching the wrong jq filter.
 */
export const ApiSchemaValidator = RawApiSchema.transform((schema, ctx) => {
    sanitizeApiSchemaInPlace(schema);
    reportDuplicatePresetNames(schema, ctx);
    return schema;
});

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
 * Returns a typed, sanitised `ApiSchema` on success, throws on validation failure.
 *
 * Sanitisation runs inside `ApiSchemaValidator`'s `.transform()` step, so
 * every entry point — including the public `ApiSchemaValidator.parse()` —
 * yields a pre-sanitised schema (PR-6a / B9 invariant).
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

    // Additional cross-field checks the Zod schema cannot express on its own.
    // (Duplicate filter-preset names are checked inside the schema's
    // .superRefine() — see reportDuplicatePresetNames.)

    // Duplicate endpoint IDs.
    const endpointIds = new Set<string>();
    for (const endpoint of result.data.endpoints) {
        if (endpointIds.has(endpoint.id)) {
            throw new ApiSchemaValidationError(
                `Duplicate endpoint ID: ${endpoint.id}`,
                []
            );
        }
        endpointIds.add(endpoint.id);
    }

    // Path parameters must be declared in `parameters[]`.
    for (const endpoint of result.data.endpoints) {
        const pathParams = endpoint.path.match(/\{([^}]+)\}/g) || [];
        const definedPathParams = new Set(
            (endpoint.parameters || [])
                .filter((p) => p.in === "path")
                .map((p) => p.name)
        );

        for (const pathParam of pathParams) {
            const paramName = pathParam.slice(1, -1); // Remove { and }
            if (!definedPathParams.has(paramName)) {
                throw new ApiSchemaValidationError(
                    `Path parameter {${paramName}} in endpoint "${endpoint.id}" is not defined in parameters`,
                    []
                );
            }
        }
    }

    return result.data as ApiSchema;
}
