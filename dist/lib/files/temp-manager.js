// src/lib/files/temp-manager.ts
// Temp directory lifecycle management
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, chmod, rm, readdir, stat } from "fs/promises";
import { TEMP_DIR } from "../config/session.js";
/**
 * Module-level singleton for shared temp directory.
 * Lazily initialized on first use via getOrCreateTempDir().
 */
let sharedTempDir = null;
let tempDirPromise = null;
/**
 * Get or create the shared temp directory for this session.
 * Uses lazy initialization with promise caching to prevent race conditions.
 */
export async function getOrCreateTempDir() {
    // Return cached promise to prevent race condition with concurrent requests
    if (tempDirPromise) {
        return tempDirPromise;
    }
    tempDirPromise = (async () => {
        const dir = await mkdtemp(join(tmpdir(), TEMP_DIR.PREFIX));
        await chmod(dir, 0o700); // Owner-only access
        sharedTempDir = dir;
        return dir;
    })();
    return tempDirPromise;
}
/**
 * Get the current shared temp directory path (if initialized).
 * Returns null if temp directory hasn't been created yet.
 */
export function getSharedTempDir() {
    return sharedTempDir;
}
/**
 * Clean up orphaned temp directories from previous runs (handles crashes).
 * Uses age-based cleanup to avoid racing with other live instances.
 */
export async function cleanupOrphanedTempDirs() {
    try {
        const tempBase = tmpdir();
        const entries = await readdir(tempBase);
        const now = Date.now();
        for (const entry of entries) {
            if (entry.startsWith(TEMP_DIR.PREFIX)) {
                const dirPath = join(tempBase, entry);
                // Skip our current session's directory
                if (dirPath === sharedTempDir)
                    continue;
                try {
                    // Only delete directories older than threshold to avoid racing with other instances
                    const stats = await stat(dirPath);
                    const ageMs = now - stats.mtimeMs;
                    if (ageMs < TEMP_DIR.ORPHAN_MIN_AGE_MS) {
                        continue; // Too recent, might belong to another live instance
                    }
                    await rm(dirPath, { recursive: true, force: true });
                }
                catch (error) {
                    // Log but don't fail - dir may have been deleted by another instance
                    console.error("Error cleaning up orphaned temp dir:", dirPath, error);
                }
            }
        }
    }
    catch (error) {
        // Log but don't crash - cleanup is best-effort
        console.error("Error during orphaned temp dir cleanup:", error);
    }
}
/**
 * Clean up the current session's temp directory.
 * Called during graceful shutdown.
 */
export async function cleanupTempDir() {
    if (sharedTempDir) {
        await rm(sharedTempDir, { recursive: true, force: true });
        sharedTempDir = null;
        tempDirPromise = null;
    }
}
