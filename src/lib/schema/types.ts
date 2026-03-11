// src/lib/schema/types.ts
// TypeScript interfaces for YAML-based API schema definitions

/**
 * API Schema version for forward compatibility.
 * New versions can introduce breaking changes with migration support.
 */
export type ApiSchemaVersion = "1.0";

/**
 * Authentication configuration for API requests.
 * Supports API key (query/header) and bearer token auth.
 * All values are injected from environment variables.
 */
export interface AuthConfig {
    /** API key authentication */
    apiKey?: {
        /** Where to place the API key */
        type: "query" | "header";
        /** Parameter or header name (e.g., "key", "X-API-Key") */
        name: string;
        /** Environment variable name containing the API key */
        envVar: string;
        /** Whether auth is required (default: true) */
        required?: boolean;
    };
    /** Bearer token authentication */
    bearer?: {
        /** Environment variable name containing the bearer token */
        envVar: string;
        /** Whether auth is required (default: true) */
        required?: boolean;
    };
}

/**
 * Where a parameter is placed in the HTTP request.
 */
export type ParameterLocation = "path" | "query" | "header" | "body";

/**
 * Supported parameter types for endpoints.
 */
export type ParameterType = "string" | "number" | "boolean" | "integer";

/**
 * Single parameter definition for an endpoint.
 */
export interface EndpointParameter {
    /** Parameter name */
    name: string;
    /** Where to place this parameter */
    in: ParameterLocation;
    /** Parameter type for validation */
    type: ParameterType;
    /** Whether the parameter is required (default: false) */
    required?: boolean;
    /** Description for LLM context */
    description?: string;
    /** Default value if not provided */
    default?: string | number | boolean;
    /** Allowed values (creates enum constraint) */
    enum?: (string | number)[];
}

/**
 * Response processing configuration for an endpoint.
 */
export interface ResponseConfig {
    /** Default jq filter to apply to responses */
    jqFilter?: string;
    /** Named filter presets users can select */
    filterPresets?: Array<{
        /** Preset name for selection */
        name: string;
        /** jq filter expression */
        jqFilter: string;
        /** Human-readable description for LLM context */
        description?: string;
    }>;
}

/**
 * HTTP methods supported by endpoints.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/**
 * Single endpoint definition that generates an MCP tool.
 */
export interface EndpointDefinition {
    /** Tool name (lowercase with underscores, e.g., "get_user") */
    id: string;
    /** URL path with {param} placeholders (e.g., "/users/{id}") */
    path: string;
    /** HTTP method */
    method: HttpMethod;
    /** Human-readable title for the tool */
    title: string;
    /** Description providing LLM context */
    description: string;
    /** Parameter definitions */
    parameters?: EndpointParameter[];
    /** Response processing configuration */
    response?: ResponseConfig;
}

/**
 * API metadata in the schema.
 */
export interface ApiInfo {
    /** Machine-readable API name */
    name: string;
    /** Human-readable API title */
    title: string;
    /** Description for LLM context */
    description: string;
    /** API version string */
    version: string;
    /** Base URL for all endpoints */
    baseUrl: string;
}

/**
 * Default settings applied to all endpoints.
 */
export interface ApiDefaults {
    /** Default request timeout in seconds */
    timeout?: number;
    /** Default headers for all requests */
    headers?: Record<string, string>;
}

/**
 * Complete API schema definition.
 * This is the root structure of a YAML API definition file.
 */
export interface ApiSchema {
    /** Schema version for compatibility */
    apiVersion: ApiSchemaVersion;
    /** API metadata */
    api: ApiInfo;
    /** Authentication configuration */
    auth?: AuthConfig;
    /** Default settings */
    defaults?: ApiDefaults;
    /** Endpoint definitions */
    endpoints: EndpointDefinition[];
}
