// src/lib/schema/validator.ts
// Zod schema for validating API definitions loaded from YAML

import { z } from "zod";
import type { ApiSchema } from "./types.js";

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
    baseUrl: z.string().url({
        message: "Base URL must be a valid URL",
    }),
});

/**
 * Default settings schema.
 */
const ApiDefaultsSchema = z.object({
    timeout: z.number().int().min(1).max(300).optional(),
    headers: z.record(z.string()).optional(),
}).optional();

/**
 * Complete API schema validator.
 */
export const ApiSchemaValidator = z.object({
    apiVersion: z.literal("1.0"),
    api: ApiInfoSchema,
    auth: AuthConfigSchema,
    defaults: ApiDefaultsSchema,
    endpoints: z.array(EndpointSchema).min(1, {
        message: "At least one endpoint must be defined",
    }),
});

/**
 * Validation error with detailed information.
 */
export class ApiSchemaValidationError extends Error {
    constructor(
        message: string,
        public readonly issues: z.ZodIssue[]
    ) {
        super(message);
        this.name = "ApiSchemaValidationError";
    }
}

/**
 * Validate parsed YAML against the API schema.
 * Returns a typed ApiSchema on success, throws on validation failure.
 *
 * @param data - Parsed YAML data (unknown type)
 * @returns Validated ApiSchema
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

    // Additional validation: check for duplicate endpoint IDs
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

    // Validate path parameters are defined
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
