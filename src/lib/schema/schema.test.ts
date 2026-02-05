// src/lib/schema/schema.test.ts
// Tests for the API schema system

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    validateApiSchema,
    ApiSchemaValidationError,
    loadApiSchemaFromString,
    ApiSchemaLoadError,
    generateInputSchema,
    buildUrl,
    getAuthConfig,
    AuthenticationError,
} from "./index.js";
import type { ApiSchema, EndpointDefinition } from "./types.js";

// --- Validation Tests ---

describe("validateApiSchema", () => {
    const validSchema: ApiSchema = {
        apiVersion: "1.0",
        api: {
            name: "test-api",
            title: "Test API",
            description: "A test API",
            version: "1.0.0",
            baseUrl: "https://api.example.com",
        },
        endpoints: [
            {
                id: "get_item",
                path: "/items/{id}",
                method: "GET",
                title: "Get Item",
                description: "Fetch an item by ID",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        type: "string",
                        required: true,
                    },
                ],
            },
        ],
    };

    it("accepts valid schema", () => {
        const result = validateApiSchema(validSchema);
        expect(result.api.name).toBe("test-api");
        expect(result.endpoints).toHaveLength(1);
    });

    it("rejects invalid apiVersion", () => {
        expect(() =>
            validateApiSchema({ ...validSchema, apiVersion: "2.0" })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects invalid baseUrl", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                api: { ...validSchema.api, baseUrl: "not-a-url" },
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects empty endpoints array", () => {
        expect(() =>
            validateApiSchema({ ...validSchema, endpoints: [] })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects invalid endpoint ID format", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    { ...validSchema.endpoints[0], id: "Invalid-ID" },
                ],
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects endpoint path not starting with /", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    { ...validSchema.endpoints[0], path: "items/{id}" },
                ],
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects duplicate endpoint IDs", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    validSchema.endpoints[0],
                    { ...validSchema.endpoints[0] }, // Duplicate ID
                ],
            })
        ).toThrow("Duplicate endpoint ID");
    });

    it("rejects undefined path parameters", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    {
                        ...validSchema.endpoints[0],
                        parameters: [], // Missing required "id" path param
                    },
                ],
            })
        ).toThrow('Path parameter {id} in endpoint "get_item" is not defined');
    });

    it("validates auth config", () => {
        const result = validateApiSchema({
            ...validSchema,
            auth: {
                apiKey: {
                    type: "header",
                    name: "X-API-Key",
                    envVar: "API_KEY",
                },
            },
        });
        expect(result.auth?.apiKey?.type).toBe("header");
    });

    it("validates defaults config", () => {
        const result = validateApiSchema({
            ...validSchema,
            defaults: {
                timeout: 60,
                headers: { Accept: "application/json" },
            },
        });
        expect(result.defaults?.timeout).toBe(60);
    });

    it("rejects timeout out of range", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                defaults: { timeout: 500 },
            })
        ).toThrow(ApiSchemaValidationError);
    });
});

// --- Loader Tests ---

describe("loadApiSchemaFromString", () => {
    const validYaml = `
apiVersion: "1.0"
api:
  name: test-api
  title: Test API
  description: A test API
  version: "1.0"
  baseUrl: https://api.example.com
endpoints:
  - id: get_item
    path: /items/{id}
    method: GET
    title: Get Item
    description: Fetch an item by ID
    parameters:
      - name: id
        in: path
        type: string
        required: true
`;

    it("loads valid YAML", () => {
        const result = loadApiSchemaFromString(validYaml);
        expect(result.api.name).toBe("test-api");
    });

    it("throws on invalid YAML syntax", () => {
        expect(() => loadApiSchemaFromString("invalid: yaml: content:")).toThrow(
            ApiSchemaLoadError
        );
    });

    it("throws on empty content", () => {
        expect(() => loadApiSchemaFromString("")).toThrow("empty");
    });

    it("propagates validation errors", () => {
        const invalidYaml = validYaml.replace('apiVersion: "1.0"', 'apiVersion: "2.0"');
        expect(() => loadApiSchemaFromString(invalidYaml)).toThrow(
            ApiSchemaValidationError
        );
    });

    it("rejects dangerous YAML tags like !!js/function for security", () => {
        // This YAML attempts to use a JavaScript function tag which could execute arbitrary code
        const maliciousYaml = `
apiVersion: "1.0"
api:
  name: !!js/function 'function() { return "malicious"; }'
  title: Test
  description: Test
  version: "1.0"
  baseUrl: https://api.example.com
endpoints:
  - id: test
    path: /test
    method: GET
    title: Test
    description: Test
`;
        // Using JSON_SCHEMA should reject these tags with a parse error
        expect(() => loadApiSchemaFromString(maliciousYaml)).toThrow(ApiSchemaLoadError);
    });
});

