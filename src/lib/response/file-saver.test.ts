// src/lib/response/file-saver.test.ts
// Guards on a saved artefact's identity: two saves never resolve to one path,
// a residual collision is an error rather than a silent overwrite, and nothing
// outside this module opens a file for writing at all.
//
// **`Date.now` is pinned in every case here, and that is the measurement rather
// than a convenience.** The clock was the only discriminator the pre-fix naming
// scheme had, so a case that lets it run is measuring how fast the machine is:
// it passes on two saves a millisecond apart whether the defect is fixed or
// not. `docs/todos/012`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "fs/promises";
import { join, basename, dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { LIMITS } from "../config/limits.js";
import { createSafeFilenameBase, saveResponseToFile, writeUniqueFile } from "./file-saver.js";

// Under cwd, not `tmpdir()`: on macOS the OS temp root resolves under
// `/private/var`, which this project's directory policy blocks.
const FIXTURE_PREFIX = ".test-tmp-file-saver-";
const FROZEN_MS = 1_757_000_000_000;

/** The base a URL actually reaches the namer with — hostname + pathname, no `?search`. */
const baseFor = (url: string) => {
    const u = new URL(url);
    return createSafeFilenameBase(u.hostname + u.pathname);
};

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(process.cwd(), FIXTURE_PREFIX));
    vi.spyOn(Date, "now").mockReturnValue(FROZEN_MS);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock("node:crypto");
    vi.resetModules();
    if (dir) await rm(dir, { recursive: true, force: true });
});

describe("saveResponseToFile — two saves never resolve to one path", () => {
    it("separates two URLs differing only in their query string", async () => {
        const urlA = "https://api.example.test/items?page=1";
        const urlB = "https://api.example.test/items?page=2";

        // The precondition, asserted rather than assumed. WHATWG `URL.pathname`
        // excludes `?search`, so these two arrive at the namer as one string —
        // without this line the case could pass because the bases differed, and
        // would then be measuring nothing.
        expect(baseFor(urlA)).toBe(baseFor(urlB));

        const a = await saveResponseToFile(Buffer.from("page one"), urlA, dir);
        const b = await saveResponseToFile(Buffer.from("page two"), urlB, dir);

        expect(a).not.toBe(b);
        expect((await readFile(a)).toString()).toBe("page one");
        expect((await readFile(b)).toString()).toBe("page two");

        // Owner-only at rest, and asserted at a public save site rather than
        // nowhere: `mode` applies on creation, and `wx` is what makes every
        // write a creation.
        expect((await stat(a)).mode & 0o777).toBe(0o600);
    });

    it("separates two endpoints whose bases are cut to one string by the length cap", async () => {
        // The second, independent collision source, and the one that fires on
        // every save for a consumer with a long path prefix: the cap lands
        // inside `/organizations/{id}/workspaces/`, so the resource name never
        // reaches the filename at all.
        const prefix = "https://focus.example.test/api/organizations/00000000/workspaces/999";
        const urlA = `${prefix}/time-entries/batch`;
        const urlB = `${prefix}/projects`;

        // Tied to the constant, not to the literal 50 — raising the cap must
        // move this case rather than quietly leaving it testing a shorter one.
        const raw = (u: string) => new URL(u).hostname + new URL(u).pathname;
        expect(raw(urlA).length).toBeGreaterThan(LIMITS.FILENAME_MAX_LENGTH);
        expect(raw(urlB).length).toBeGreaterThan(LIMITS.FILENAME_MAX_LENGTH);
        expect(baseFor(urlA)).toBe(baseFor(urlB));

        const a = await saveResponseToFile(Buffer.from("batch body"), urlA, dir);
        const b = await saveResponseToFile(Buffer.from("projects body"), urlB, dir);

        expect(a).not.toBe(b);
        expect((await readFile(a)).toString()).toBe("batch body");
        expect((await readFile(b)).toString()).toBe("projects body");
    });
});

