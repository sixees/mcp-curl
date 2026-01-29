/**
 * Get the current total memory usage across all active requests.
 */
export declare function getCurrentMemoryUsage(): number;
/**
 * Get the maximum allowed total response memory.
 */
export declare function getMemoryLimit(): number;
/**
 * Attempt to allocate memory for response data.
 *
 * @param bytes - Number of bytes to allocate
 * @returns true if allocation succeeded, false if it would exceed the global limit
 */
export declare function allocateMemory(bytes: number): boolean;
/**
 * Release previously allocated memory.
 *
 * @param bytes - Number of bytes to release
 */
export declare function releaseMemory(bytes: number): void;
/**
 * Reset memory tracking to zero.
 * INTERNAL USE ONLY - for testing purposes.
 * NOT exported from barrel file to prevent accidental use in production.
 */
export declare function resetMemoryTracking(): void;
