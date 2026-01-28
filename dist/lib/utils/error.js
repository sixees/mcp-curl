// src/lib/utils/error.ts
// Error handling utilities
/**
 * Safely extract an error message from an unknown error value.
 * Handles both Error objects and arbitrary thrown values.
 */
export function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
