// src/lib/response/file-saver.ts
// Safe file saving with filename sanitization

import { join, resolve } from "path";
import { writeFile, realpath } from "fs/promises";
import { LIMITS } from "../config/limits.js";
import { isWindowsReservedBasename } from "../config/security/validation.js";
import { getOrCreateTempDir } from "../files/index.js";

/**
 * Create a safe filename base from arbitrary input.
 *
 * Security features:
 * - Replaces non-alphanumeric characters with underscores
 * - Trims leading/trailing underscores
 * - Enforces maximum length
 * - Avoids Windows reserved names and special paths
 *
 * @param input - The input string to convert to a safe filename
 * @param fallback - Fallback name if input produces empty result (default: "response")
 * @returns A safe filename base (without extension)
 */
export function createSafeFilenameBase(input: string, fallback = "response"): string {
    // Replace non-alphanumeric characters with underscores
    let base = input.replace(/[^a-zA-Z0-9]/g, "_");
    // Enforce maximum length before trimming underscores to prevent ReDoS
    // on strings with many consecutive underscores (e.g., "____...____")
    base = base.slice(0, LIMITS.FILENAME_MAX_LENGTH);
    // Trim leading and trailing underscores to avoid names like "___"
    base = base.replace(/^_+|_+$/g, "");
    // Ensure we have a non-empty base
    if (!base) {
        base = fallback;
    }
    // Avoid reserved or problematic base names across platforms
    // (isWindowsReservedBasename handles case-insensitivity internally)
    if (isWindowsReservedBasename(base) || base === "." || base === "..") {
        const prefixed = `${fallback}_${base}`.slice(0, LIMITS.FILENAME_MAX_LENGTH);
        // Re-check after slicing in case truncation produced a reserved name
        base = isWindowsReservedBasename(prefixed)
            ? `safe_${Date.now()}`.slice(0, LIMITS.FILENAME_MAX_LENGTH)
            : prefixed;
    }
    return base;
}

/**
 * Save response content to a file.
 *
 * Uses custom output directory if provided, otherwise uses temp directory.
 * Creates a safe filename from the URL and adds a timestamp for uniqueness.
 * File is written with mode 0o600 (owner-only access).
 *
 * @param content - The content to save
 * @param url - The request URL (used for generating filename)
 * @param outputDir - Optional output directory (must already be validated)
 * @returns Absolute path to the saved file
 */
export async function saveResponseToFile(
    content: string,
    url: string,
    outputDir?: string
): Promise<string> {
    // Use custom output dir if provided, otherwise use temp dir
    const targetDir = outputDir ?? await getOrCreateTempDir();

    // Validate outputDir is a safe absolute path (defense-in-depth)
    if (outputDir) {
        const realDir = await realpath(resolve(outputDir));
        const normalizedTarget = await realpath(resolve(targetDir));
        if (realDir !== normalizedTarget) {
            throw new Error(`Output directory path mismatch after normalization`);
        }
    }

    // Create a safe filename from URL (fall back to raw string if URL is invalid)
    let baseName: string;
    try {
        const urlObj = new URL(url);
        baseName = urlObj.hostname + urlObj.pathname;
    } catch (error) {
        // TypeError indicates invalid URL format; fall back to raw string
        if (error instanceof TypeError) {
            baseName = url;
        } else {
            throw error; // Re-throw unexpected errors
        }
    }
    const safeName = createSafeFilenameBase(baseName);
    const filename = `${safeName}_${Date.now()}.txt`;
    const filepath = join(targetDir, filename);

    await writeFile(filepath, content, { encoding: "utf-8", mode: 0o600 }); // Owner-only access
    return filepath;
}
