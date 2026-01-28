import type { JqToken } from "../types/index.js";
/**
 * Parse a jq-like filter expression into tokens.
 *
 * @param filter - The filter string (e.g., ".data.items[0].name")
 * @returns Array of parsed tokens
 * @throws Error for malformed filters or exceeding limits
 */
export declare function parseJqFilter(filter: string): JqToken[];
/**
 * Split jq filter on commas, respecting brackets and quotes.
 * e.g., ".name,.address[0],.[\"key,with,commas\"]" -> [".name", ".address[0]", ".[\"key,with,commas\"]"]
 *
 * @param filter - The full filter string potentially containing multiple comma-separated filters
 * @returns Array of individual filter strings
 * @throws Error for malformed filters (unclosed quotes/brackets, empty segments)
 */
export declare function splitJqFilters(filter: string): string[];
