// src/lib/response/file-saver.test.ts
// Guards on a saved artefact's identity: two saves never resolve to one path,
// and a residual collision is an error rather than a silent overwrite.
//
// **`Date.now` is pinned in every case here, and that is the measurement rather
// than a convenience.** The clock was the only discriminator the pre-fix naming
// scheme had, so a case that lets it run is measuring how fast the machine is:
// it passes on two saves a millisecond apart whether the defect is fixed or
// not. `docs/todos/012`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join, basename } from "path";
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
    });

    it("separates two endpoints whose bases are cut to one string by the length cap", async () => {
        // The second, independent collision source, and the one that fires on
        // every save for a consumer with a long path prefix: the cap lands
        // inside `/organizations/{id}/workspaces/`, so the resource name never
        // reaches the filename at all.
        const prefix = "https://focus.example.test/api/organizations/21141236/workspaces/999";
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

describe("writeUniqueFile — a residual collision is an error, not an overwrite", () => {
    it("refuses the write and leaves the existing file whole", async () => {
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

        const first = await pinned(dir, "collide", Buffer.from("original"));
        expect(basename(first)).toBe(`collide_${FROZEN_MS}_deadbeef.txt`);

        await expect(pinned(dir, "collide", Buffer.from("replacement"))).rejects.toMatchObject({
            code: "EEXIST",
        });

        // The refused write left no partial document behind. `writeFile` is not
        // atomic, so an overwriting second write would have truncated this file
        // and a concurrent reader could have seen half a document.
        expect((await readFile(first)).toString()).toBe("original");
    });

    it("writes a string as utf-8 without a named encoding", async () => {
        // The helper takes `string | Buffer` because the two save sites hold
        // different things, and it names no `encoding` — inert for a Buffer,
        // already the default for a string. `LESSONS.md` RC-33.
        const path = await writeUniqueFile(dir, "text", "héllo — ok");
        expect((await readFile(path)).toString("utf-8")).toBe("héllo — ok");
    });
});
