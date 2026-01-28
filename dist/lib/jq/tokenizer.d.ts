import type { JqToken } from "../types/index.js";
/**
 * Parse bracket notation: [], ["key"], [n], [n:m]
 *
 * @param filter - The full filter string
 * @param startIndex - Index of the opening bracket
 * @returns The parsed token and the new index position
 * @throws Error for malformed bracket expressions
 */
export declare function parseBracketToken(filter: string, startIndex: number): {
    token: JqToken;
    newIndex: number;
};