// --- Input Schema Generation Tests ---

describe("generateInputSchema", () => {
    it("generates schema for string parameter", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                { name: "query", in: "query", type: "string", required: true },
            ],
        };

        const schema = generateInputSchema(endpoint);
        const result = schema.safeParse({ query: "test" });
        expect(result.success).toBe(true);
    });

    it("generates schema for number parameter", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                { name: "limit", in: "query", type: "number", required: true },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ limit: 10 }).success).toBe(true);
        expect(schema.safeParse({ limit: "10" }).success).toBe(false);
    });

    it("generates schema for integer parameter", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                { name: "page", in: "query", type: "integer", required: true },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ page: 1 }).success).toBe(true);
        expect(schema.safeParse({ page: 1.5 }).success).toBe(false);
    });

    it("generates schema for boolean parameter", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                { name: "active", in: "query", type: "boolean", required: true },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ active: true }).success).toBe(true);
        expect(schema.safeParse({ active: "true" }).success).toBe(false);
    });

    it("generates schema for enum parameter", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                {
                    name: "status",
                    in: "query",
                    type: "string",
                    required: true,
                    enum: ["active", "inactive"],
                },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ status: "active" }).success).toBe(true);
        expect(schema.safeParse({ status: "pending" }).success).toBe(false);
    });

    it("makes optional parameters optional", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                { name: "optional", in: "query", type: "string", required: false },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ optional: "value" }).success).toBe(true);
    });

    it("adds filter_preset for endpoints with filter presets", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            response: {
                filterPresets: [
                    { name: "summary", jqFilter: ".summary" },
                    { name: "full", jqFilter: "." },
                ],
            },
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ filter_preset: "summary" }).success).toBe(true);
        expect(schema.safeParse({ filter_preset: "invalid" }).success).toBe(false);
    });

    it("handles single-element filter preset with z.literal()", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            response: {
                filterPresets: [
                    { name: "minimal", jqFilter: ".id" },
                ],
            },
        };

        const schema = generateInputSchema(endpoint);
        // Single-element enum uses z.literal() - should accept the single value
        expect(schema.safeParse({ filter_preset: "minimal" }).success).toBe(true);
        // Should reject other values
        expect(schema.safeParse({ filter_preset: "other" }).success).toBe(false);
        // Should allow omitting the optional preset
        expect(schema.safeParse({}).success).toBe(true);
    });

    it("generates schema for single-element string enum", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                {
                    name: "format",
                    in: "query",
                    type: "string",
                    required: true,
                    enum: ["json"], // Single-element string enum
                },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ format: "json" }).success).toBe(true);
        expect(schema.safeParse({ format: "xml" }).success).toBe(false);
    });

    it("generates schema for single-element number enum", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                {
                    name: "version",
                    in: "query",
                    type: "integer",
                    required: true,
                    enum: [1], // Single-element number enum
                },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ version: 1 }).success).toBe(true);
        expect(schema.safeParse({ version: 2 }).success).toBe(false);
    });

    it("generates schema for multi-element number enum", () => {
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            parameters: [
                {
                    name: "version",
                    in: "query",
                    type: "integer",
                    required: true,
                    enum: [1, 2, 3],
                },
            ],
        };

        const schema = generateInputSchema(endpoint);
        expect(schema.safeParse({ version: 1 }).success).toBe(true);
        expect(schema.safeParse({ version: 2 }).success).toBe(true);
        expect(schema.safeParse({ version: 4 }).success).toBe(false);
    });
});

