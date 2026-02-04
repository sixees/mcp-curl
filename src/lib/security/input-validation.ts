// src/lib/security/input-validation.ts
// Input validation utilities for session IDs and header injection prevention

import { timingSafeEqual } from "crypto";
import { UUID_REGEX } from "../config/security/validation.js";

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Used for authentication token comparison.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal
 */
export function safeStringCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        // Constant-time comparison even for different lengths
        // Compare bufA against itself to maintain consistent timing
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

/**
 * Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys.
 */
export function isValidSessionId(sessionId: string | undefined): sessionId is string {
    return sessionId !== undefined && UUID_REGEX.test(sessionId);
}

/**
 * Validate that a string doesn't contain CRLF or null byte characters.
 * Prevents header injection/smuggling attacks via user-controlled header values.
 *
 * @throws Error if value contains CR, LF, or null byte characters
 */
export function validateNoCRLF(value: string, fieldName: string): void {
    if (value.includes("\r") || value.includes("\n") || value.includes("\0")) {
        throw new Error(
            `Invalid ${fieldName}: contains forbidden characters (CR, LF, or null byte). ` +
            `This could enable header injection attacks.`
        );
    }
}
