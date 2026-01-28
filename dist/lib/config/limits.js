// src/lib/config/limits.ts
// Response sizes, timeouts, and file handling limits
// ============================================================================
// Response & Processing Limits
// ============================================================================
export const MAX_RESPONSE_SIZE = 10_000_000; // 10MB max response for processing
export const DEFAULT_MAX_RESULT_SIZE = 500_000; // 500KB default for AI agent responses
export const MAX_TOTAL_RESPONSE_MEMORY = 100_000_000; // 100MB total across all requests
export const ERROR_PREVIEW_LENGTH = 200; // Characters to show in error previews
export const MAX_METADATA_TAIL_LENGTH = 200; // Max distance from end for metadata separator
// ============================================================================
// Timeouts
// ============================================================================
export const DEFAULT_TIMEOUT = 30000; // 30 seconds
// ============================================================================
// File Handling
// ============================================================================
export const FILENAME_MAX_LENGTH = 50;