describe("writeUniqueFile — the sink owns the guarantees", () => {
    it("refuses a residual collision and leaves the existing file whole", async () => {
        // Both discriminators pinned — the clock above and the randomness here —
        // so the generated name is deterministic and the second call must
        // collide. This is the only way to reach the branch `flag: "wx"` exists
        // for: with the random component live, a genuine collision needs 32 bits
        // to repeat inside one millisecond.
        vi.resetModules();
        vi.doMock("node:crypto", async () => {
            const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
            return { ...actual, randomUUID: () => "deadbeef-0000-4000-8000-000000000000" };
        });
        const { writeUniqueFile: pinned } = await import("./file-saver.js");

        const first = await pinned(Buffer.from("original"), dir, "collide");
        expect(basename(first)).toBe(`collide_${FROZEN_MS}_deadbeef.txt`);

        await expect(pinned(Buffer.from("replacement"), dir, "collide")).rejects.toMatchObject({
            code: "EEXIST",
        });

        // The refused write left no partial document behind. `writeFile` is not
        // atomic, so an overwriting second write would have truncated this file
        // and a concurrent reader could have seen half a document.
        expect((await readFile(first)).toString()).toBe("original");
    });

    it("sanitises the name base itself, so a traversal cannot escape the directory", async () => {
        // The suffix does not neutralise a leading `../`: without sanitising at
        // the sink, this call writes `/tmp/authorized_keys_<ms>_<hex>.txt`,
        // outside the validated root, at 0o600, with caller-chosen bytes. The
        // guarantee belongs here rather than in a precondition every future save
        // site has to remember.
        const written = await writeUniqueFile(Buffer.from("x"), dir, "../../../../tmp/authorized_keys");

        expect(dirname(written)).toBe(dir);
        expect(basename(written)).not.toContain("..");
        expect(basename(written)).not.toContain("/");
    });

    it("sanitises the fallback too, so a traversal cannot escape through it either", async () => {
        // The mirror of the case above, and the one it did not cover. `fallback`
        // is what `createSafeFilenameBase` returns when `nameBase` sanitises to
        // nothing, so it reaches the filename by the same route — a caller
        // needed a fourth argument, not a second write sink.
        //
        // **The write target is a directory NESTED inside the fixture**, so the
        // one `../` this case escapes through lands on `dir` and is removed by
        // `afterEach`. Writing from `dir` itself would put the escaped file in
        // the repository root, and it would do so on exactly the runs where the
        // guard is broken — measured, not assumed: an earlier draft of this
        // case left two files there while probing the fix.
        const nested = join(dir, "nested");
        await mkdir(nested);
        const written = await writeUniqueFile(Buffer.from("x"), nested, "///", "../escaped_marker");

        expect(dirname(written)).toBe(nested);
        expect(basename(written)).not.toContain("..");
        expect(basename(written)).not.toContain("/");
    });

    it("falls back to the caller's name when the base sanitises to nothing", async () => {
        const written = await writeUniqueFile(Buffer.from("x"), dir, "///", "query_result");
        expect(basename(written)).toBe(`query_result_${FROZEN_MS}_${basename(written).slice(-12, -4)}.txt`);
        expect(basename(written)).toMatch(/^query_result_\d+_[0-9a-f]{8}\.txt$/);
    });
});

