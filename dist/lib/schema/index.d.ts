import { b as ApiSchema } from '../../generator-C4tc86Qe.js';
export { A as ApiDefaults, a as ApiInfo, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, l as getMethodAnnotations, r as registerEndpointTools } from '../../generator-C4tc86Qe.js';
import { ZodIssue, z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

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
declare const ApiSchemaValidator: z.ZodPipe<z.ZodObject<{
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
                body: "body";
                query: "query";
                header: "header";
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
            in: "path" | "body" | "query" | "header";
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
            in: "path" | "body" | "query" | "header";
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
}>>;
/**
 * Validation error with detailed information.
 */
declare class ApiSchemaValidationError extends Error {
    readonly issues: ZodIssue[];
    constructor(message: string, issues: ZodIssue[]);
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
