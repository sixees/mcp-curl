/**
 * Safely extract an error message from an unknown error value.
 * Handles both Error objects and arbitrary thrown values.
 */
export declare function getErrorMessage(error: unknown): string;
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
export declare function createValidationError(field: string, reason: string, suggestion?: string): Error;
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
export declare function createAccessError(action: string, reason: string): Error;
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
export declare function createFileError(filepath: string, reason: string): Error;
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
export declare function createConfigError(configName: string, value: string, reason: string): Error;
