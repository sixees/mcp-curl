// src/lib/security/input-validation.ts
// Input validation utilities for session IDs and header injection prevention

import { timingSafeEqual } from "crypto";
import { UUID_REGEX } from "../config/security/validation.js";

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Used for authentication token comparison.
 *
 * Uses buffer padding to ensure comparison time doesn't leak length information.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal
 */
export function safeStringCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");

    // Pad both buffers to the same length to prevent timing leaks
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    bufA.copy(paddedA);
    bufB.copy(paddedB);

    // timingSafeEqual compares padded buffers in constant time
    // XOR length match into result to ensure different lengths always fail
    const lengthMatch = bufA.length === bufB.length ? 1 : 0;
    return timingSafeEqual(paddedA, paddedB) && lengthMatch === 1;
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
