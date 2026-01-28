/**
 * Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys.
 */
export declare function isValidSessionId(sessionId: string | undefined): sessionId is string;
/**
 * Validate that a string doesn't contain CRLF characters.
 * Prevents header injection/smuggling attacks via user-controlled header values.
 *
 * @throws Error if value contains CR or LF characters
 */
export declare function validateNoCRLF(value: string, fieldName: string): void;
