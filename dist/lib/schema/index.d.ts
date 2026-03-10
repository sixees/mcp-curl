import { b as ApiSchema } from '../../generator-CPvY9sSW.js';
export { A as ApiDefaults, a as ApiInfo, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, p as getMethodAnnotations, r as registerEndpointTools } from '../../generator-CPvY9sSW.js';
import { z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Complete API schema validator.
 */
declare const ApiSchemaValidator: z.ZodObject<{
    apiVersion: z.ZodLiteral<"1.0">;
    api: z.ZodObject<{
        name: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        version: z.ZodString;
        baseUrl: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        version: string;
        description: string;
        name: string;
        title: string;
        baseUrl: string;
    }, {
        version: string;
        description: string;
        name: string;
        title: string;
        baseUrl: string;
    }>;
    auth: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<["query", "header"]>;
            name: z.ZodString;
            envVar: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            type: "query" | "header";
            name: string;
            envVar: string;
            required: boolean;
        }, {
            type: "query" | "header";
            name: string;
            envVar: string;
            required?: boolean | undefined;
        }>>;
        bearer: z.ZodOptional<z.ZodObject<{
            envVar: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            envVar: string;
            required: boolean;
        }, {
            envVar: string;
            required?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
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
    }, {
        apiKey?: {
            type: "query" | "header";
            name: string;
            envVar: string;
            required?: boolean | undefined;
        } | undefined;
        bearer?: {
            envVar: string;
            required?: boolean | undefined;
        } | undefined;
    }>>;
    defaults: z.ZodOptional<z.ZodObject<{
        timeout: z.ZodOptional<z.ZodNumber>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
    }, {
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
    }>>;
    endpoints: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        method: z.ZodEnum<["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]>;
        title: z.ZodString;
        description: z.ZodString;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            in: z.ZodEnum<["path", "query", "header", "body"]>;
            type: z.ZodEnum<["string", "number", "boolean", "integer"]>;
            required: z.ZodDefault<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            default: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
            enum: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            required: boolean;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            enum?: (string | number)[] | undefined;
        }, {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            enum?: (string | number)[] | undefined;
        }>, "many">>;
        response: z.ZodOptional<z.ZodObject<{
            jqFilter: z.ZodOptional<z.ZodString>;
            filterPresets: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                jqFilter: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                jqFilter: string;
            }, {
                name: string;
                jqFilter: string;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        }, {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        description: string;
        title: string;
        id: string;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        } | undefined;
        parameters?: {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            required: boolean;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
    }, {
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        description: string;
        title: string;
        id: string;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        } | undefined;
        parameters?: {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    apiVersion: "1.0";
    api: {
        version: string;
        description: string;
        name: string;
        title: string;
        baseUrl: string;
    };
    endpoints: {
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        description: string;
        title: string;
        id: string;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        } | undefined;
        parameters?: {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            required: boolean;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
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
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
    } | undefined;
}, {
    apiVersion: "1.0";
    api: {
        version: string;
        description: string;
        name: string;
        title: string;
        baseUrl: string;
    };
    endpoints: {
        path: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
        description: string;
        title: string;
        id: string;
        response?: {
            jqFilter?: string | undefined;
            filterPresets?: {
                name: string;
                jqFilter: string;
            }[] | undefined;
        } | undefined;
        parameters?: {
            type: "string" | "number" | "boolean" | "integer";
            in: "path" | "body" | "query" | "header";
            name: string;
            default?: string | number | boolean | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            enum?: (string | number)[] | undefined;
        }[] | undefined;
    }[];
    auth?: {
        apiKey?: {
            type: "query" | "header";
            name: string;
            envVar: string;
            required?: boolean | undefined;
        } | undefined;
        bearer?: {
            envVar: string;
            required?: boolean | undefined;
        } | undefined;
    } | undefined;
    defaults?: {
        headers?: Record<string, string> | undefined;
        timeout?: number | undefined;
    } | undefined;
}>;
/**
 * Validation error with detailed information.
 */
declare class ApiSchemaValidationError extends Error {
    readonly issues: z.ZodIssue[];
    constructor(message: string, issues: z.ZodIssue[]);
}
/**
 * Validate parsed YAML against the API schema.
 * Returns a typed ApiSchema on success, throws on validation failure.
 *
 * @param data - Parsed YAML data (unknown type)
 * @returns Validated ApiSchema
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
