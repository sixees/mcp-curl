/**
 * Compare two strings in constant time to prevent timing attacks.
 * Used for authentication token comparison.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal
 */
export declare function safeStringCompare(a: string, b: string): boolean;
/**
 * Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys.
 */
export declare function isValidSessionId(sessionId: string | undefined): sessionId is string;
/**
 * Validate that a string doesn't contain CRLF or null byte characters.
 * Prevents header injection/smuggling attacks via user-controlled header values.
 *
 * @throws Error if value contains CR, LF, or null byte characters
 */
export declare function validateNoCRLF(value: string, fieldName: string): void;
