// src/lib/jq/parser.ts
// JQ filter expression parsing

import { JQ } from "../config/jq.js";
import type { JqToken } from "../types/index.js";
import { parseBracketToken } from "./tokenizer.js";

/**
 * Parse a jq-like filter expression into tokens.
 *
 * @param filter - The filter string (e.g., ".data.items[0].name")
 * @returns Array of parsed tokens
 * @throws Error for malformed filters or exceeding limits
 */
export function parseJqFilter(filter: string): JqToken[] {
    if (filter.length > JQ.MAX_FILTER_LENGTH) {
        throw new Error(`jq_filter exceeds maximum length of ${JQ.MAX_FILTER_LENGTH} characters`);
    }

    const startTime = Date.now();
    const tokens: JqToken[] = [];
    let i = filter[0] === "." ? 1 : 0; // skip leading dot

    while (i < filter.length) {
        // Timeout check to prevent DoS via complex filters
        if (Date.now() - startTime > JQ.MAX_PARSE_TIME_MS) {
            throw new Error("jq_filter parsing timeout - filter too complex");
        }

        if (filter[i] === ".") {
            i++;
            continue;
        }

        if (filter[i] === "[") {
            const result = parseBracketToken(filter, i);
            tokens.push(result.token);
            if (tokens.length > JQ.MAX_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${JQ.MAX_TOKENS} path segments`);
            }
            i = result.newIndex;
            continue;
        }

        // Bare key (or numeric index via dot notation like .0)
        let key = "";
        while (i < filter.length && filter[i] !== "." && filter[i] !== "[") {
            key += filter[i];
            i++;
        }
        if (key) {
            // Check if key is a non-negative numeric index (e.g., .0, .10)
            if (/^\d+$/.test(key)) {
                const parsed = parseInt(key, 10);
                // Validate: within safe integer range
                if (!Number.isSafeInteger(parsed)) {
                    throw new Error(
                        `Invalid array index "${key}" in filter "${filter}": exceeds safe integer range`
                    );
                }
                // Validate: no leading zeros (e.g., "007" should be rejected, but "0" is ok)
                if (key !== String(parsed)) {
                    throw new Error(
                        `Invalid array index "${key}" in filter "${filter}": leading zeros are not allowed`
                    );
                }
                tokens.push({ type: "index", value: parsed });
            } else {
                tokens.push({ type: "key", value: key });
            }
            if (tokens.length > JQ.MAX_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${JQ.MAX_TOKENS} path segments`);
            }
        }
    }

    return tokens;
}

/**
 * Split jq filter on commas, respecting brackets and quotes.
 * e.g., ".name,.address[0],.[\"key,with,commas\"]" -> [".name", ".address[0]", ".[\"key,with,commas\"]"]
 *
 * @param filter - The full filter string potentially containing multiple comma-separated filters
 * @returns Array of individual filter strings
 * @throws Error for malformed filters (unclosed quotes/brackets, empty segments)
 */
export function splitJqFilters(filter: string): string[] {
    if (filter.length > JQ.MAX_FILTER_LENGTH) {
        throw new Error(`jq_filter exceeds maximum length of ${JQ.MAX_FILTER_LENGTH} characters`);
    }

    const startTime = Date.now();
    const filters: string[] = [];
    let current = "";
    let bracketDepth = 0;
    let inQuote: string | null = null;
    let escaped = false;

    for (let i = 0; i < filter.length; i++) {
        // Timeout check to prevent DoS
        if (Date.now() - startTime > JQ.MAX_PARSE_TIME_MS) {
            throw new Error("jq_filter parsing timeout - filter too complex");
        }

        const ch = filter[i];

        // Handle escape sequences inside quotes
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === "\\" && inQuote) {
            current += ch;
            escaped = true;
            continue;
        }

        // Track quote state
        if ((ch === '"' || ch === "'") && !inQuote) {
            inQuote = ch;
            current += ch;
            continue;
        }
        if (ch === inQuote) {
            inQuote = null;
            current += ch;
            continue;
        }

        // Skip bracket tracking while inside quotes
        if (inQuote) {
            current += ch;
            continue;
        }

        // Track bracket depth
        if (ch === "[") {
            bracketDepth++;
            current += ch;
            continue;
        }
        if (ch === "]") {
            bracketDepth--;
            if (bracketDepth < 0) {
                throw new Error(
                    `Invalid jq_filter "${filter}": unmatched closing bracket "]"`
                );
            }
            current += ch;
            continue;
        }

        // Split on comma only at top level (not inside brackets or quotes)
        if (ch === "," && bracketDepth === 0) {
            const trimmed = current.trim();
            if (!trimmed) {
                // Empty segment: leading comma, consecutive commas, or will be trailing
                const position = filters.length === 0 ? "leading" : "consecutive";
                throw new Error(
                    `Invalid jq_filter "${filter}": ${position} comma at position ${i}`
                );
            }
            filters.push(trimmed);
            current = "";
            continue;
        }

        current += ch;
    }

    // Check for unclosed quotes
    if (inQuote) {
        throw new Error(
            `Invalid jq_filter "${filter}": unclosed ${inQuote === '"' ? 'double' : 'single'} quote`
        );
    }

    // Check for unclosed brackets
    if (bracketDepth > 0) {
        throw new Error(
            `Invalid jq_filter "${filter}": unclosed bracket "["`
        );
    }

    // Don't forget the last segment
    const trimmed = current.trim();
    if (!trimmed && filters.length > 0) {
        // We had previous segments but the last one is empty = trailing comma
        throw new Error(
            `Invalid jq_filter "${filter}": trailing comma`
        );
    }
    if (trimmed) {
        filters.push(trimmed);
    }

    // Enforce maximum number of comma-separated filters
    if (filters.length > JQ.MAX_FILTERS) {
        throw new Error(
            `jq_filter has too many comma-separated paths (${filters.length}). ` +
            `Maximum allowed is ${JQ.MAX_FILTERS}.`
        );
    }

    return filters;
}
