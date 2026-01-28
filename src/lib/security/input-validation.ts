// src/lib/security/input-validation.ts
// Input validation utilities for session IDs and header injection prevention

import { UUID_REGEX } from "../config/security/validation.js";

/**
 * Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys.
 */
export function isValidSessionId(sessionId: string | undefined): sessionId is string {
    return sessionId !== undefined && UUID_REGEX.test(sessionId);
}

/**
 * Validate that a string doesn't contain CRLF characters.
 * Prevents header injection/smuggling attacks via user-controlled header values.
 *
 * @throws Error if value contains CR or LF characters
 */
export function validateNoCRLF(value: string, fieldName: string): void {
    if (value.includes("\r") || value.includes("\n")) {
        throw new Error(
            `Invalid ${fieldName}: contains newline characters. ` +
            `This could enable header injection attacks.`
        );
    }
}
