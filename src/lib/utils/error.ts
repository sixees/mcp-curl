// src/lib/utils/error.ts
// Error handling utilities

/**
 * Safely extract an error message from an unknown error value.
 * Handles both Error objects and arbitrary thrown values.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * Create a validation error with consistent formatting.
 *
 * @param field - The field or value being validated (e.g., "filepath", "array index")
 * @param reason - Why validation failed
 * @param suggestion - Optional suggestion for fixing the issue
 *
 * @example
 * createValidationError("filepath", "path traversal detected", "Provide a direct path without '..' components")
 * // Error: Invalid filepath: path traversal detected. Provide a direct path without '..' components.
 */
export function createValidationError(field: string, reason: string, suggestion?: string): Error {
    let message = `Invalid ${field}: ${reason}.`;
    if (suggestion) {
        message += ` ${suggestion}`;
        // Ensure suggestion ends with period
        if (!suggestion.endsWith(".")) {
            message += ".";
        }
    }
    return new Error(message);
}

/**
 * Create an access denied error with consistent formatting.
 *
 * @param action - What was being attempted (e.g., "Requests to localhost")
 * @param reason - Why access was denied
 *
 * @example
 * createAccessError("Requests to localhost", "blocked by default")
 * // Error: Requests to localhost are not allowed: blocked by default.
 */
export function createAccessError(action: string, reason: string): Error {
    return new Error(`${action} are not allowed: ${reason}.`);
}

/**
 * Create a file-related error with consistent formatting.
 *
 * @param filepath - The file path that caused the error
 * @param reason - What went wrong (e.g., "does not exist", "is not readable")
 *
 * @example
 * createFileError("/path/to/file.json", "does not exist")
 * // Error: File "/path/to/file.json" does not exist.
 */
export function createFileError(filepath: string, reason: string): Error {
    return new Error(`File "${filepath}" ${reason}.`);
}

/**
 * Create a configuration/environment variable error with consistent formatting.
 *
 * @param configName - The config or env var name (e.g., "MCP_CURL_OUTPUT_DIR")
 * @param value - The invalid value
 * @param reason - Why the value is invalid
 *
 * @example
 * createConfigError("MCP_CURL_OUTPUT_DIR", "/invalid/path", "directory does not exist")
 * // Error: Invalid MCP_CURL_OUTPUT_DIR value "/invalid/path": directory does not exist.
 */
export function createConfigError(configName: string, value: string, reason: string): Error {
    return new Error(`Invalid ${configName} value "${value}": ${reason}.`);
}
