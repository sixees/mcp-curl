// src/lib/jq/tokenizer.ts
// JQ filter bracket token parsing

import type { JqToken } from "../types/index.js";

/** Result type for bracket token parsing */
type BracketParseResult = { token: JqToken; newIndex: number };

/**
 * Parse a quoted key expression: ["key"] or ['key']
 * Handles escape sequences like \" or \'
 *
 * @param filter - The full filter string
 * @param quoteIndex - Index of the opening quote character
 * @returns The parsed key token and new index position
 */
function parseQuotedKey(filter: string, quoteIndex: number): BracketParseResult {
    const quote = filter[quoteIndex];
    let i = quoteIndex + 1; // skip opening quote
    let key = "";
    let foundClosingQuote = false;

    while (i < filter.length) {
        const ch = filter[i];

        // Handle escape sequences like \" or \'
        if (ch === "\\") {
            if (i + 1 < filter.length) {
                key += filter[i + 1];
                i += 2;
                continue;
            }
            // Trailing backslash with no next char; append as-is
            key += ch;
            i++;
            continue;
        }

        // End of quoted string on unescaped matching quote
        if (ch === quote) {
            i++; // skip closing quote
            foundClosingQuote = true;
            break;
        }

        key += ch;
        i++;
    }

    // Check for missing closing quote first (more specific error)
    if (!foundClosingQuote) {
        throw new Error(`Missing closing quote ${quote} in filter "${filter}"`);
    }
    if (i >= filter.length || filter[i] !== "]") {
        throw new Error(`Missing closing bracket "]" after quoted key in filter "${filter}"`);
    }

    return { token: { type: "key", value: key }, newIndex: i + 1 };
}

/**
 * Parse a numeric index [n] or slice [n:m] expression.
 *
 * @param filter - The full filter string
 * @param contentStart - Index of the first character after '['
 * @param bracketStart - Index of the opening '[' (for error messages)
 * @returns The parsed index/slice token and new index position
 */
function parseNumericOrSlice(
    filter: string,
    contentStart: number,
    bracketStart: number
): BracketParseResult {
    let i = contentStart;
    let numStr = "";
    let hasColon = false;

    // Collect everything until closing bracket
    while (i < filter.length && filter[i] !== "]") {
        if (filter[i] === ":") hasColon = true;
        numStr += filter[i];
        i++;
    }

    // Validate closing bracket exists
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket expression in filter "${filter}" at position ${bracketStart}`);
    }
    i++; // skip ]

    if (hasColon) {
        return parseSlice(numStr, filter, i);
    }

    return parseIndex(numStr, filter, i);
}

/**
 * Parse a slice expression like [1:5] or [:5] or [1:]
 */
function parseSlice(numStr: string, filter: string, newIndex: number): BracketParseResult {
    const parts = numStr.split(":");

    if (parts.length > 2) {
        throw new Error(`Invalid slice "[${numStr}]" in filter "${filter}": only [start:end] format is supported`);
    }

    let start: number | undefined;
    if (parts[0]) {
        const parsedStart = parseInt(parts[0], 10);
        if (Number.isNaN(parsedStart)) {
            throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}"`);
        }
        if (!Number.isSafeInteger(parsedStart)) {
            throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": exceeds safe integer range`);
        }
        if (parsedStart < 0) {
            throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": negative indices are not supported`);
        }
        // Check for leading zeros (e.g., "007" should be rejected, but "0" is ok)
        if (parts[0] !== String(parsedStart)) {
            throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": leading zeros are not allowed`);
        }
        start = parsedStart;
    }

    let end: number | undefined;
    if (parts[1]) {
        const parsedEnd = parseInt(parts[1], 10);
        if (Number.isNaN(parsedEnd)) {
            throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}"`);
        }
        if (!Number.isSafeInteger(parsedEnd)) {
            throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": exceeds safe integer range`);
        }
        if (parsedEnd < 0) {
            throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": negative indices are not supported`);
        }
        // Check for leading zeros
        if (parts[1] !== String(parsedEnd)) {
            throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": leading zeros are not allowed`);
        }
        end = parsedEnd;
    }

    return { token: { type: "slice", start, end }, newIndex };
}

/**
 * Parse a simple numeric index [n] - must be non-negative
 */
function parseIndex(numStr: string, filter: string, newIndex: number): BracketParseResult {
    const index = parseInt(numStr, 10);

    if (Number.isNaN(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}"`);
    }
    if (index < 0) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}": negative indices are not supported`);
    }
    if (!Number.isSafeInteger(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}": exceeds safe integer range`);
    }
    // Check for leading zeros or explicit + signs (e.g., "007" or "+1" should be rejected, but "0" is ok)
    if (numStr !== String(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}": leading zeros and explicit '+' signs are not allowed`);
    }

    return { token: { type: "index", value: index }, newIndex };
}

/**
 * Parse bracket notation: [], ["key"], [n], [n:m]
 *
 * @param filter - The full filter string
 * @param startIndex - Index of the opening bracket
 * @returns The parsed token and the new index position
 * @throws Error for malformed bracket expressions
 */
export function parseBracketToken(filter: string, startIndex: number): BracketParseResult {
    const contentStart = startIndex + 1; // skip opening [

    if (contentStart >= filter.length) {
        throw new Error(`Unterminated bracket "[" in filter "${filter}"`);
    }

    // Check for iterate []
    if (filter[contentStart] === "]") {
        return { token: { type: "iterate" }, newIndex: contentStart + 1 };
    }

    // Check for quoted key ["key"] or ['key']
    if (filter[contentStart] === '"' || filter[contentStart] === "'") {
        return parseQuotedKey(filter, contentStart);
    }

    // Parse numeric index or slice
    return parseNumericOrSlice(filter, contentStart, startIndex);
}
