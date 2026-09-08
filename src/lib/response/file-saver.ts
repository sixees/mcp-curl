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
 * Write bytes to a uniquely-named file inside an already-validated directory.
 *
 * **`flag: "wx"` is the load-bearing half.** No naming scheme *guarantees*
 * uniqueness; `wx` is what turns the residual collision into an `EEXIST`
 * instead of a silent overwrite. It also refuses to follow a symlink at the
 * final component, and it makes `mode` apply to every file this function
 * creates rather than only to the ones that did not already exist.
 *
 * **The two name components do different jobs.** `randomUUID().slice(0, 8)` is
 * what separates two saves — `Date.now()` discriminates nothing between two
 * writes in the same millisecond, and the base it is appended to collides far
 * more often than its length suggests, since an unbounded `hostname + pathname`
 * is cut to `FILENAME_MAX_LENGTH`. The clock reading is kept for a different
 * reason: it keeps saved artefacts sorting chronologically for anyone listing
 * the directory. It is not part of the uniqueness guarantee.
 *
 * **`nameBase` is sanitised here rather than by the caller.** The suffix would
 * not neutralise a leading `../`, and this is the only write sink in the
 * codebase — so a caller cannot route around the sanitiser without adding a
 * second sink, which `file-saver.test.ts` fails on. `createSafeFilenameBase` is
 * idempotent, so a caller that has already run it loses nothing.
 *
 * **`Buffer` only — no `string | Buffer` union**, the same rule
 * `saveResponseToFile` and `parser.ts::parseResponseWithMetadata` both state. A
 * union would take a lossily-decoded string at any call site with no compiler
 * objection, and this is the seam every save site funnels through, so it is
 * where the rule has to be strongest rather than weakest. A caller holding text
 * encodes it itself, in one line the diff shows. `LESSONS.md` RC-33.
 *
 * @param content - The exact bytes to write
 * @param targetDir - Destination directory. **Must arrive already resolved and
 *   validated against the allowed roots**; nothing here re-establishes that
 * @param nameBase - Raw filename base; sanitised here, not by the caller
 * @param fallback - Name to use when `nameBase` sanitises to nothing
 * @returns Absolute path to the file written
 * @throws {NodeJS.ErrnoException} if the write fails — `EEXIST` when the
 *   generated path is already taken, or the usual `ENOENT`/`EACCES`/`EROFS`
 */
export async function writeUniqueFile(
    content: Buffer,
    targetDir: string,
    nameBase: string,
    fallback?: string
): Promise<string> {
    const safeName = createSafeFilenameBase(nameBase, fallback);
    const filename = `${safeName}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`;
    const filepath = join(targetDir, filename);
    await writeFile(filepath, content, { mode: 0o600, flag: "wx" }); // Owner-only, never overwrite
    return filepath;
}

/**
 * Save response content to a file.
 *
 * Uses custom output directory if provided, otherwise uses temp directory.
 * Derives the filename base from the URL and hands the write to
 * `writeUniqueFile`, which owns sanitising, uniqueness and the owner-only mode.
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
    return writeUniqueFile(content, targetDir, baseName);
}
