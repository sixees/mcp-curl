import type { JqToken } from "../types/index.js";
/** Result type for bracket token parsing */
type BracketParseResult = {
    token: JqToken;
    newIndex: number;
};
/**
 * Parse bracket notation: [], ["key"], [n], [n:m]
 *
 * @param filter - The full filter string
 * @param startIndex - Index of the opening bracket
 * @returns The parsed token and the new index position
 * @throws Error for malformed bracket expressions
 */
export declare function parseBracketToken(filter: string, startIndex: number): BracketParseResult;
export {};
