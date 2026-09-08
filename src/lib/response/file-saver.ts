// src/lib/response/file-saver.ts
// Safe file saving with filename sanitization

import { randomUUID } from "node:crypto";
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
 * Write content to a uniquely-named file inside an already-validated directory.
 *
 * **`flag: "wx"` is the load-bearing half.** The name carries a clock reading
 * and 32 bits of randomness, but no naming scheme *guarantees* uniqueness —
 * `wx` is what turns the residual collision into an `EEXIST` instead of a
 * silent overwrite, and it is the reason a second writer can never truncate a
 * file the first one is still holding a path to. Every save site routes through
 * here so a third one cannot forget it.
 *
 * **The random component is not belt-and-braces.** `Date.now()` discriminates
 * nothing between two writes in the same millisecond, and the base it is
 * appended to collides far more often than its length suggests: an unbounded
 * `hostname + pathname` is cut to `FILENAME_MAX_LENGTH`, so every URL sharing a
 * 50-character prefix arrives here with an identical `safeName`. Five unrelated
 * endpoints under one long `/organizations/{id}/workspaces/` path is one base,
 * not five.
 *
 * **No `encoding`.** It is inert for a `Buffer`, and utf-8 is already the
 * default for a `string`, so naming one would buy nothing now and would become
 * a live lossy conversion the day a caller hands over bytes it decoded itself.
 * `LESSONS.md` RC-33.
 *
 * @param targetDir - Destination directory. **Must arrive already resolved and
 *   validated against the allowed roots**; nothing here re-establishes that
 * @param safeName - A filename base from `createSafeFilenameBase`
 * @param content - The exact bytes to write, or text to write as utf-8
 * @returns Absolute path to the file written
 * @throws If a file already exists at the generated path (`EEXIST`)
 */
export async function writeUniqueFile(
    targetDir: string,
    safeName: string,
    content: string | Buffer
): Promise<string> {
    const filename = `${safeName}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`;
    const filepath = join(targetDir, filename);
    await writeFile(filepath, content, { mode: 0o600, flag: "wx" }); // Owner-only, never overwrite
    return filepath;
}

/**
 * Save response content to a file.
 *
 * Uses custom output directory if provided, otherwise uses temp directory.
 * Builds a safe filename base from the URL, then hands the write to
 * `writeUniqueFile`, which owns uniqueness and the owner-only mode.
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
 * @param outputDir - Optional output directory. **Must arrive already resolved
 *   and validated against the allowed roots.** That policy is enforced at
 *   `tools/curl-execute.ts::executeCurlRequest` (`resolveOutputDir` then
 *   `validateOutputDir`), and nothing here re-establishes it. The `realpath`
 *   comparison below resolves this path against *itself* whenever one is
 *   supplied — `targetDir` is `outputDir` on that branch — so it cannot detect
 *   a post-validation swap and is not a second line of defence.
 *   `ProcessResponseOptions.outputDir` carries the same precondition
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
    return writeUniqueFile(targetDir, safeName, content);
}
