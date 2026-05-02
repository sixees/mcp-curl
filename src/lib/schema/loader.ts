// src/lib/schema/loader.ts
// YAML file loading and parsing for API schema definitions

import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { validateApiSchema } from "./validator.js";
import { sanitizeDescription } from "../utils/index.js";
import type { ApiSchema } from "./types.js";

/**
 * Error thrown when loading an API schema fails.
 */
export class ApiSchemaLoadError extends Error {
    constructor(
        message: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = "ApiSchemaLoadError";
    }
}

/**
 * Parse YAML content safely using JSON_SCHEMA to prevent code execution.
 *
 * @param content - YAML string content to parse
 * @returns Parsed YAML as unknown type
 * @throws ApiSchemaLoadError if parsing fails
 */
function parseYaml(content: string): unknown {
    try {
        // Use JSON_SCHEMA to prevent arbitrary code execution via YAML tags
        // like !!js/function. JSON_SCHEMA only allows basic JSON types.
        return yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (error) {
        if (error instanceof yaml.YAMLException) {
            const lineInfo = error.mark
                ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
                : "";
            throw new ApiSchemaLoadError(
                `Failed to parse YAML${lineInfo}: ${error.message}`,
                error
            );
        }
        throw new ApiSchemaLoadError(
            `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error : new Error(String(error))
        );
    }
}

/**
 * Pre-Zod sanitisation of every user-facing description string in a parsed
 * YAML object (PR-6a / B9 — A8 belt-and-braces).
 *
 * `ApiSchemaValidator`'s `.transform()` step is the authoritative sanitiser,
 * but a malformed payload may produce Zod issue messages that *quote* the raw
 * (attacker-controlled) values *before* `.transform()` runs. Pre-walking the
 * raw object here keeps those error messages clean while leaving the schema's
 * sanitiser as the load-bearing invariant.
 *
 * Tolerant by design: any unexpected shape (non-object, missing keys, wrong
 * types) is left untouched — Zod will reject it with a normal validation error
 * downstream.
 */
function sanitizeRawYamlDescriptions(parsed: unknown): unknown {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
    }

    const root = parsed as Record<string, unknown>;
    const api = root.api;
    if (api && typeof api === "object" && !Array.isArray(api)) {
        const apiObj = api as Record<string, unknown>;
        if (typeof apiObj.title === "string") apiObj.title = sanitizeDescription(apiObj.title);
        if (typeof apiObj.description === "string") apiObj.description = sanitizeDescription(apiObj.description);
    }

    const endpoints = root.endpoints;
    if (Array.isArray(endpoints)) {
        for (const endpoint of endpoints) {
            if (!endpoint || typeof endpoint !== "object") continue;
            const ep = endpoint as Record<string, unknown>;

            if (typeof ep.title === "string") ep.title = sanitizeDescription(ep.title);
            if (typeof ep.description === "string") ep.description = sanitizeDescription(ep.description);

            if (Array.isArray(ep.parameters)) {
                for (const parameter of ep.parameters) {
                    if (!parameter || typeof parameter !== "object") continue;
                    const param = parameter as Record<string, unknown>;
                    if (typeof param.description === "string") {
                        param.description = sanitizeDescription(param.description);
                    }
                }
            }

            const response = ep.response;
            if (response && typeof response === "object" && !Array.isArray(response)) {
                const presets = (response as Record<string, unknown>).filterPresets;
                if (Array.isArray(presets)) {
                    for (const preset of presets) {
                        if (!preset || typeof preset !== "object") continue;
                        const p = preset as Record<string, unknown>;
                        if (typeof p.name === "string") p.name = sanitizeDescription(p.name);
                        if (typeof p.description === "string") {
                            p.description = sanitizeDescription(p.description);
                        }
                    }
                }
            }
        }
    }

    return parsed;
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
export async function loadApiSchema(definitionPath: string): Promise<ApiSchema> {
    let content: string;

    try {
        content = await readFile(definitionPath, "utf-8");
    } catch (error) {
        throw new ApiSchemaLoadError(
            `Failed to read API schema file: ${definitionPath}`,
            error instanceof Error ? error : undefined
        );
    }

    const parsed = parseYaml(content);

    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError(
            `API schema file is empty: ${definitionPath}`
        );
    }

    return validateApiSchema(sanitizeRawYamlDescriptions(parsed));
}

/**
 * Load and validate an API schema from a YAML string.
 * Useful for testing or inline schema definitions.
 *
 * @param yamlContent - YAML content as a string
 * @returns Validated ApiSchema
 * @throws ApiSchemaLoadError if YAML parsing fails
 * @throws ApiSchemaValidationError if schema validation fails
 */
export function loadApiSchemaFromString(yamlContent: string): ApiSchema {
    const parsed = parseYaml(yamlContent);

    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError("API schema content is empty");
    }

    return validateApiSchema(sanitizeRawYamlDescriptions(parsed));
}
