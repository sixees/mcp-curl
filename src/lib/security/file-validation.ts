// src/lib/security/file-validation.ts
// File path validation for jq_query tool

import { resolve, relative, isAbsolute } from "path";
import { stat, access, realpath, constants as fsConstants } from "fs/promises";
import { JQ } from "../config/jq.js";
import { ENV } from "../config/environment.js";
import { getSharedTempDir } from "../files/temp-manager.js";

/**
 * Validate a file path for jq_query tool (security: restrict to allowed directories).
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
 * @throws Error if file doesn't exist, is too large, isn't readable, or is outside allowed directories
 */
export async function validateFilePath(filepath: string): Promise<void> {
    // Block path traversal in input string (defense-in-depth, matches validateOutputDir)
    if (filepath.includes("..")) {
        throw new Error(
            `Invalid filepath: path traversal detected. ` +
            `Please provide a direct path without ".." components.`
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
                `Maximum file size for jq_query is ${JQ.MAX_QUERY_FILE_SIZE / 1_000_000}MB.`
            );
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`File "${filepath}" does not exist`);
        }
        throw error;
    }

    // Check file is readable
    try {
        await access(realFilePath, fsConstants.R_OK);
    } catch (error) {
        throw new Error(`File "${filepath}" is not readable`);
    }

    // Build list of allowed directories (using real paths to handle symlinks consistently)
    const allowedDirs: string[] = [];

    // 1. Our temp directory (use getter to access module-level singleton)
    const tempDir = getSharedTempDir();
    if (tempDir) {
        allowedDirs.push(tempDir);
    }

    // 2. Configured output directory from env var
    const envOutputDir = process.env[ENV.OUTPUT_DIR];
    if (envOutputDir) {
        try {
            // Use realpath to get actual directory path
            const realEnvDir = await realpath(resolve(envOutputDir));
            const envDirStats = await stat(realEnvDir);
            if (!envDirStats.isDirectory()) {
                throw new Error(
                    `Invalid ${ENV.OUTPUT_DIR} value "${envOutputDir}": path exists but is not a directory`
                );
            }
            await access(realEnvDir, fsConstants.W_OK);
            allowedDirs.push(realEnvDir);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                throw new Error(
                    `Invalid ${ENV.OUTPUT_DIR} value "${envOutputDir}": directory does not exist`
                );
            }
            if (err.code === "EACCES") {
                throw new Error(
                    `Invalid ${ENV.OUTPUT_DIR} value "${envOutputDir}": directory is not writable`
                );
            }
            throw error;
        }
    }

    // 3. Current working directory (use realpath in case cwd itself is a symlink)
    try {
        allowedDirs.push(await realpath(process.cwd()));
    } catch {
        // If cwd can't be resolved (unlikely), use it as-is
        allowedDirs.push(process.cwd());
    }

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
}
