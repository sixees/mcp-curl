// src/lib/security/file-validation.ts
// File path validation for jq_query tool

import { resolve, relative, isAbsolute } from "path";
import { stat, access, realpath, constants as fsConstants } from "fs/promises";
import { JQ, BYTES_PER_MB, ENV } from "../config/index.js";
import { getSharedTempDir } from "../files/temp-manager.js";
import {
    getErrorMessage,
    createValidationError,
    createConfigError,
    createFileError,
} from "../utils/index.js";

/**
 * Cache for allowed directories list to avoid repeated I/O operations.
 * Stores resolved real paths for MCP_CURL_OUTPUT_DIR and cwd.
 */
interface AllowedDirsCache {
    /** Resolved real path of MCP_CURL_OUTPUT_DIR (null if not set or invalid) */
    envOutputDir: string | null;
    /** Resolved real path of current working directory */
    cwd: string;
    /** Timestamp when cache was populated */
    timestamp: number;
}

let allowedDirsCache: AllowedDirsCache | null = null;

/**
 * Resolve the shared temp directory via realpath(), returning null if unavailable.
 * Handles ENOENT silently (temp dir may not exist yet), logs other errors as warnings.
 */
async function resolveSharedTempDirSafely(): Promise<string | null> {
    const tempDir = getSharedTempDir();
    if (!tempDir) return null;
    try {
        return await realpath(tempDir);
    } catch (error) {
        const errno = (error as NodeJS.ErrnoException).code;
        if (errno !== "ENOENT") {
            console.error(
                `Warning: Failed to resolve temp directory "${tempDir}" (${errno}):`,
                error
            );
        }
        return null;
    }
}

/**
 * Get the list of allowed directories for file validation.
 * Uses caching with TTL to avoid repeated I/O operations.
 *
 * @throws Error if cwd or MCP_CURL_OUTPUT_DIR cannot be resolved
 */
async function getAllowedDirectories(): Promise<string[]> {
    const now = Date.now();

    // Check if cache is valid
    if (allowedDirsCache && (now - allowedDirsCache.timestamp) < JQ.ALLOWED_DIRS_CACHE_TTL_MS) {
        const dirs: string[] = [];

        // Temp directory (check fresh each time as it may be created after cache)
        const resolvedTempDir = await resolveSharedTempDirSafely();
        if (resolvedTempDir) {
            dirs.push(resolvedTempDir);
        }

        // Cached directories
        if (allowedDirsCache.envOutputDir) {
            dirs.push(allowedDirsCache.envOutputDir);
        }
        dirs.push(allowedDirsCache.cwd);

        return dirs;
    }

    // Build fresh cache
    let envOutputDirResolved: string | null = null;

    // Resolve MCP_CURL_OUTPUT_DIR if set
    const envOutputDir = process.env[ENV.OUTPUT_DIR];
    if (envOutputDir) {
        try {
            const realEnvDir = await realpath(resolve(envOutputDir));
            const envDirStats = await stat(realEnvDir);
            if (!envDirStats.isDirectory()) {
                throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, "path exists but is not a directory");
            }
            envOutputDirResolved = realEnvDir;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, "directory does not exist");
            }
            throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, getErrorMessage(error));
        }
    }

    // Resolve cwd (required)
    let cwdResolved: string;
    try {
        cwdResolved = await realpath(process.cwd());
    } catch (error) {
        throw new Error(
            `Failed to resolve current working directory: ${getErrorMessage(error)}. ` +
            `This is required for secure file validation.`
        );
    }

    // Update cache
    allowedDirsCache = {
        envOutputDir: envOutputDirResolved,
        cwd: cwdResolved,
        timestamp: now,
    };

    // Build result array
    const dirs: string[] = [];

    // Resolve temp directory via realpath() for consistent symlink handling
    const resolvedTempDir = await resolveSharedTempDirSafely();
    if (resolvedTempDir) {
        dirs.push(resolvedTempDir);
    }

    if (envOutputDirResolved) {
        dirs.push(envOutputDirResolved);
    }
    dirs.push(cwdResolved);

    return dirs;
}

