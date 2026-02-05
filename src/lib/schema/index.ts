// src/lib/schema/index.ts
// Barrel export for the schema module

// Types
export type {
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
} from "./types.js";

// Validation
export {
    ApiSchemaValidator,
    ApiSchemaValidationError,
    validateApiSchema,
} from "./validator.js";

// Loading
export {
    ApiSchemaLoadError,
    loadApiSchema,
    loadApiSchemaFromString,
} from "./loader.js";

// Generation
export {
    AuthenticationError,
    generateInputSchema,
    buildUrl,
    getAuthConfig,
    getMethodAnnotations,
    registerEndpointTools,
    generateToolDefinitions,
} from "./generator.js";
export type { GeneratorConfig } from "./generator.js";
