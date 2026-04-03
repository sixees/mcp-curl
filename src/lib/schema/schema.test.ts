// src/lib/schema/schema.test.ts
// Tests for the API schema system

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    validateApiSchema,
    ApiSchemaValidationError,
    loadApiSchema,
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

    it("rejects ftp:// baseUrl", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                api: { ...validSchema.api, baseUrl: "ftp://evil.com" },
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects file:// baseUrl", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                api: { ...validSchema.api, baseUrl: "file:///etc/passwd" },
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects data: baseUrl", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                api: { ...validSchema.api, baseUrl: "data:text/html,<h1>evil</h1>" },
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects javascript: baseUrl", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                api: { ...validSchema.api, baseUrl: "javascript:alert(1)" },
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

    it("accepts optional description on filter presets", () => {
        const result = validateApiSchema({
            ...validSchema,
            endpoints: [
                {
                    ...validSchema.endpoints[0],
                    response: {
                        filterPresets: [
                            { name: "summary", jqFilter: ".summary", description: "Brief overview" },
                            { name: "raw", jqFilter: "." },
                        ],
                    },
                },
            ],
        });
        expect(result.endpoints[0].response?.filterPresets?.[0].description).toBe("Brief overview");
        expect(result.endpoints[0].response?.filterPresets?.[1].description).toBeUndefined();
    });

    it("rejects overly long description on filter presets", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    {
                        ...validSchema.endpoints[0],
                        response: {
                            filterPresets: [
                                { name: "summary", jqFilter: ".summary", description: "x".repeat(501) },
                            ],
                        },
                    },
                ],
            })
        ).toThrow(ApiSchemaValidationError);
    });

    it("rejects empty description string on filter presets", () => {
        expect(() =>
            validateApiSchema({
                ...validSchema,
                endpoints: [
                    {
                        ...validSchema.endpoints[0],
                        response: {
                            filterPresets: [
                                { name: "summary", jqFilter: ".summary", description: "" },
                            ],
                        },
                    },
                ],
            })
        ).toThrow(ApiSchemaValidationError);
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

// --- File-based Loader Tests ---

describe("loadApiSchema (file-based)", () => {
    const testDir = join(tmpdir(), `mcp-curl-schema-test-${Date.now()}`);
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

    beforeEach(async () => {
        await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up all test files
        try {
            const { readdir } = await import("fs/promises");
            const files = await readdir(testDir);
            for (const file of files) {
                await unlink(join(testDir, file)).catch(() => {});
            }
            await rmdir(testDir).catch(() => {});
        } catch {
            // Ignore cleanup errors
        }
    });

    it("loads schema from valid YAML file", async () => {
        const filePath = join(testDir, "valid-schema.yaml");
        await writeFile(filePath, validYaml, "utf-8");

        const result = await loadApiSchema(filePath);

        expect(result.api.name).toBe("test-api");
        expect(result.endpoints).toHaveLength(1);
        expect(result.endpoints[0].id).toBe("get_item");
    });

    it("throws ApiSchemaLoadError for non-existent file", async () => {
        const filePath = join(testDir, "non-existent.yaml");

        await expect(loadApiSchema(filePath)).rejects.toThrow(ApiSchemaLoadError);
        await expect(loadApiSchema(filePath)).rejects.toThrow(/Failed to read API schema file/);
    });

    it("throws ApiSchemaLoadError for empty file", async () => {
        const filePath = join(testDir, "empty-schema.yaml");
        await writeFile(filePath, "", "utf-8");

        await expect(loadApiSchema(filePath)).rejects.toThrow(ApiSchemaLoadError);
        await expect(loadApiSchema(filePath)).rejects.toThrow(/empty/);
    });

    it("throws ApiSchemaLoadError for file with only whitespace/comments", async () => {
        const filePath = join(testDir, "whitespace-schema.yaml");
        await writeFile(filePath, "# Just a comment\n\n", "utf-8");

        await expect(loadApiSchema(filePath)).rejects.toThrow(ApiSchemaLoadError);
        await expect(loadApiSchema(filePath)).rejects.toThrow(/empty/);
    });

    it("throws ApiSchemaValidationError for invalid schema in file", async () => {
        const filePath = join(testDir, "invalid-schema.yaml");
        const invalidYaml = validYaml.replace('apiVersion: "1.0"', 'apiVersion: "2.0"');
        await writeFile(filePath, invalidYaml, "utf-8");

        await expect(loadApiSchema(filePath)).rejects.toThrow(ApiSchemaValidationError);
    });

    it("throws ApiSchemaLoadError for invalid YAML syntax in file", async () => {
        const filePath = join(testDir, "invalid-yaml.yaml");
        await writeFile(filePath, "invalid: yaml: content:", "utf-8");

        await expect(loadApiSchema(filePath)).rejects.toThrow(ApiSchemaLoadError);
        await expect(loadApiSchema(filePath)).rejects.toThrow(/Failed to parse YAML/);
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

    it("throws on missing required bearer token", () => {
        expect(() =>
            getAuthConfig({
                bearer: {
                    envVar: "MISSING_BEARER_TOKEN",
                    required: true,
                },
            })
        ).toThrow(AuthenticationError);
    });

    it("does not throw on missing optional bearer token", () => {
        const result = getAuthConfig({
            bearer: {
                envVar: "MISSING_BEARER_TOKEN",
                required: false,
            },
        });

        expect(result.headers).toEqual({});
    });
});

// --- Handler Execution Tests ---

import { vi, type Mock } from "vitest";
import { generateToolDefinitions } from "./generator.js";
import * as curlExecuteModule from "../tools/curl-execute.js";

// Mock executeCurlRequest
vi.mock("../tools/curl-execute.js", () => ({
    executeCurlRequest: vi.fn(),
}));

describe("generateToolDefinitions", () => {
    const mockedExecuteCurlRequest = curlExecuteModule.executeCurlRequest as Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockedExecuteCurlRequest.mockResolvedValue({
            content: [{ type: "text", text: '{"result": "ok"}' }],
            isError: false,
        });
    });

    const baseSchema: ApiSchema = {
        apiVersion: "1.0",
        api: {
            name: "test-api",
            title: "Test API",
            description: "A test API",
            version: "1.0.0",
            baseUrl: "https://api.example.com",
        },
        endpoints: [],
    };

    it("generates handlers that call executeCurlRequest with correct URL", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_user",
                    path: "/users/{id}",
                    method: "GET",
                    title: "Get User",
                    description: "Fetch a user by ID",
                    parameters: [
                        { name: "id", in: "path", type: "string", required: true },
                    ],
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools).toHaveLength(1);

        await tools[0].handler({ id: "123" });

        expect(mockedExecuteCurlRequest).toHaveBeenCalledOnce();
        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://api.example.com/users/123",
                method: "GET",
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("separates parameters by location (path, query, header)", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "search",
                    path: "/search/{category}",
                    method: "GET",
                    title: "Search",
                    description: "Search items",
                    parameters: [
                        { name: "category", in: "path", type: "string", required: true },
                        { name: "q", in: "query", type: "string", required: true },
                        { name: "limit", in: "query", type: "integer", required: false },
                        { name: "X-Request-ID", in: "header", type: "string", required: false },
                    ],
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        await tools[0].handler({
            category: "books",
            q: "typescript",
            limit: 10,
            "X-Request-ID": "req-123",
        });

        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://api.example.com/search/books?q=typescript&limit=10",
                headers: expect.objectContaining({
                    "X-Request-ID": "req-123",
                }),
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("applies default parameter values", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "list_items",
                    path: "/items",
                    method: "GET",
                    title: "List Items",
                    description: "List all items",
                    parameters: [
                        { name: "page", in: "query", type: "integer", required: false, default: 1 },
                        { name: "limit", in: "query", type: "integer", required: false, default: 20 },
                    ],
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        await tools[0].handler({}); // No params provided, should use defaults

        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://api.example.com/items?page=1&limit=20",
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("merges headers in correct precedence order", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            defaults: {
                headers: {
                    "Accept": "application/json",
                    "X-Default-Header": "default-value",
                },
            },
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    parameters: [
                        { name: "X-Custom", in: "header", type: "string", required: false },
                    ],
                },
            ],
        };

        const tools = generateToolDefinitions(schema, {
            defaultHeaders: { "X-Config-Header": "config-value" },
        });
        await tools[0].handler({ "X-Custom": "custom-value" });

        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Accept": "application/json",
                    "X-Default-Header": "default-value",
                    "X-Config-Header": "config-value",
                    "X-Custom": "custom-value",
                }),
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("passes jq_filter from preset selection", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_user",
                    path: "/users/{id}",
                    method: "GET",
                    title: "Get User",
                    description: "Fetch a user",
                    parameters: [
                        { name: "id", in: "path", type: "string", required: true },
                    ],
                    response: {
                        jqFilter: ".data",
                        filterPresets: [
                            { name: "summary", jqFilter: "{name: .data.name, email: .data.email}" },
                            { name: "full", jqFilter: "." },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);

        // Test with preset selection
        await tools[0].handler({ id: "123", filter_preset: "summary" });
        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                jq_filter: "{name: .data.name, email: .data.email}",
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );

        // Test without preset (uses default filter)
        vi.clearAllMocks();
        await tools[0].handler({ id: "123" });
        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                jq_filter: ".data",
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("returns error result for AuthenticationError", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            auth: {
                apiKey: {
                    type: "header",
                    name: "X-API-Key",
                    envVar: "TEST_API_KEY_NOT_SET",
                    required: true,
                },
            },
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        const result = await tools[0].handler({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Authentication error");
        expect(result.content[0].text).toContain("TEST_API_KEY_NOT_SET");
        expect(mockedExecuteCurlRequest).not.toHaveBeenCalled();
    });

    it("returns error result for invalid filter preset", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_user",
                    path: "/users/{id}",
                    method: "GET",
                    title: "Get User",
                    description: "Fetch a user",
                    parameters: [
                        { name: "id", in: "path", type: "string", required: true },
                    ],
                    response: {
                        filterPresets: [
                            { name: "summary", jqFilter: ".summary" },
                            { name: "full", jqFilter: "." },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        // Note: The input schema validation would normally prevent invalid preset names,
        // but we're testing the runtime error handling for the handler
        const result = await tools[0].handler({ id: "123", filter_preset: "nonexistent" });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Unknown filter preset "nonexistent"');
        expect(result.content[0].text).toContain("summary, full");
        expect(mockedExecuteCurlRequest).not.toHaveBeenCalled();
    });

    it("handles body parameters for POST requests", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "create_user",
                    path: "/users",
                    method: "POST",
                    title: "Create User",
                    description: "Create a new user",
                    parameters: [
                        { name: "body", in: "body", type: "string", required: true },
                    ],
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        await tools[0].handler({ body: '{"name": "John", "email": "john@example.com"}' });

        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://api.example.com/users",
                method: "POST",
                data: '{"name": "John", "email": "john@example.com"}',
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });

    it("uses preset description in tool description when present", () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    response: {
                        filterPresets: [
                            { name: "summary", jqFilter: ".summary", description: "Returns a brief summary" },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools[0].description).toContain("summary: Returns a brief summary");
        expect(tools[0].description).not.toContain('applies filter');
    });

    it("falls back to jqFilter text when description is absent", () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    response: {
                        filterPresets: [
                            { name: "ids_only", jqFilter: ".results[].id" },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools[0].description).toContain('ids_only: applies filter ".results[].id"');
    });

    it("handles mixed presets with and without descriptions", () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    response: {
                        filterPresets: [
                            { name: "summary", jqFilter: ".summary", description: "Brief overview" },
                            { name: "raw", jqFilter: "." },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools[0].description).toContain("summary: Brief overview");
        expect(tools[0].description).toContain('raw: applies filter "."');
    });

    it("strips Unicode bidi overrides and zero-width characters from descriptions", () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    response: {
                        filterPresets: [
                            {
                                name: "safe",
                                jqFilter: ".data",
                                // Bidi override (U+202E) + zero-width space (U+200B) + C1 control (U+0085)
                                description: "normal\u202Ehidden\u200Btext\u0085end",
                            },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools[0].description).toContain("safe: normal hidden text end");
        // Verify no bidi/zero-width chars remain
        expect(tools[0].description).not.toMatch(/[\u202E\u200B\u0085]/);
    });

    it("strips control characters from jqFilter in fallback description", () => {
        const schema: ApiSchema = {
            ...baseSchema,
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                    response: {
                        filterPresets: [
                            {
                                name: "ids",
                                jqFilter: ".results\u200B[].id",
                            },
                        ],
                    },
                },
            ],
        };

        const tools = generateToolDefinitions(schema);
        expect(tools[0].description).toContain('ids: applies filter ".results [].id"');
        expect(tools[0].description).not.toMatch(/[\u200B]/);
    });

    it("uses auth override from generator config", async () => {
        const schema: ApiSchema = {
            ...baseSchema,
            auth: {
                bearer: {
                    envVar: "TEST_TOKEN",
                    required: true,
                },
            },
            endpoints: [
                {
                    id: "get_data",
                    path: "/data",
                    method: "GET",
                    title: "Get Data",
                    description: "Get data",
                },
            ],
        };

        const tools = generateToolDefinitions(schema, {
            authOverride: { TEST_TOKEN: "mock-token-123" },
        });
        await tools[0].handler({});

        expect(mockedExecuteCurlRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer mock-token-123",
                }),
            }),
            expect.objectContaining({ allowLocalhost: undefined })
        );
    });
});
