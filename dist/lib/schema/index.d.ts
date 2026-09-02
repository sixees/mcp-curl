import { d as ApiSchema } from '../../generator-D-A-xhiq.js';
export { A as ApiDefaults, c as ApiInfo, f as ApiSchemaVersion, g as AuthConfig, h as AuthenticationError, E as EndpointDefinition, i as EndpointParameter, G as GeneratorConfig, H as HttpMethod, P as ParameterLocation, j as ParameterType, R as ResponseConfig, k as buildUrl, l as generateInputSchema, m as generateToolDefinitions, n as getAuthConfig, o as getMethodAnnotations, r as registerEndpointTools } from '../../generator-D-A-xhiq.js';
import { ZodIssue, z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

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
declare const ApiSchemaValidator: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodPipe<z.ZodObject<{
    apiVersion: z.ZodLiteral<"1.0">;
    api: z.ZodObject<{
        name: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        version: z.ZodString;
        baseUrl: z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>;
    }, z.core.$strip>;
    auth: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                query: "query";
                header: "header";
            }>;
            name: z.ZodString;
            envVar: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        bearer: z.ZodOptional<z.ZodObject<{
            envVar: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    defaults: z.ZodOptional<z.ZodObject<{
        timeout: z.ZodOptional<z.ZodNumber>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
    endpoints: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
            PATCH: "PATCH";
            DELETE: "DELETE";
            HEAD: "HEAD";
            OPTIONS: "OPTIONS";
        }>;
        title: z.ZodString;
        description: z.ZodString;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            in: z.ZodEnum<{
                path: "path";
                query: "query";
                header: "header";
                body: "body";
            }>;
            type: z.ZodEnum<{
                string: "string";
                number: "number";
                boolean: "boolean";
                integer: "integer";
            }>;
            required: z.ZodDefault<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            default: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
            enum: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
        }, z.core.$strip>>>;
        response: z.ZodOptional<z.ZodObject<{
            jqFilter: z.ZodOptional<z.ZodString>;
            filterPresets: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                jqFilter: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodTransform<{
    apiVersion: "1.0";
    api: {
        name: string;
        title: string;
        description: string;
        version: string;
        baseUrl: string;
    };
    endpoints: {
        id: string;
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        title: string;
        description: string;
        parameters?: {
            name: string;
            in: "path" | "query" | "header" | "body";
            type: "string" | "number" | "boolean" | "integer";
            required: boolean;
            description?: string | undefined;
            default?: string | number | boolean | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
                description?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    auth?: {
        apiKey?: {
            type: "query" | "header";
            name: string;
            envVar: string;
            required: boolean;
        } | undefined;
        bearer?: {
            envVar: string;
            required: boolean;
        } | undefined;
    } | undefined;
    defaults?: {
        timeout?: number | undefined;
        headers?: Record<string, string> | undefined;
    } | undefined;
}, {
    apiVersion: "1.0";
    api: {
        name: string;
        title: string;
        description: string;
        version: string;
        baseUrl: string;
    };
    endpoints: {
        id: string;
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        title: string;
        description: string;
        parameters?: {
            name: string;
            in: "path" | "query" | "header" | "body";
            type: "string" | "number" | "boolean" | "integer";
            required: boolean;
            description?: string | undefined;
            default?: string | number | boolean | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
                description?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    auth?: {
        apiKey?: {
            type: "query" | "header";
            name: string;
            envVar: string;
            required: boolean;
        } | undefined;
        bearer?: {
            envVar: string;
            required: boolean;
        } | undefined;
    } | undefined;
    defaults?: {
        timeout?: number | undefined;
        headers?: Record<string, string> | undefined;
    } | undefined;
}>>>;
/**
 * Validation error with detailed information.
 */
declare class ApiSchemaValidationError extends Error {
    readonly issues: ZodIssue[];
    constructor(message: string, issues: ZodIssue[]);
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
declare function validateApiSchema(data: unknown): ApiSchema;

/**
 * Error thrown when loading an API schema fails.
 */
declare class ApiSchemaLoadError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
/**
 * Load and validate an API schema from a YAML file.
 *
 * SECURITY: This function reads from the filesystem. Ensure definitionPath
 * comes from a trusted source (not user input) to prevent path traversal attacks.
 * Path validation should be performed at the application boundary (CLI, HTTP handler).
 *
 * @param definitionPath - Path to the YAML definition file
 * @returns Validated ApiSchema
 * @throws ApiSchemaLoadError if file cannot be read or parsed
 * @throws ApiSchemaValidationError if schema validation fails
 */
declare function loadApiSchema(definitionPath: string): Promise<ApiSchema>;
/**
 * Load and validate an API schema from a YAML string.
 * Useful for testing or inline schema definitions.
 *
 * @param yamlContent - YAML content as a string
 * @returns Validated ApiSchema
 * @throws ApiSchemaLoadError if YAML parsing fails
 * @throws ApiSchemaValidationError if schema validation fails
 */
declare function loadApiSchemaFromString(yamlContent: string): ApiSchema;

export { ApiSchema, ApiSchemaLoadError, ApiSchemaValidationError, ApiSchemaValidator, loadApiSchema, loadApiSchemaFromString, validateApiSchema };
