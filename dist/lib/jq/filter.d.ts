/**
 * Apply a single jq-like filter path to parsed JSON data.
 *
 * @param data - The parsed JSON data
 * @param filter - A single filter expression (e.g., ".data.items[0]")
 * @returns The extracted value, or null if path doesn't exist
 * @throws Error for empty/invalid filters
 */
export declare function applySingleJqFilter(data: unknown, filter: string): unknown;
/**
 * Apply a jq-like filter to JSON data (supports comma-separated multiple paths).
 *
 * @param jsonString - The raw JSON string
 * @param filter - The filter expression, possibly with comma-separated paths
 * @returns JSON string of the result (single value or array for multiple paths)
 * @throws Error for invalid JSON or malformed filters
 */
export declare function applyJqFilter(jsonString: string, filter: string): string;
