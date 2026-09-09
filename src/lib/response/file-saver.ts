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
 * Reduce arbitrary input to a filename base that cannot escape its directory.
 *
 * **Both string parameters are sanitised, and that is the security property
 * rather than a convenience.** Either one can end up in the returned name, so
 * hardening `input` alone would leave the other as an open route to the same
 * escape.
 *
 * Idempotent, which is why `writeUniqueFile` can call it unconditionally
 * without asking whether a caller already has.
 *
 * @param input - Untrusted string to reduce
 * @param fallback - Used when `input` reduces to nothing. Sanitised on the same
 *   path as `input`, never trusted as a literal
 * @returns A base of alphanumerics and underscores, at most
 *   `LIMITS.FILENAME_MAX_LENGTH` long, with no leading or trailing underscore
 */
export function createSafeFilenameBase(input: string, fallback = "response"): string {
    // One transform, applied to both string parameters. `fallback` is what the
    // result becomes when `input` reduces to nothing, and `join` resolves any
    // `../` a name carries — so sanitising `input` alone would let
    // `createSafeFilenameBase("///", "../../../../tmp/authorized_keys")` write
    // caller-chosen bytes outside the directory the caller validated, at
    // `0o600`. The same escape a traversal in `nameBase` reaches, through the
    // other argument.
    const squeeze = (s: string): string =>
        s.replace(/[^a-zA-Z0-9]/g, "_")
            // Cap before trimming underscores, so an unbounded
            // hostname+pathname cannot force the trim regex to run over more
            // bytes than a filename could ever use.
            .slice(0, LIMITS.FILENAME_MAX_LENGTH)
            // A name of pure underscores carries no information and collides
            // with every other such name. Trimming reduces it to "", which is
            // what makes the fallback below take over.
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
        // The slice cannot reintroduce a reserved name, so nothing re-checks
        // after it. `safeFallback` is non-empty, so the separator sits at index
        // 1 or later: under `LIMITS.FILENAME_MAX_LENGTH` it survives the slice
        // and no reserved basename contains `_`, and at exactly that length the
        // slice is `safeFallback` itself, which is longer than every reserved
        // basename (all are 3-4 characters). There is no third case.
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
 * caller.** The suffix does not neutralise a leading `../`, and this is the
 * only write sink in the codebase — so a caller cannot route around the
 * sanitiser without adding a second sink, which `file-saver.test.ts` fails on
 * by parsing each production module's `fs` import surface.
 * **Both string parameters, not just the first:** `fallback` is what the name
 * becomes when `nameBase` reduces to nothing, so a fourth argument reaches the
 * same escape as the third — no second sink required.
 *
 * **`Buffer` only — no `string | Buffer` union**, the same rule
 * `saveResponseToFile` and `parser.ts::parseResponseWithMetadata` both state. A
 * union accepts a lossily-decoded string at any call site with no compiler
 * objection, and this is the seam every save site funnels through, so it is
 * where the rule has to be strongest rather than weakest. A caller holding text
 * encodes it itself, at the site that knows what its bytes are. `LESSONS.md`
 * RC-33.
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
    await writeFile(filepath, content, { mode: 0o600, flag: "wx" });
    return filepath;
}

/**
 * Save response content to a file.
 *
 * Derives the filename base from the URL and hands the write to
 * `writeUniqueFile`, which owns sanitising, uniqueness and the owner-only mode
 * — so this function guarantees nothing of its own about the resulting name.
 *
 * **`Buffer` only — no `string | Buffer` union.** `writeUniqueFile`'s docblock
 * owns that reasoning and it holds identically here: this is a public entry
 * point, and the caller is the only party that knows what its bytes are.
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

    // An unparseable URL still has to yield a name, and handing the raw string
    // on is safe because `writeUniqueFile` sanitises whatever reaches it.
    let baseName: string;
    try {
        const urlObj = new URL(url);
        baseName = urlObj.hostname + urlObj.pathname;
    } catch (error) {
        // Only a TypeError means "not a URL". Anything else is a genuine fault
        // and must not be absorbed into a filename.
        if (error instanceof TypeError) {
            baseName = url;
        } else {
            throw error; // Re-throw unexpected errors
        }
    }
    return writeUniqueFile(content, targetDir, baseName);
}
