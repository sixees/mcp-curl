// src/lib/jq/filter.ts
// JQ filter application to JSON data

import { JQ } from "../config/jq.js";
import { LIMITS } from "../config/limits.js";
import { parseJqFilter, splitJqFilters } from "./parser.js";
import { isRawNumber, keepNumberLexeme } from "../utils/index.js";

/**
 * Type guard for plain objects (not arrays or null).
 * Internal helper - not exported from module.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    // **A preserved number lexeme is an object at runtime and a NUMBER to every
    // caller here.** Without this arm `.price` on `{"price":3.140}` navigates
    // into the marker, so `.price.rawJSON` returns the string `"3.140"` and
    // leaks an internal representation as if the origin had sent it. It also
    // turns a scalar into a container for any walk that keys off "is this an
    // object?" — the same guard `response/processor.ts` needs at its own three
    // structural tests, and the reason `isRawNumber` is exported beside the
    // reviver rather than kept private to it.
    if (isRawNumber(value)) return false;
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Apply a single jq-like filter path to parsed JSON data.
 *
 * @param data - The parsed JSON data
 * @param filter - A single filter expression (e.g., ".data.items[0]")
 * @returns The extracted value; `undefined` only when the FINAL path segment is
 *   a missing key or an out-of-range index; `null` for a type mismatch, or for
 *   any miss earlier in the path (an earlier miss collapses to `null` via the
 *   loop's own null/undefined guard before the final segment is reached)
 * @throws Error for empty/invalid filters
 */
export function applySingleJqFilter(data: unknown, filter: string): unknown {
    const tokens = parseJqFilter(filter);

    // Reject empty or dots-only filters that produce no tokens
    if (tokens.length === 0) {
        throw new Error(
            `Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`
        );
    }

    let result: unknown = data;

    for (const token of tokens) {
        if (result === null || result === undefined) {
            return null;
        }

        switch (token.type) {
            case "key":
                // Key access only works on plain objects, not arrays or primitives
                if (!isRecord(result)) {
                    return null;
                }
                result = result[token.value];
                break;

            case "index":
                if (Array.isArray(result)) {
                    result = result[token.value];
                } else {
                    return null;
                }
                break;

            case "slice":
                if (Array.isArray(result)) {
                    result = result.slice(token.start, token.end);
                } else {
                    return null;
                }
                break;

            case "iterate":
                if (!Array.isArray(result)) {
                    return null;
                }
                // For iterate, we just keep the array as-is for now
                // (full jq would expand it, but for our purposes keeping array is fine)
                break;
        }
    }

    return result;
}

/**
 * Apply a jq-like filter to pre-parsed JSON data (supports comma-separated multiple paths).
 * Use this when you've already parsed the JSON to avoid double parsing.
 *
 * @param data - The pre-parsed JSON data
 * @param filter - The filter expression, possibly with comma-separated paths
 * @returns JSON string of the result (single value or array for multiple paths)
 * @throws Error for malformed filters
 */
export function applyJqFilterToParsed(data: unknown, filter: string): string {
    // Split into multiple filters (handles commas outside brackets/quotes)
    const filters = splitJqFilters(filter);

    if (filters.length === 0) {
        throw new Error(
            `Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`
        );
    }

    if (filters.length > JQ.MAX_FILTERS) {
        throw new Error(
            `jq_filter exceeds maximum of ${JQ.MAX_FILTERS} comma-separated paths`
        );
    }

    // Single filter: return value directly (backward compatible).
    // `applySingleJqFilter()` yields `undefined` for a missing key, and
    // `JSON.stringify(undefined)` is `undefined` — not a string — which would
    // break this function's declared `string` return type. Missing keys are
    // reported as JSON `null`, matching jq's own output for an absent path.
    if (filters.length === 1) {
        const result = applySingleJqFilter(data, filters[0]);
        return JSON.stringify(result, null, 2) ?? "null";
    }

    // Multiple filters: return array of values
    const results = filters.map((f) => applySingleJqFilter(data, f));
    return JSON.stringify(results, null, 2);
}

/**
 * Apply a jq-like filter to JSON data (supports comma-separated multiple paths).
 *
 * @param jsonString - The raw JSON string
 * @param filter - The filter expression, possibly with comma-separated paths
 * @returns JSON string of the result (single value or array for multiple paths)
 * @throws Error for invalid JSON or malformed filters
 */
export function applyJqFilter(jsonString: string, filter: string): string {
    let data: unknown;
    try {
        // `keepNumberLexeme`, so a number survives this parse-and-reserialise
        // exactly as the origin spelled it. This is the tool the model is sent
        // to when a response is too large to return inline, so it is the path
        // large-body numbers actually travel — and it used to round them while
        // the inline path kept them exact (RC-27).
        data = JSON.parse(jsonString, keepNumberLexeme);
    } catch (error) {
        // SyntaxError indicates invalid JSON
        if (error instanceof SyntaxError) {
            const preview = jsonString.slice(0, LIMITS.ERROR_PREVIEW_LENGTH);
            throw new Error(
                `Response is not valid JSON. Cannot apply jq_filter.\nPreview: ${preview}${jsonString.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`
            );
        }
        throw error; // Re-throw unexpected errors
    }

    return applyJqFilterToParsed(data, filter);
}
