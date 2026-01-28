/**
 * Get or create the shared temp directory for this session.
 * Uses lazy initialization with promise caching to prevent race conditions.
 * Implements backoff on failure to prevent rapid retry storms.
 */
export declare function getOrCreateTempDir(): Promise<string>;
/**
 * Get the current shared temp directory path (if initialized).
 * Returns null if temp directory hasn't been created yet.
 */
export declare function getSharedTempDir(): string | null;
/**
 * Clean up orphaned temp directories from previous runs (handles crashes).
 * Uses age-based cleanup to avoid racing with other live instances.
 */
export declare function cleanupOrphanedTempDirs(): Promise<void>;
/**
 * Clean up the current session's temp directory.
 * Called during graceful shutdown.
 */
export declare function cleanupTempDir(): Promise<void>;
