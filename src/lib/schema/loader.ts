// src/lib/schema/loader.ts
// YAML file loading and parsing for API schema definitions

import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { validateApiSchema, ApiSchemaValidationError } from "./validator.js";
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
 * Load and validate an API schema from a YAML file.
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

    let parsed: unknown;

    try {
        parsed = yaml.load(content);
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
            error instanceof Error ? error : undefined
        );
    }

    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError(
            `API schema file is empty: ${definitionPath}`
        );
    }

    return validateApiSchema(parsed);
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
    let parsed: unknown;

    try {
        parsed = yaml.load(yamlContent);
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
            error instanceof Error ? error : undefined
        );
    }

    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError("API schema content is empty");
    }

    return validateApiSchema(parsed);
}