/**
 * Clear the allowed directories cache.
 * Exposed for testing purposes only.
 *
 * @internal
 */
export function clearAllowedDirsCache(): void {
    allowedDirsCache = null;
}

/**
 * Validate a file path for jq_query tool (security: restrict to allowed directories).
 *
 * Returns the validated realpath to prevent TOCTOU (time-of-check-to-time-of-use) attacks.
 * Callers should use the returned path for all subsequent operations instead of the original
 * filepath to ensure they operate on the exact file that was validated.
 *
 * Security: We use realpath() to resolve symlinks before checking directory containment.
 * This prevents symlink escape attacks where an attacker creates a symlink in an allowed
 * directory that points outside it. For example:
 *   - Allowed directory: /home/user/project (cwd)
 *   - Attacker creates: /home/user/project/data.json -> /etc/passwd
 *   - Without realpath(): "/home/user/project/data.json" passes containment check
 *   - With realpath(): Resolves to "/etc/passwd", which fails containment check
 *
 * We also resolve allowed directories via realpath() for consistency, in case cwd or
 * MCP_CURL_OUTPUT_DIR are themselves symlinks.
 *
 * @returns The validated real path (symlinks resolved) that should be used for file operations
 * @throws Error if file doesn't exist, is too large, isn't readable, or is outside allowed directories
 */
export async function validateFilePath(filepath: string): Promise<string> {
    // Block path traversal in input string (defense-in-depth, matches validateOutputDir)
    // Use regex to detect actual ".." path components, not just ".." anywhere in the string
    // This allows filenames like "my..file.json" while blocking "foo/../bar"
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(filepath)) {
        throw createValidationError(
            "filepath",
            "path traversal detected",
            "Please provide a direct path without '..' components"
        );
    }

    // First, resolve to absolute path (does NOT follow symlinks)
    const absolutePath = resolve(filepath);

    // Check file exists and get its real path (follows symlinks)
    let realFilePath: string;
    try {
        // realpath() resolves symlinks and will fail if file doesn't exist
        realFilePath = await realpath(absolutePath);

        const stats = await stat(realFilePath);
        if (!stats.isFile()) {
            throw new Error(`Invalid filepath "${filepath}": path exists but is not a file`);
        }
        // Check file size
        if (stats.size > JQ.MAX_QUERY_FILE_SIZE) {
            throw new Error(
                `File "${filepath}" is too large (${stats.size} bytes). ` +
                `Maximum file size for jq_query is ${JQ.MAX_QUERY_FILE_SIZE / BYTES_PER_MB}MB.`
            );
        }
    } catch (error) {
        const errno = (error as NodeJS.ErrnoException).code;
        if (errno === "ENOENT") {
            throw createFileError(filepath, "does not exist");
        }
        // Re-throw our own validation errors (no errno) directly to avoid double-wrapping
        if (error instanceof Error && !errno) {
            throw error;
        }
        // Wrap unexpected system errors with context
        throw new Error(`Error validating file "${filepath}": ${getErrorMessage(error)}`);
    }

    // Check file is readable
    try {
        await access(realFilePath, fsConstants.R_OK);
    } catch (error) {
        const errno = (error as NodeJS.ErrnoException).code;
        throw createFileError(filepath, `is not readable (${errno || 'unknown error'})`);
    }

    // Get allowed directories (cached with TTL to avoid repeated I/O)
    const allowedDirs = await getAllowedDirectories();

    // Check if REAL file path is within any allowed directory
    // This prevents symlink escapes: a symlink in cwd pointing to /etc would be blocked
    const isInAllowedDir = allowedDirs.some((dir) => {
        const rel = relative(dir, realFilePath);
        // File is in allowed dir if relative path doesn't start with .. and isn't absolute
        // (absolute check handles Windows cross-drive paths like "D:\other")
        return !rel.startsWith("..") && !isAbsolute(rel);
    });

    if (!isInAllowedDir) {
        throw new Error(
            `Access denied: file "${filepath}" is not in an allowed directory. ` +
            `Allowed directories: temp directory, MCP_CURL_OUTPUT_DIR, and current working directory.`
        );
    }

    return realFilePath;
}