describe("writeUniqueFile is the only file-write sink in production code", () => {
    // **This is what protects every present and future save site**, and it is
    // here because the alternative does not work. The exclusivity guarantee is
    // `flag: "wx"`, which lives in exactly one function — so a test that a save
    // *site* produces two distinct paths cannot see it: an inline
    // re-implementation that keeps the same name shape passes such a test with
    // the whole suite green, which is how `docs/todos/012`'s P1 would come back
    // at a site that had been fixed. Measured, not argued: dropping only
    // `flag: "wx"` from the helper fails exactly one case in this file and
    // neither public save site.
    //
    // So the invariant enforced is the stronger, checkable one — nothing else
    // opens a file for writing. `src/lib/release-guards.test.ts` is the same
    // shape for the release invariants, and states the same reason: a rule
    // written in prose is read by nothing.
    //
    // **The check reads the IMPORT, not the call**, and that is the whole
    // difference between a guard and a list of the bugs already found. A
    // call-spelling match answers "does this file contain one of five
    // identifiers I thought of", which is a question the property does not
    // ask: `open(p, "w")` + `handle.write()`, `copyFile`, `rename` and
    // `truncate` all create or replace a file and match none of them, and
    // `import { writeFile as saveBytes }` escapes even the identifier it
    // aliases. Every one of those returns an empty offender list, which is
    // byte-identical to compliance. The import specifier is the one form none
    // of them can hide behind, because the binding must be named there before
    // it can be renamed.
    //
    // `WRITE_CAPABLE` is derived from Node's own `fs` API — the property's
    // definition — rather than from the spellings this codebase happens to
    // use today. `OWNER` is the only exemption; a module that legitimately
    // needs one of these joins it deliberately, which is a decision someone
    // makes and a reviewer can see.
    const WRITE_CAPABLE = new Set([
        "writeFile", "writeFileSync", "appendFile", "appendFileSync",
        "createWriteStream", "open", "openSync", "copyFile", "copyFileSync",
        "cp", "cpSync", "rename", "renameSync", "truncate", "truncateSync",
        "ftruncate", "ftruncateSync", "write", "writeSync", "writev",
        "writevSync", "link", "linkSync", "symlink", "symlinkSync",
    ]);

    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const OWNER = join("lib", "response", "file-saver.ts");

    /**
     * Write-capable `fs` bindings a module imports, by their ORIGINAL names.
     *
     * A namespace or `require` import yields `["*"]` — the bindings are not
     * enumerable at the import site, so nothing here can tell a read from a
     * write and the safe answer is to report it. Returns `[]` for a module
     * that touches `fs` only through read or metadata bindings.
     */
    const writeCapableImports = (source: string): string[] => {
        const FS = String.raw`["'](?:node:)?fs(?:/promises)?["']`;
        if (new RegExp(String.raw`require\(\s*${FS}\s*\)`).test(source)) return ["*"];
        if (new RegExp(String.raw`import\s+\*\s+as\s+\w+\s+from\s+${FS}`).test(source)) return ["*"];

        const named = new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s+${FS}`, "g");
        const found: string[] = [];
        for (const [, clause] of source.matchAll(named)) {
            for (const spec of clause.split(",")) {
                // `writeFile as saveBytes` — the original name is what binds.
                const original = spec.trim().split(/\s+as\s+/)[0].trim();
                if (WRITE_CAPABLE.has(original)) found.push(original);
            }
        }
        return found;
    };

    /** Every production `.ts` under `src/` — no tests, no fixtures. */
    const productionFiles = async (d: string): Promise<string[]> => {
        const out: string[] = [];
        for (const entry of await readdir(d, { withFileTypes: true })) {
            const p = join(d, entry.name);
            if (entry.isDirectory()) {
                out.push(...(await productionFiles(p)));
            } else if (
                entry.name.endsWith(".ts") &&
                !entry.name.endsWith(".test.ts") &&
                !entry.name.includes(".test-fixture.")
            ) {
                out.push(p);
            }
        }
        return out;
    };

    it("sees the owner, so an empty offender list means something", async () => {
        // The positive control. A sweep that cannot find the one site it knows
        // about has not witnessed the absence of any others.
        const owner = await readFile(join(srcRoot, OWNER), "utf-8");
        expect(writeCapableImports(owner)).toContain("writeFile");
    });

    it.each([
        ['import { writeFile } from "fs/promises";', "writeFile"],
        ['import { writeFile as saveBytes } from "fs/promises";', "writeFile"],
        ['import { open } from "node:fs/promises";', "open"],
        ['import { rename } from "fs";', "rename"],
        ['import { copyFile, stat } from "fs/promises";', "copyFile"],
        ['import * as fs from "fs/promises";', "*"],
        ['const fs = require("fs");', "*"],
    ])("catches %s", (source, expected) => {
        // The second positive control, and the one the previous call-spelling
        // form could not have passed. Each row is a way to reach the same
        // capability; the alias row is the cheap escape a maintainer reaches
        // for by accident, and `*` is the case where the bindings cannot be
        // read at all so the guard must not guess.
        expect(writeCapableImports(source)).toContain(expected);
    });

    it.each([
        'import { readFile } from "fs/promises";',
        'import { stat, access, realpath, constants as fsConstants } from "fs/promises";',
        'import { mkdtemp, chmod, rm, readdir, stat } from "fs/promises";',
    ])("does not fire on the read and metadata bindings: %s", (source) => {
        // The negative control. A guard that flags every `fs` importer would
        // be cleared by exempting five modules, and then it guards nothing.
        // These three are the real import lines of the non-owner production
        // modules that touch `fs`.
        expect(writeCapableImports(source)).toEqual([]);
    });

    it("finds no other production module importing a write-capable fs binding", async () => {
        const files = await productionFiles(srcRoot);
        expect(files.length).toBeGreaterThan(20);

        const offenders: string[] = [];
        for (const file of files) {
            const rel = relative(srcRoot, file);
            if (rel === OWNER) continue;
            const bindings = writeCapableImports(await readFile(file, "utf-8"));
            if (bindings.length > 0) offenders.push(`${rel} (${bindings.join(", ")})`);
        }
        expect(offenders).toEqual([]);
    });
});
