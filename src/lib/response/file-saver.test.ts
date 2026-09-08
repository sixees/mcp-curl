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
// The write-sink guard below parses production source rather than matching it.
// `typescript` is already a devDependency and this is a test-only import, so
// nothing reaches `dist`.
import ts from "typescript";
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

    it.each([".", "..", "///", "\u0000"])(
        "squeezes %j to nothing, which is what makes the deleted . and .. checks safe",
        (input) => {
            // These pass today, and that is the point. Two guards were deleted on
            // the argument that `squeeze` makes "." and ".." unconstructible, and
            // the terminal `|| "response"` rests on the same alphabet. Both claims
            // were checkable in under two minutes and were asserted by nothing, so
            // widening the character class — `/[^a-zA-Z0-9._-]/` is a plausible
            // one-line edit for readable hostnames — would silently un-delete them.
            expect(createSafeFilenameBase(input)).toBe("response");
        }
    );

    it("resolves to the terminal literal when the fallback also sanitises to nothing", async () => {
        const written = await writeUniqueFile(Buffer.from("x"), dir, "///", "///");
        expect(basename(written)).toMatch(/^response_\d+_[0-9a-f]{8}\.txt$/);
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
    // neither public save site. `ARCHITECTURE.md` invariant 17 is the citable
    // statement of the rule; this block is its enforcement.
    //
    // **The check is parsed, not matched, and it fails CLOSED.** Two earlier
    // forms of this guard both enumerated the *dangerous* side and so inherited
    // every omission. Matching five call spellings missed `open`, `rename`,
    // `copyFile` and every aliased import. Matching three import shapes then
    // missed a bare default import, `import fs, { readFile }` (whose named
    // clause matched and cleared the file), `{ promises }` — one binding
    // carrying the whole write API — a dynamic `import()`, and a re-export.
    // Each returned an empty offender list, which is byte-identical to
    // compliance. A third enumeration of syntax would have the same shape one
    // round later, so the enumeration is inverted instead: `PERMITTED_FS` lists
    // what is allowed, TypeScript's own parser reads the bindings, and anything
    // it cannot enumerate is reported rather than cleared. `release-guards.test.ts`
    // takes the same direction for the same reason — "a parse miss must not read
    // as 'nothing to enforce'".
    //
    // **Two residuals, stated rather than chased.** A computed specifier
    // (`require(spec)`, `createRequire(...)("fs")`) and a third-party `fs`
    // wrapper both evade this, because neither names an `fs` module literally.
    // No in-repo check closes them; a lint rule or a resolution-level split
    // would, and this repository has no lint layer.

    /**
     * Bindings a production module may hold from `fs`.
     *
     * **Permitted, not "read-only" — the distinction is deliberate.** `rm`,
     * `unlink`, `chmod` and `mkdir` mutate the filesystem and are on this list
     * because `files/temp-manager.ts` legitimately owns directory lifecycle.
     * This guard governs **file-content writes** — the surface `flag: "wx"`,
     * the `nameBase` sanitiser and `mode: 0o600` protect. Destruction and mode
     * changes are a separate invariant that nothing here enforces; a previous
     * version of this file called the same set "read and metadata bindings",
     * which was false of three of its members.
     */
    const PERMITTED_FS = new Set([
        "readFile", "readFileSync", "createReadStream", "readdir", "readdirSync",
        "stat", "statSync", "lstat", "lstatSync", "access", "accessSync",
        "realpath", "realpathSync", "existsSync", "constants", "watch",
        "mkdtemp", "mkdtempSync", "mkdir", "mkdirSync",
        "rm", "rmSync", "rmdir", "unlink", "chmod",
    ]);

    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const OWNER = join("lib", "response", "file-saver.ts");
    const isFsModule = (spec: string): boolean => /^(node:)?fs(\/promises)?$/.test(spec);

    /**
     * Every `fs` binding a module pulls in that is not on `PERMITTED_FS`.
     *
     * A form whose bindings cannot be enumerated at the import site — a default
     * import, a namespace import, a bare `import "fs"`, a dynamic `import()` or
     * a `require()` — yields a `"* (…)"` entry naming the form. Those are
     * reported because nothing here can tell a read from a write through them,
     * and the safe answer to "I cannot see" is not "nothing is there".
     */
    const forbiddenFsBindings = (source: string, name = "probe.ts"): string[] => {
        const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
        const found = new Set<string>();
        const takeNamed = (els: readonly ts.ImportSpecifier[] | readonly ts.ExportSpecifier[]): void => {
            for (const el of els) {
                // `writeFile as saveBytes` — `propertyName` is the original.
                const original = (el.propertyName ?? el.name).text;
                if (!PERMITTED_FS.has(original)) found.add(original);
            }
        };
        const visit = (node: ts.Node): void => {
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier) &&
                isFsModule(node.moduleSpecifier.text)
            ) {
                const clause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;
                if (!clause) {
                    found.add("* (side-effect import)");
                } else if (ts.isImportClause(clause)) {
                    if (clause.name) found.add("* (default import)");
                    const bindings = clause.namedBindings;
                    if (bindings && ts.isNamespaceImport(bindings)) found.add("* (namespace import)");
                    if (bindings && ts.isNamedImports(bindings)) takeNamed(bindings.elements);
                } else if (ts.isNamedExports(clause)) {
                    takeNamed(clause.elements);
                } else {
                    found.add("* (namespace re-export)");
                }
            }
            if (ts.isCallExpression(node)) {
                const target = node.expression;
                const arg = node.arguments[0];
                const isDynamic =
                    target.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(target) && target.text === "require");
                if (isDynamic && arg && ts.isStringLiteral(arg) && isFsModule(arg.text)) {
                    found.add("* (dynamic import)");
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
        return [...found];
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
        expect(forbiddenFsBindings(owner, OWNER)).toContain("writeFile");
    });

    it.each([
        // Each row is a way to reach a file-content write. Every one of these
        // was cleared by at least one earlier form of this guard; they are
        // fixtures now rather than history.
        ['import { writeFile } from "fs/promises";', "plain named"],
        ['import { writeFile as saveBytes } from "fs/promises";', "aliased"],
        ['import fs from "node:fs/promises";', "bare default"],
        ['import fs, { readFile } from "fs/promises";', "default beside a permitted name"],
        ['import { promises } from "node:fs";', "the whole promises API as one binding"],
        ['import { default as fs } from "node:fs";', "default via a named clause"],
        ['import * as fsp from "node:fs/promises";', "namespace"],
        ['const f = require("node:fs");', "require"],
        ['const { writeFile } = await import("fs/promises");', "dynamic import"],
        ['export { writeFile } from "fs/promises";', "re-export"],
        ['import "fs";', "side-effect import"],
        ['import { open } from "fs/promises";', "open"],
        ['import { rename } from "fs";', "rename"],
        ['import { copyFile, stat } from "fs/promises";', "copyFile beside a permitted name"],
        ['import {\n  readFile,\n  writeFile,\n} from "fs/promises";', "multi-line clause"],
    ])("reports %s (%s)", (source) => {
        expect(forbiddenFsBindings(source).length).toBeGreaterThan(0);
    });

    it.each([
        // The negative control. A guard that flagged every `fs` importer would
        // be cleared by exempting five modules and would then guard nothing.
        // These are the real import lines of every non-owner production module
        // that touches `fs`.
        ['import { readFile } from "fs/promises";', "jq-query.ts, schema/loader.ts"],
        ['import { stat, access, realpath, constants as fsConstants } from "fs/promises";', "output-dir.ts, file-validation.ts"],
        ['import { mkdtemp, chmod, rm, readdir, stat } from "fs/promises";', "temp-manager.ts"],
        ['import { writeFile } from "./my-utils.js";', "a write name from a non-fs module"],
    ])("does not fire on %s (%s)", (source) => {
        expect(forbiddenFsBindings(source)).toEqual([]);
    });

    it("finds no other production module holding a forbidden fs binding", async () => {
        const files = await productionFiles(srcRoot);
        expect(files.length).toBeGreaterThan(20);

        const offenders: string[] = [];
        for (const file of files) {
            const rel = relative(srcRoot, file);
            if (rel === OWNER) continue;
            const bindings = forbiddenFsBindings(await readFile(file, "utf-8"), rel);
            if (bindings.length > 0) offenders.push(`${rel} (${bindings.join(", ")})`);
        }
        expect(offenders).toEqual([]);
    });
});
