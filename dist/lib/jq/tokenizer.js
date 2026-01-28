// src/lib/jq/tokenizer.ts
// JQ filter bracket token parsing
/**
 * Parse bracket notation: [], ["key"], [n], [n:m]
 *
 * @param filter - The full filter string
 * @param startIndex - Index of the opening bracket
 * @returns The parsed token and the new index position
 * @throws Error for malformed bracket expressions
 */
export function parseBracketToken(filter, startIndex) {
    let i = startIndex + 1; // skip opening [
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket "[" in filter "${filter}"`);
    }
    // Check for iterate []
    if (filter[i] === "]") {
        return { token: { type: "iterate" }, newIndex: i + 1 };
    }
    // Check for string key ["key"] with escape sequence handling
    if (filter[i] === '"' || filter[i] === "'") {
        const quote = filter[i];
        i++; // skip opening quote
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
        i++; // skip ]
        return { token: { type: "key", value: key }, newIndex: i };
    }
    // Parse number index or slice
    let numStr = "";
    let hasColon = false;
    while (i < filter.length && filter[i] !== "]") {
        if (filter[i] === ":")
            hasColon = true;
        numStr += filter[i];
        i++;
    }
    // Validate closing bracket exists
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket expression in filter "${filter}" at position ${startIndex}`);
    }
    i++; // skip ]
    if (hasColon) {
        const parts = numStr.split(":");
        if (parts.length > 2) {
            throw new Error(`Invalid slice "[${numStr}]" in filter "${filter}": only [start:end] format is supported`);
        }
        let start;
        if (parts[0]) {
            const parsedStart = parseInt(parts[0], 10);
            if (Number.isNaN(parsedStart)) {
                throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}"`);
            }
            start = parsedStart;
        }
        let end;
        if (parts[1]) {
            const parsedEnd = parseInt(parts[1], 10);
            if (Number.isNaN(parsedEnd)) {
                throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}"`);
            }
            end = parsedEnd;
        }
        return {
            token: { type: "slice", start, end },
            newIndex: i,
        };
    }
    // Simple index [n] - must be non-negative
    const index = parseInt(numStr, 10);
    if (Number.isNaN(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}"`);
    }
    if (index < 0) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}": negative indices are not supported`);
    }
    return { token: { type: "index", value: index }, newIndex: i };
}
