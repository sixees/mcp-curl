// src/lib/response/file-saver.ts
// Safe file saving with filename sanitization

// The `node:` prefix is load-bearing, not style: `file-saver.test.ts` pins
// `randomUUID` with `vi.doMock("node:crypto")`, which keys on this exact
// specifier. Normalising it to bare `crypto` to match the two imports below
// silently stops that mock applying.
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
    // One transform, and **both string parameters go through it.** `fallback`
    // reached the filename verbatim otherwise — it is assigned when `input`
    // sanitises to nothing, and `join` then resolves any `../` inside it, so
    // `createSafeFilenameBase("///", "../../../../tmp/authorized_keys")` put
    // caller-chosen bytes outside the directory the caller had validated, at
    // `0o600`. That is the same escape `writeUniqueFile`'s traversal case
    // covers on `nameBase`, reached through the other argument.
    const squeeze = (s: string): string =>
        s.replace(/[^a-zA-Z0-9]/g, "_")
            // Cap before trimming underscores, so an unbounded
            // hostname+pathname cannot force the trim regex to run over more
            // bytes than a filename could ever use.
            .slice(0, LIMITS.FILENAME_MAX_LENGTH)
            // Trim leading and trailing underscores to avoid names like "___"
            .replace(/^_+|_+$/g, "");

    // A caller may pass a fallback that itself sanitises to nothing, so the
    // chain needs a terminal literal rather than resolving to "".
    const safeFallback = squeeze(fallback) || "response";
    let base = squeeze(input) || safeFallback;

    // Avoid reserved base names across platforms (isWindowsReservedBasename
    // handles case-insensitivity internally). `squeeze` has already ruled out
    // "." and ".." — every non-alphanumeric becomes "_" and is then trimmed —
    // so those two need no separate check here.
    if (isWindowsReservedBasename(base)) {
        // No re-check after slicing. `safeFallback` is non-empty, so `prefixed`
        // always contains the `_` at index 1..50: below 50 the separator
        // survives the slice and no reserved basename contains `_`, and at
        // exactly 50 the slice is `safeFallback` itself, which is longer than
        // every reserved name (all are 3-4 chars). There is no third case, so
        // the truncation cannot produce a reserved name and the arm that
        // handled it was unreachable — including before this transform existed.
        base = `${safeFallback}_${base}`.slice(0, LIMITS.FILENAME_MAX_LENGTH);
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
 * **`nameBase` and `fallback` are both sanitised here rather than by the
 * caller.** The suffix would not neutralise a leading `../`, and this is the
 * only write sink in the codebase — so a caller cannot route around the
 * sanitiser without adding a second sink, which `file-saver.test.ts` fails on
 * by checking the `fs` import surface rather than a list of call spellings.
 * **Both string parameters, not just the first:** `fallback` is what
 * `createSafeFilenameBase` returns when `nameBase` sanitises to nothing, so a
 * caller needed only a fourth argument, never a second sink, to reach the same
 * escape. `createSafeFilenameBase` is idempotent, so a caller that has already
 * run it loses nothing.
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

    // NOT a scope check and not defence in depth — `targetDir` IS `outputDir`
    // on this branch, so this resolves one path against itself. What it can
    // still detect is a swap between the two resolutions, and its incidental
    // effect is an ENOENT if the directory has gone. The `@param` above owns
    // where the real validation happens.
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
