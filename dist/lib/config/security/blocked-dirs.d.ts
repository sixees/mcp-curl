/**
 * Check if a resolved path points to a blocked system directory.
 *
 * This function should be called with the real path (after symlink resolution)
 * to prevent symlink-based bypass attacks.
 *
 * @param resolvedPath - The absolute, symlink-resolved path to check
 * @returns true if the path is blocked, false if it's safe to use
 */
export declare function isBlockedSystemDirectory(resolvedPath: string): boolean;
/**
 * Create a descriptive error for blocked directory attempts.
 *
 * @param originalPath - The path as provided by the user
 * @param resolvedPath - The real path after symlink resolution
 * @returns An Error with a helpful message
 */
export declare function createBlockedDirectoryError(originalPath: string, resolvedPath: string): Error;
