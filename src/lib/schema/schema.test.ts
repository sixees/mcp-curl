// src/lib/schema/schema.test.ts
// Tests for the API schema system

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { z } from "zod";
import {
    validateApiSchema,
    ApiSchemaValidator,
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

    it("preserves manually-constructed (validator-bypassed) preset names verbatim", () => {
        // PR-6a / B9 boundary contract: schemas reaching the generator are
        // assumed pre-sanitised by ApiSchemaValidator, so the generator does
        // not re-sanitise. When a consumer bypasses the validator and feeds
        // raw values directly, the generator preserves them as-is. Duplicate-
        // after-sanitisation detection is now a validator-level concern — see
        // the validator-side test
        // "rejects duplicate filter preset names after sanitisation".
        const endpoint: EndpointDefinition = {
            id: "test",
            path: "/test",
            method: "GET",
            title: "Test",
            description: "Test endpoint",
            response: {
                filterPresets: [
                    { name: "Summary", jqFilter: ".a" },
                    { name: "\u200BSummary", jqFilter: ".b" },
                ],
            },
        };
        // Does NOT throw — generator now trusts pre-sanitised input.
        const schema = generateInputSchema(endpoint);
        // The raw (unsanitised) values reach the enum unchanged.
        expect(schema.safeParse({ filter_preset: "​Summary" }).success).toBe(true);
        expect(schema.safeParse({ filter_preset: "Summary" }).success).toBe(true);
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

    it("preserves bidi/zero-width chars when generator is called with validator-bypassed schema", () => {
        // PR-6a / B9 boundary: the generator no longer re-sanitises. When a
        // consumer constructs an ApiSchema by hand and skips ApiSchemaValidator,
        // the unsafe characters survive — documenting in code that sanitisation
        // is the validator's job, not the generator's. The validator-side path
        // is covered by the "ApiSchemaValidator sanitisation" suite.
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
        // Generator passes preset.description through verbatim — chars survive.
        expect(tools[0].description).toContain("safe: normal\u202Ehidden\u200Btext\u0085end");
        expect(tools[0].description).toMatch(/[\u202E\u200B\u0085]/);
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

// --- PR-6a / B9 sanitisation invariant ---
//
// These tests cover the trust-boundary contract introduced in PR-6a:
//   ApiSchemaValidator runs sanitizeDescription() on every user-facing string
//   field via a .transform() step, so every public entry point that produces
//   a parsed ApiSchema (loadApiSchema, loadApiSchemaFromString,
//   validateApiSchema, AND ApiSchemaValidator.parse() directly) yields a
//   pre-sanitised schema. The downstream generator does NOT re-sanitise.

describe("PR-6a sanitisation invariant", () => {
    const baseSchema = {
        apiVersion: "1.0" as const,
        api: {
            name: "test-api",
            title: "Test API",
            description: "A test API",
            version: "1.0",
            baseUrl: "https://api.example.com",
        },
        endpoints: [
            {
                id: "get_data",
                path: "/data",
                method: "GET" as const,
                title: "Get Data",
                description: "Fetch data",
            },
        ],
    };

    describe("ApiSchemaValidator.parse() (raw-validator-bypass path — S1)", () => {
        it("strips bidi/zero-width chars from endpoint.description", () => {
            const parsed = ApiSchemaValidator.parse({
                ...baseSchema,
                endpoints: [
                    {
                        ...baseSchema.endpoints[0],
                        // U+200B zero-width space + U+202E bidi override
                        description: "before​‮after",
                    },
                ],
            });
            expect(parsed.endpoints[0].description).not.toMatch(/[​‮]/);
        });

        it("strips bidi/zero-width chars from api.title and api.description", () => {
            const parsed = ApiSchemaValidator.parse({
                ...baseSchema,
                api: {
                    ...baseSchema.api,
                    title: "Title​x",
                    description: "Desc‮y",
                },
            });
            expect(parsed.api.title).not.toMatch(/[​]/);
            expect(parsed.api.description).not.toMatch(/[‮]/);
        });

        it("strips bidi/zero-width chars from parameter.description", () => {
            const parsed = ApiSchemaValidator.parse({
                ...baseSchema,
                endpoints: [
                    {
                        ...baseSchema.endpoints[0],
                        parameters: [
                            {
                                name: "q",
                                in: "query",
                                type: "string",
                                description: "Query​string",
                            },
                        ],
                    },
                ],
            });
            expect(parsed.endpoints[0].parameters?.[0].description).not.toMatch(/[​]/);
        });

        it("strips bidi/zero-width chars from filterPresets[*].name and description", () => {
            const parsed = ApiSchemaValidator.parse({
                ...baseSchema,
                endpoints: [
                    {
                        ...baseSchema.endpoints[0],
                        response: {
                            filterPresets: [
                                {
                                    name: "safe​one",
                                    jqFilter: ".a",
                                    description: "a‮b",
                                },
                            ],
                        },
                    },
                ],
            });
            const preset = parsed.endpoints[0].response?.filterPresets?.[0];
            expect(preset?.name).not.toMatch(/[​]/);
            expect(preset?.description).not.toMatch(/[‮]/);
        });

        it("rejects duplicate filter preset names after sanitisation", () => {
            // "Summary" and "​Summary" both sanitise to "Summary" — the
            // .superRefine() step inside ApiSchemaValidator must catch the
            // collision and surface it as a validation error rather than let
            // the generator silently pick the wrong jq filter at runtime.
            expect(() =>
                ApiSchemaValidator.parse({
                    ...baseSchema,
                    endpoints: [
                        {
                            ...baseSchema.endpoints[0],
                            response: {
                                filterPresets: [
                                    { name: "Summary", jqFilter: ".a" },
                                    { name: "​Summary", jqFilter: ".b" },
                                ],
                            },
                        },
                    ],
                })
            ).toThrow();
        });
    });

    describe("validateApiSchema() (wrapper parity)", () => {
        it("yields the same sanitised output as ApiSchemaValidator.parse()", () => {
            const raw = {
                ...baseSchema,
                endpoints: [
                    {
                        ...baseSchema.endpoints[0],
                        description: "x​y",
                    },
                ],
            };
            const direct = ApiSchemaValidator.parse(raw);
            const wrapped = validateApiSchema(structuredClone(raw));
            expect(wrapped.endpoints[0].description).toBe(direct.endpoints[0].description);
            expect(wrapped.endpoints[0].description).not.toMatch(/[​]/);
        });

        it("surfaces duplicate filter-preset names as ApiSchemaValidationError", () => {
            expect(() =>
                validateApiSchema({
                    ...baseSchema,
                    endpoints: [
                        {
                            ...baseSchema.endpoints[0],
                            response: {
                                filterPresets: [
                                    { name: "Summary", jqFilter: ".a" },
                                    { name: "​Summary", jqFilter: ".b" },
                                ],
                            },
                        },
                    ],
                })
            ).toThrow(ApiSchemaValidationError);
        });
    });

    describe("loadApiSchemaFromString() (round-trip)", () => {
        it("strips bidi/zero-width chars from endpoint.description in YAML", () => {
            // Inline YAML with a literal U+200B in the description field.
            const yamlContent =
                'apiVersion: "1.0"\n' +
                "api:\n" +
                "  name: test-api\n" +
                "  title: Test API\n" +
                "  description: A test API\n" +
                '  version: "1.0"\n' +
                "  baseUrl: https://api.example.com\n" +
                "endpoints:\n" +
                "  - id: get_data\n" +
                "    path: /data\n" +
                "    method: GET\n" +
                "    title: Get Data\n" +
                "    description: \"before​after\"\n";
            const result = loadApiSchemaFromString(yamlContent);
            expect(result.endpoints[0].description).not.toMatch(/[​]/);
        });
    });

    describe("preprocess sanitisation keeps Zod and cross-field error messages clean", () => {
        it("strips bidi/zero-width chars from raw values before Zod issue messages quote them", () => {
            // Construct an invalid YAML payload (baseUrl: not-a-url) where the
            // *attacker-controlled* api.title carries bidi chars. The
            // z.preprocess() step on ApiSchemaValidator sanitises raw fields
            // before Zod runs, so any Zod issue message that quotes a value
            // sees the sanitised form — raw bidi bytes never appear in error
            // logs even via direct ApiSchemaValidator.parse() callers.
            const yamlContent =
                'apiVersion: "1.0"\n' +
                "api:\n" +
                "  name: test-api\n" +
                "  title: \"hostile‮title\"\n" +
                "  description: A test API\n" +
                '  version: "1.0"\n' +
                "  baseUrl: not-a-url\n" + // triggers a Zod validation error
                "endpoints:\n" +
                "  - id: get_data\n" +
                "    path: /data\n" +
                "    method: GET\n" +
                "    title: Get Data\n" +
                "    description: Fetch\n";
            try {
                loadApiSchemaFromString(yamlContent);
                throw new Error("expected validation to fail");
            } catch (error) {
                expect(error).toBeInstanceOf(ApiSchemaValidationError);
                const err = error as ApiSchemaValidationError;
                // The error message may quote the api.title field somewhere;
                // the key invariant is that the raw bidi byte never appears.
                expect(err.message).not.toMatch(/[‮]/);
            }
        });
    });

    describe("integration #020: data: baseUrl rejection through every entry point", () => {
        const yamlWithDataUrl =
            'apiVersion: "1.0"\n' +
            "api:\n" +
            "  name: test-api\n" +
            "  title: Test API\n" +
            "  description: A test API\n" +
            '  version: "1.0"\n' +
            "  baseUrl: data:text/plain,evil\n" +
            "endpoints:\n" +
            "  - id: get_data\n" +
            "    path: /data\n" +
            "    method: GET\n" +
            "    title: Get Data\n" +
            "    description: Fetch\n";
        const rawWithDataUrl = {
            ...baseSchema,
            api: { ...baseSchema.api, baseUrl: "data:text/plain,evil" },
        };

        it("rejects via loadApiSchemaFromString", () => {
            expect(() => loadApiSchemaFromString(yamlWithDataUrl)).toThrow(
                ApiSchemaValidationError
            );
        });

        it("rejects via validateApiSchema", () => {
            expect(() => validateApiSchema(rawWithDataUrl)).toThrow(
                ApiSchemaValidationError
            );
        });

        it("rejects via ApiSchemaValidator.parse", () => {
            expect(() => ApiSchemaValidator.parse(rawWithDataUrl)).toThrow();
        });
    });

    describe("review-fix coverage (P1/P2 closure)", () => {
        it("rejects strings that sanitise to empty (P2 #4 — min(1) invariant)", () => {
            // A title of pure invisibles sanitises to "" and must be rejected
            // by the schema — the preprocess step runs before z.string().min(1).
            expect(() =>
                ApiSchemaValidator.parse({
                    ...baseSchema,
                    endpoints: [
                        {
                            ...baseSchema.endpoints[0],
                            title: "​​",
                        },
                    ],
                })
            ).toThrow();
        });

        it("strips bidi from endpoint.path so cross-field error messages are clean (P1 #2)", () => {
            // The path-param-not-defined error interpolates the param name
            // extracted from endpoint.path. With the preprocess sanitiser
            // running first, the path is cleaned before the regex extracts
            // the param name, so attacker-controlled bidi can never leak
            // into the error log.
            try {
                ApiSchemaValidator.parse({
                    ...baseSchema,
                    endpoints: [
                        {
                            ...baseSchema.endpoints[0],
                            path: "/items/{evil​param}",
                        },
                    ],
                });
                throw new Error("expected validation to fail");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).not.toMatch(/[​]/);
            }
        });

        it("strips bidi from endpoint.id so duplicate-id error messages are clean (P1 #2)", () => {
            // sanitizeDescription replaces matched control chars with a
            // single space, then trims edges. An *interior* ZWSP leaves an
            // interior space (would fail the id regex). To reach the
            // duplicate-id branch — which is what we want to verify produces
            // a clean message — put the bidi at the edges of the id so it
            // collapses to nothing after trim. Both endpoints then have id
            // "get_data" post-sanitise, the regex passes, and the duplicate
            // check inside `.transform()` fires. The error message must
            // therefore quote the SANITISED id (no bidi).
            try {
                ApiSchemaValidator.parse({
                    ...baseSchema,
                    endpoints: [
                        { ...baseSchema.endpoints[0], id: "​get_data" },
                        { ...baseSchema.endpoints[0], id: "get_data​" },
                    ],
                });
                throw new Error("expected validation to fail");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toMatch(/Duplicate endpoint ID: get_data/);
                expect(message).not.toMatch(/[​‮]/);
            }
        });

        it("generator.ts has at most one sanitizeDescription call (P3 #15 drift guard)", async () => {
            // The trust contract — "validator sanitises; generator trusts" —
            // is documented in code only. This test catches drift if a future
            // contributor reintroduces a redundant sanitiser call. The single
            // allowed call is the display-time interpolation of preset.jqFilter.
            const fs = await import("fs/promises");
            const url = await import("url");
            const path = await import("path");
            const here = path.dirname(url.fileURLToPath(import.meta.url));
            const generatorSource = await fs.readFile(
                path.resolve(here, "generator.ts"),
                "utf-8"
            );
            // Strip comments so the rule is enforced on real code, not docs.
            const codeOnly = generatorSource
                .split("\n")
                .filter((line) => !line.trim().startsWith("//"))
                .join("\n");
            const matches = codeOnly.match(/sanitizeDescription\(/g) ?? [];
            expect(matches.length).toBeLessThanOrEqual(1);
        });

        it("preprocess walker is tolerant of structurally-malformed input (P3 #16)", () => {
            // A non-object root and arrays-where-objects-expected must not
            // crash the walker — Zod will reject them with normal validation
            // errors. This regression test prevents future contributors from
            // adding strict checks that defeat the "tolerant by design" promise.
            expect(() => ApiSchemaValidator.parse(null)).toThrow();
            expect(() => ApiSchemaValidator.parse("not an object")).toThrow();
            expect(() => ApiSchemaValidator.parse({ api: "not-an-object", endpoints: [] })).toThrow();
            expect(() => ApiSchemaValidator.parse({ endpoints: "not-an-array" })).toThrow();
        });
    });

    describe("generator boundary: bypassing the validator skips sanitisation", () => {
        it("generateInputSchema preserves param.description verbatim when passed an unsanitised endpoint", () => {
            // Documents in code: validator sanitises; generator trusts. A
            // consumer who manually constructs an EndpointDefinition skipping
            // ApiSchemaValidator gets the description through verbatim.
            const endpoint = {
                id: "test",
                path: "/test",
                method: "GET" as const,
                title: "Test",
                description: "Test endpoint",
                parameters: [
                    {
                        name: "q",
                        in: "query" as const,
                        type: "string" as const,
                        description: "raw​desc",
                    },
                ],
            };
            const schema = generateInputSchema(endpoint);
            // Read the description through the public Zod-to-JSON-Schema
            // projection — this is what an MCP client actually sees, and it
            // travels through the optional() wrapper without hidden state.
            const json = z.toJSONSchema(schema) as {
                properties?: Record<string, { description?: string }>;
            };
            expect(json.properties?.q?.description).toBe("raw​desc");
        });
    });
});