// --- URL Building Tests ---

describe("buildUrl", () => {
    it("builds simple URL", () => {
        const url = buildUrl("https://api.example.com", "/items", {}, {});
        expect(url).toBe("https://api.example.com/items");
    });

    it("substitutes path parameters", () => {
        const url = buildUrl(
            "https://api.example.com",
            "/items/{id}",
            { id: "123" },
            {}
        );
        expect(url).toBe("https://api.example.com/items/123");
    });

    it("encodes path parameters", () => {
        const url = buildUrl(
            "https://api.example.com",
            "/search/{query}",
            { query: "hello world" },
            {}
        );
        expect(url).toBe("https://api.example.com/search/hello%20world");
    });

    it("appends query parameters", () => {
        const url = buildUrl(
            "https://api.example.com",
            "/items",
            {},
            { page: "1", limit: "10" }
        );
        expect(url).toBe("https://api.example.com/items?page=1&limit=10");
    });

    it("handles trailing slash in baseUrl", () => {
        const url = buildUrl("https://api.example.com/", "/items", {}, {});
        expect(url).toBe("https://api.example.com/items");
    });

    it("handles multiple path parameters", () => {
        const url = buildUrl(
            "https://api.example.com",
            "/users/{userId}/posts/{postId}",
            { userId: "42", postId: "99" },
            {}
        );
        expect(url).toBe("https://api.example.com/users/42/posts/99");
    });
});

// --- Auth Config Tests ---

describe("getAuthConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("returns empty config when no auth specified", () => {
        const result = getAuthConfig(undefined);
        expect(result.headers).toEqual({});
        expect(result.queryParams).toEqual({});
    });

    it("extracts header API key from env", () => {
        process.env.MY_API_KEY = "secret123";

        const result = getAuthConfig({
            apiKey: {
                type: "header",
                name: "X-API-Key",
                envVar: "MY_API_KEY",
            },
        });

        expect(result.headers["X-API-Key"]).toBe("secret123");
        expect(result.queryParams).toEqual({});
    });

    it("extracts query API key from env", () => {
        process.env.MY_API_KEY = "secret123";

        const result = getAuthConfig({
            apiKey: {
                type: "query",
                name: "api_key",
                envVar: "MY_API_KEY",
            },
        });

        expect(result.queryParams.api_key).toBe("secret123");
        expect(result.headers).toEqual({});
    });

    it("extracts bearer token from env", () => {
        process.env.MY_TOKEN = "token123";

        const result = getAuthConfig({
            bearer: {
                envVar: "MY_TOKEN",
            },
        });

        expect(result.headers.Authorization).toBe("Bearer token123");
    });

    it("throws on missing required API key", () => {
        expect(() =>
            getAuthConfig({
                apiKey: {
                    type: "header",
                    name: "X-API-Key",
                    envVar: "MISSING_KEY",
                    required: true,
                },
            })
        ).toThrow(AuthenticationError);
    });

    it("does not throw on missing optional API key", () => {
        const result = getAuthConfig({
            apiKey: {
                type: "header",
                name: "X-API-Key",
                envVar: "MISSING_KEY",
                required: false,
            },
        });

        expect(result.headers).toEqual({});
    });

    it("uses override values when provided", () => {
        const result = getAuthConfig(
            {
                apiKey: {
                    type: "header",
                    name: "X-API-Key",
                    envVar: "MY_API_KEY",
                },
            },
            { MY_API_KEY: "override-value" }
        );

        expect(result.headers["X-API-Key"]).toBe("override-value");
    });

    it("supports both API key and bearer simultaneously", () => {
        process.env.MY_API_KEY = "key123";
        process.env.MY_TOKEN = "token123";

        const result = getAuthConfig({
            apiKey: {
                type: "header",
                name: "X-API-Key",
                envVar: "MY_API_KEY",
            },
            bearer: {
                envVar: "MY_TOKEN",
            },
        });

        expect(result.headers["X-API-Key"]).toBe("key123");
        expect(result.headers.Authorization).toBe("Bearer token123");
    });
});
