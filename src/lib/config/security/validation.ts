// src/lib/config/security/validation.ts
// Input validation patterns and helpers

// ============================================================================
// UUID Validation
// ============================================================================

/** Validates UUID v4 format for session IDs (case-insensitive) */
// v4 UUIDs have version nibble = 4 and variant nibble = 8/9/a/b
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================================
// Windows Reserved Basenames
// ============================================================================

// Private frozen Set for efficient lookup - not exported to prevent runtime mutation
const WINDOWS_RESERVED_BASENAMES_SET: ReadonlySet<string> = Object.freeze(
    new Set<string>([
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]),
);

// Immutable array export for documentation/iteration purposes
export const WINDOWS_RESERVED_BASENAMES: ReadonlyArray<string> = Object.freeze(
    Array.from(WINDOWS_RESERVED_BASENAMES_SET),
);

/** Check if a name is a Windows reserved basename (case-insensitive) */
export function isWindowsReservedBasename(name: string): boolean {
    return WINDOWS_RESERVED_BASENAMES_SET.has(name.toUpperCase());
}
