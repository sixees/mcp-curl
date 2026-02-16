// src/lib/config/security/blocked-dirs.ts
// Blocklist of sensitive system directories that should never be used as output directories

/**
 * Linux system directories that should never be writable by this tool.
 * Includes system binaries, configuration, kernel interfaces, and boot files.
 */
const LINUX_BLOCKED_DIRS: readonly string[] = Object.freeze([
    "/etc",
    "/sys",
    "/proc",
    "/dev",
    "/boot",
    "/root",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/lib",
    "/lib64",
    "/var/run",
    "/run",
]);

/**
 * macOS system directories that should never be writable by this tool.
 * Includes system files, libraries, and protected volumes.
 */
const MACOS_BLOCKED_DIRS: readonly string[] = Object.freeze([
    "/System",
    "/Library",
    "/private/etc",
    "/private/var",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/cores",
]);

/**
 * macOS directories where only the root is blocked, but subdirectories are allowed.
 * For example, /Volumes is blocked but /Volumes/MyDrive is allowed.
 */
const MACOS_ROOT_ONLY_BLOCKED: readonly string[] = Object.freeze([
    "/Volumes",
]);

/**
 * Windows system directory patterns (case-insensitive, any drive letter).
 * Using lowercase for comparison since we normalize paths to lowercase.
 */
const WINDOWS_BLOCKED_PATTERNS: readonly RegExp[] = Object.freeze([
    /^[a-z]:\\windows(\\|$)/i,
    /^[a-z]:\\program files(\\|$)/i,
    /^[a-z]:\\program files \(x86\)(\\|$)/i,
    /^[a-z]:\\programdata(\\|$)/i,
]);

/**
 * Check if a path starts with a blocked directory prefix.
 * This handles both exact matches and subdirectories.
 */
function startsWithBlockedPrefix(path: string, blockedDirs: readonly string[]): boolean {
    for (const blocked of blockedDirs) {
        // Exact match
        if (path === blocked) {
            return true;
        }
        // Subdirectory match (path starts with blocked + /)
        if (path.startsWith(blocked + "/")) {
            return true;
        }
    }
    return false;
}

/**
 * Check if a path exactly matches a root-only blocked directory.
 * Subdirectories are allowed for these paths.
 */
function isExactRootOnlyMatch(path: string, rootOnlyDirs: readonly string[]): boolean {
    // Strip trailing slashes so "/Volumes/" matches "/Volumes"
    const normalized = path.replace(/\/+$/, "");
    return rootOnlyDirs.includes(normalized);
}

/**
 * Check if a resolved path points to a blocked system directory.
 *
 * This function should be called with the real path (after symlink resolution)
 * to prevent symlink-based bypass attacks.
 *
 * @param resolvedPath - The absolute, symlink-resolved path to check
 * @returns true if the path is blocked, false if it's safe to use
 */
export function isBlockedSystemDirectory(resolvedPath: string): boolean {
    const platform = process.platform;

    if (platform === "win32") {
        // Windows: use regex patterns for case-insensitive matching
        const normalizedPath = resolvedPath.replace(/\//g, "\\");
        for (const pattern of WINDOWS_BLOCKED_PATTERNS) {
            if (pattern.test(normalizedPath)) {
                return true;
            }
        }
        return false;
    }

    // Unix-like systems (Linux, macOS, etc.)
    if (platform === "darwin") {
        // macOS-specific checks
        if (startsWithBlockedPrefix(resolvedPath, MACOS_BLOCKED_DIRS)) {
            return true;
        }
        if (isExactRootOnlyMatch(resolvedPath, MACOS_ROOT_ONLY_BLOCKED)) {
            return true;
        }
    }

    // Linux and other Unix (also applies some checks on macOS)
    if (startsWithBlockedPrefix(resolvedPath, LINUX_BLOCKED_DIRS)) {
        return true;
    }

    return false;
}

/**
 * Create a descriptive error for blocked directory attempts.
 *
 * @param originalPath - The path as provided by the user
 * @param resolvedPath - The real path after symlink resolution
 * @returns An Error with a helpful message
 */
export function createBlockedDirectoryError(originalPath: string, resolvedPath: string): Error {
    const pathInfo = originalPath === resolvedPath
        ? `"${originalPath}"`
        : `"${originalPath}" (resolves to "${resolvedPath}")`;

    return new Error(
        `Invalid output_dir ${pathInfo}: writing to system directories is not allowed. ` +
        `Please choose a user-writable directory like ~/downloads or a project directory.`
    );
}
