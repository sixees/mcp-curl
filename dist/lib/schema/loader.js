// src/lib/schema/loader.ts
// YAML file loading and parsing for API schema definitions
import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { validateApiSchema } from "./validator.js";
/**
 * Error thrown when loading an API schema fails.
 */
export class ApiSchemaLoadError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
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
export async function loadApiSchema(definitionPath) {
    let content;
    try {
        content = await readFile(definitionPath, "utf-8");
    }
    catch (error) {
        throw new ApiSchemaLoadError(`Failed to read API schema file: ${definitionPath}`, error instanceof Error ? error : undefined);
    }
    let parsed;
    try {
        parsed = yaml.load(content);
    }
    catch (error) {
        const yamlError = error;
        const lineInfo = yamlError.mark
            ? ` at line ${yamlError.mark.line + 1}, column ${yamlError.mark.column + 1}`
            : "";
        throw new ApiSchemaLoadError(`Failed to parse YAML${lineInfo}: ${yamlError.message}`, yamlError);
    }
    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError(`API schema file is empty: ${definitionPath}`);
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
export function loadApiSchemaFromString(yamlContent) {
    let parsed;
    try {
        parsed = yaml.load(yamlContent);
    }
    catch (error) {
        const yamlError = error;
        throw new ApiSchemaLoadError(`Failed to parse YAML: ${yamlError.message}`, yamlError);
    }
    if (parsed === null || parsed === undefined) {
        throw new ApiSchemaLoadError("API schema content is empty");
    }
    return validateApiSchema(parsed);
}
