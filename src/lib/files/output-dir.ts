// src/lib/files/output-dir.ts
// Output directory resolution and validation

import { resolve } from "path";
import { stat, access, realpath, constants as fsConstants } from "fs/promises";
import { ENV } from "../config/environment.js";
import { isBlockedSystemDirectory, createBlockedDirectoryError } from "../config/security/index.js";
import { getErrorMessage } from "../utils/index.js";

/**
 * Resolve the output directory with priority:
 * 1) parameter (if provided)
 * 2) MCP_CURL_OUTPUT_DIR env var
 * 3) null (caller should fall back to temp directory)
 *
 * @throws Error if parameter or env var is set but empty/whitespace-only
 */
export function resolveOutputDir(paramDir?: string): string | null {
    if (paramDir !== undefined) {
        const trimmedParam = paramDir.trim();
        if (!trimmedParam) {
            throw new Error(
                `Invalid output_dir: value is empty or whitespace-only. ` +
                `Remove it to use the environment variable or temp directory, or provide a valid path.`
            );
        }
        return trimmedParam;
    }
    const rawEnvDir = process.env[ENV.OUTPUT_DIR];
    if (rawEnvDir !== undefined) {
        const envDir = rawEnvDir.trim();
        if (!envDir) {
            throw new Error(
                `Environment variable ${ENV.OUTPUT_DIR} is set but empty or whitespace-only. ` +
                `Unset it or provide a valid directory path.`
            );
        }
        return envDir;
    }
    return null;
}

/**
 * Validate output directory is safe to use. Returns the real path (symlinks resolved).
 *
 * Security: We use realpath() to resolve symlinks before validation. This prevents
 * symlink-based attacks where an attacker creates a symlink pointing outside the
 * intended directory (e.g., /safe/output -> /etc). Without realpath(), we would
 * validate "/safe/output" but actually write to "/etc".
 *
 * @throws Error if directory doesn't exist, isn't a directory, or isn't writable
 */
export async function validateOutputDir(dir: string): Promise<string> {
    // Block path traversal: check for ".." as a path segment (not substring)
    // This allows valid names like "/tmp/foo..bar" while blocking "/tmp/../etc"
    const segments = dir.split(/[/\\]/);
    if (segments.includes("..")) {
        throw new Error(
            `Invalid output_dir: path traversal detected. ` +
            `Please provide a direct path without ".." components.`
        );
    }

    // Resolve to absolute path (does NOT follow symlinks)
    const absolutePath = resolve(dir);

    // Check directory exists first
    try {
        const stats = await stat(absolutePath);
        if (!stats.isDirectory()) {
            throw new Error(
                `Invalid output_dir "${dir}": path exists but is not a directory`
            );
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(
                `Invalid output_dir "${dir}": directory does not exist. ` +
                `Please create it first or use a different path.`
            );
        }
        throw new Error(`Error validating output_dir "${dir}": ${getErrorMessage(error)}`);
    }

    // Resolve symlinks to get the real filesystem path
    // This ensures we validate and use the actual destination, not just the symlink
    const realPath = await realpath(absolutePath);

    // Block sensitive system directories (check after realpath to prevent symlink bypass)
    if (isBlockedSystemDirectory(realPath)) {
        throw createBlockedDirectoryError(dir, realPath);
    }

    // Check directory is writable using the real path
    try {
        await access(realPath, fsConstants.W_OK);
    } catch (error) {
        const errno = (error as NodeJS.ErrnoException).code;
        let reason = "directory is not writable";
        if (errno === 'EROFS') {
            reason = "filesystem is mounted read-only";
        } else if (errno === 'EACCES') {
            reason = "permission denied";
        }
        throw new Error(`Invalid output_dir "${dir}": ${reason}`);
    }

    return realPath;
}
