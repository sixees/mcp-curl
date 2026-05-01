// src/lib.test.ts
// Public-barrel reference-identity guard.
//
// The library has a single public entry point (src/lib.ts). External callers
// should import everything from there — never from deep paths like
// "mcp-curl/dist/lib/utils/sanitize.js". This test pins the contract: each
// symbol re-exported by the barrel MUST be the same reference as the deep
// import it forwards. A barrel that silently re-wraps a function (e.g. via
// a default export shim, an accidental `export const x = lib.x`, or a
// per-section re-implementation) would break the identity check and fail
// here — caller-side === comparisons, prototype lookups, and instanceof
// checks would all silently regress without it.

import { describe, it, expect } from "vitest";
import * as publicApi from "./lib.js";

import { McpCurlServer, createInstanceUtilities } from "./lib/extensible/index.js";
import { createApiServer, createApiServerSync } from "./lib/api-server.js";
import {
    ApiSchemaValidator,
    ApiSchemaValidationError,
    validateApiSchema,
    ApiSchemaLoadError,
    loadApiSchema,
    loadApiSchemaFromString,
    AuthenticationError,
    generateInputSchema,
    buildUrl,
    getAuthConfig,
    registerEndpointTools,
    generateToolDefinitions,
    getMethodAnnotations,
} from "./lib/schema/index.js";
import {
    sanitizeDescription,
    MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH,
    sanitizeResponse,
    detectInjectionPattern,
    applySpotlighting,
    createHttpOnlyUrlSchema,
    safeHostname,
} from "./lib/utils/index.js";
import { sanitizeAndDetect, logInjectionDetected } from "./lib/security/detection-logger.js";

describe("public barrel (src/lib.ts)", () => {
    describe("re-exports the same reference as the deep import", () => {
        // Section 1 — server class
        it("McpCurlServer", () => {
            expect(publicApi.McpCurlServer).toBe(McpCurlServer);
        });

        // Section 2 — instance utilities
        it("createInstanceUtilities", () => {
            expect(publicApi.createInstanceUtilities).toBe(createInstanceUtilities);
        });

        // Section 3 — API server factory
        it("createApiServer", () => {
            expect(publicApi.createApiServer).toBe(createApiServer);
        });
        it("createApiServerSync", () => {
            expect(publicApi.createApiServerSync).toBe(createApiServerSync);
        });

        // Section 4 — schema utilities
        it("ApiSchemaValidator", () => {
            expect(publicApi.ApiSchemaValidator).toBe(ApiSchemaValidator);
        });
        it("ApiSchemaValidationError", () => {
            expect(publicApi.ApiSchemaValidationError).toBe(ApiSchemaValidationError);
        });
        it("validateApiSchema", () => {
            expect(publicApi.validateApiSchema).toBe(validateApiSchema);
        });
        it("ApiSchemaLoadError", () => {
            expect(publicApi.ApiSchemaLoadError).toBe(ApiSchemaLoadError);
        });
        it("loadApiSchema", () => {
            expect(publicApi.loadApiSchema).toBe(loadApiSchema);
        });
        it("loadApiSchemaFromString", () => {
            expect(publicApi.loadApiSchemaFromString).toBe(loadApiSchemaFromString);
        });
        it("AuthenticationError", () => {
            expect(publicApi.AuthenticationError).toBe(AuthenticationError);
        });
        it("generateInputSchema", () => {
            expect(publicApi.generateInputSchema).toBe(generateInputSchema);
        });
        it("buildUrl", () => {
            expect(publicApi.buildUrl).toBe(buildUrl);
        });
        it("getAuthConfig", () => {
            expect(publicApi.getAuthConfig).toBe(getAuthConfig);
        });
        it("registerEndpointTools", () => {
            expect(publicApi.registerEndpointTools).toBe(registerEndpointTools);
        });
        it("generateToolDefinitions", () => {
            expect(publicApi.generateToolDefinitions).toBe(generateToolDefinitions);
        });
        it("getMethodAnnotations", () => {
            expect(publicApi.getMethodAnnotations).toBe(getMethodAnnotations);
        });

        // Section 6 — metadata sanitization helpers
        it("sanitizeDescription", () => {
            expect(publicApi.sanitizeDescription).toBe(sanitizeDescription);
        });
        it("MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH", () => {
            expect(publicApi.MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH).toBe(
                MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH
            );
        });

        // Section 7 — response-side defence helpers
        it("applySpotlighting", () => {
            expect(publicApi.applySpotlighting).toBe(applySpotlighting);
        });
        it("sanitizeResponse", () => {
            expect(publicApi.sanitizeResponse).toBe(sanitizeResponse);
        });
        it("detectInjectionPattern", () => {
            expect(publicApi.detectInjectionPattern).toBe(detectInjectionPattern);
        });
        it("sanitizeAndDetect", () => {
            expect(publicApi.sanitizeAndDetect).toBe(sanitizeAndDetect);
        });
        it("logInjectionDetected", () => {
            expect(publicApi.logInjectionDetected).toBe(logInjectionDetected);
        });

        // Section 8 — URL validation helpers
        it("createHttpOnlyUrlSchema", () => {
            expect(publicApi.createHttpOnlyUrlSchema).toBe(createHttpOnlyUrlSchema);
        });
        it("safeHostname", () => {
            expect(publicApi.safeHostname).toBe(safeHostname);
        });
    });

    it("does not export anything unexpected (frozen surface)", () => {
        // If a future PR adds an export, update this list deliberately.
        // The intent is to catch accidental re-exports (e.g. a `export *` that
        // pulls in private internals) at review time, not to make additions hard.
        const expected = new Set([
            "McpCurlServer",
            "createInstanceUtilities",
            "createApiServer",
            "createApiServerSync",
            "ApiSchemaValidator",
            "ApiSchemaValidationError",
            "validateApiSchema",
            "ApiSchemaLoadError",
            "loadApiSchema",
            "loadApiSchemaFromString",
            "AuthenticationError",
            "generateInputSchema",
            "buildUrl",
            "getAuthConfig",
            "registerEndpointTools",
            "generateToolDefinitions",
            "getMethodAnnotations",
            "sanitizeDescription",
            "MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH",
            "applySpotlighting",
            "sanitizeResponse",
            "detectInjectionPattern",
            "sanitizeAndDetect",
            "logInjectionDetected",
            "createHttpOnlyUrlSchema",
            "safeHostname",
        ]);
        const actual = new Set(Object.keys(publicApi));
        expect(actual).toEqual(expected);
    });
});
