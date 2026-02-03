// src/lib/execution/memory-tracker.ts
// Global memory tracking for concurrent response handling

import { LIMITS } from "../config/limits.js";

/**
 * Private state: total memory currently allocated across all concurrent requests.
 *
 * While each request is limited to LIMITS.MAX_RESPONSE_SIZE (10MB), multiple
 * concurrent requests could exhaust memory. This tracks total memory across
 * all active requests and rejects new allocations when the limit is reached.
 */
let totalResponseMemory = 0;

/**
 * Get the current total memory usage across all active requests.
 */
export function getCurrentMemoryUsage(): number {
    return totalResponseMemory;
}

/**
 * Get the maximum allowed total response memory.
 */
export function getMemoryLimit(): number {
    return LIMITS.MAX_TOTAL_RESPONSE_MEMORY;
}

/**
 * Attempt to allocate memory for response data.
 *
 * @param bytes - Number of bytes to allocate
 * @returns true if allocation succeeded, false if it would exceed the global limit
 */
export function allocateMemory(bytes: number): boolean {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return false; // Invalid input, refuse allocation
    }
    // Compute newTotal before assignment for clarity.
    // Note: This doesn't fix race conditions in async contexts since check-and-assign
    // remain separate operations. True atomicity would require locks, but Node.js's
    // single-threaded event loop makes the race window extremely small in practice.
    const newTotal = totalResponseMemory + bytes;
    if (newTotal > LIMITS.MAX_TOTAL_RESPONSE_MEMORY) {
        return false;
    }
    totalResponseMemory = newTotal;
    return true;
}

/**
 * Release previously allocated memory.
 *
 * @param bytes - Number of bytes to release
 */
export function releaseMemory(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return; // Invalid input, ignore
    }
    totalResponseMemory -= bytes;
    // Ensure we don't go negative due to accounting errors
    if (totalResponseMemory < 0) {
        totalResponseMemory = 0;
    }
}

/**
 * Reset memory tracking to zero.
 * INTERNAL USE ONLY - for testing purposes.
 * NOT exported from barrel file to prevent accidental use in production.
 */
export function resetMemoryTracking(): void {
    totalResponseMemory = 0;
}
