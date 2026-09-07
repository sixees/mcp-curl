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
    // Enforce maximum length before trimming underscores so an unbounded
    // hostname+pathname cannot force the trim regex to run over more bytes
    // than a filename could ever use
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
 * **`Buffer` only — no `string | Buffer` union.** The caller decides what bytes
 * land on disk, and it is the only party that can: a union would take a
 * lossily-decoded string at any call site with no compiler objection, so the
 * encode would stop being visible at the point the decision is made. A caller
 * holding text encodes it itself, in one line the diff shows.
 *
 * `LESSONS.md` RC-33 for what a silent decode on this path costs.
 *
 * @param content - The exact bytes to write
 * @param url - The request URL (used for generating filename)
 * @param outputDir - Optional output directory. **The allowed-root policy is
 *   the caller's and is not enforced here** — the check below only re-resolves
 *   the path and rejects it if normalisation moves it, which catches a symlink
 *   swapped in after validation but says nothing about where the directory is.
 *   `ProcessResponseOptions.outputDir` carries the same precondition, and
 *   `tools/curl-execute.ts::executeCurlRequest` is where it is met
 * @returns Absolute path to the saved file
 */
export async function saveResponseToFile(
    content: Buffer,
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

    // No `encoding`: the argument is octets. An encoding is inert for a Buffer,
    // so setting one would only be reassurance — and it would become a live
    // lossy conversion the day this parameter accepts a string.
    await writeFile(filepath, content, { mode: 0o600 }); // Owner-only access
    return filepath;
}
