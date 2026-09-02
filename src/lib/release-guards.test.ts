// src/lib/release-guards.test.ts
//
// Two release-time invariants that were previously written down in prose and
// read by nothing. `prepublishOnly` runs the build only, and the repository has
// no CI workflow, so a rule stated in CONVENTIONS.md or CHANGELOG.md is a rule
// no step of the release path enforces. These are that enforcement.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRepoFile = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

/** Every docs/ path the tarball is allowed to contain. */
const EXPECTED_DOCS = [
    "docs/README.md",
    "docs/api-schema.md",
    "docs/architecture/architecture.md",
    "docs/configuration.md",
    "docs/custom-tools.md",
    "docs/getting-started.md",
    "docs/hooks.md",
];

const INTERNAL_DOC_PREFIXES = [
    "docs/todos/",
    "docs/work/",
    "docs/plans/",
    "docs/compound/",
    "docs/solutions/",
    "docs/brainstorms/",
];

describe("npm package contents", () => {
    // `docs/` was published wholesale, so an open P1 security todo — call site,
    // missing stages, worked failure scenario — would have shipped in the
    // tarball alongside the version it describes a gap in. npm forbids
    // re-publishing a version and bars unpublish after 72 hours, so this is one
    // of the few mistakes in this repo that cannot be taken back.
    // `npm pack --dry-run --json` keys the result by package name, not by index.
    // In a hook, not at module scope: vitest evaluates module bodies during
    // COLLECTION, so a subprocess here runs on every invocation including
    // filtered ones that execute none of these tests, and a throw takes the
    // whole file down as an opaque load error rather than a failed test.
    let paths: string[] = [];
    beforeAll(() => {
        const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 60_000,
            shell: process.platform === "win32",
        });
        const packed = JSON.parse(raw) as Record<string, { files?: Array<{ path: string }> }>;
        paths = Object.values(packed).flatMap((pkg) => (pkg.files ?? []).map((f) => f.path));
        // Validate rather than trust: an empty list would make every
        // absence-assertion below pass while proving nothing.
        expect(paths.length, "npm pack returned no files").toBeGreaterThan(0);
    });

    it.each(INTERNAL_DOC_PREFIXES)("does not publish anything under %s", (prefix) => {
        expect(paths.filter((p) => p.startsWith(prefix))).toEqual([]);
    });

    // The deny-list above enumerates today's directories; this asserts the
    // whole set. `files` still names `docs/architecture/` as a directory, so a
    // future internal document filed there would ship and every prefix case
    // would pass. An allowlist is a wildcard over its own future contents
    // (LESSONS.md RC-4) — so assert the contents, not the prefixes.
    it("publishes exactly the expected docs and nothing else", () => {
        expect(paths.filter((p) => p.startsWith("docs/")).sort()).toEqual([...EXPECTED_DOCS].sort());
    });

    // Positive control: an assertion set made only of absences is satisfied by
    // publishing nothing at all.
    it("still publishes the consumer documentation and the build", () => {
        expect(paths).toContain("docs/getting-started.md");
        expect(paths).toContain("docs/api-schema.md");
        expect(paths.some((p) => p.startsWith("dist/"))).toBe(true);
    });
});

/**
 * Extracted so the guard can be exercised over fixtures rather than only over
 * the repository's own changelog. A control that re-implements the predicate
 * against an inline literal cannot notice the real one going inert — which is
 * exactly what happened when the top section was renamed away from `BREAKING`.
 *
 * @returns the offending major pair when the changelog claims a breaking change
 *   the version does not back, or `null` when the pairing is consistent.
 */
export function findUnbackedBreakingChange(
    changelog: string,
    version: string
): { major: number; lastMajor: number } | null {
    const firstHeading = changelog.indexOf("## [");
    // A parse miss must not read as "nothing to enforce". If the heading style
    // ever changes, the guard has to fail loudly rather than pass quietly.
    if (firstHeading === -1) {
        throw new Error("release guard: no '## [' section heading found in CHANGELOG.md");
    }
    const nextHeading = changelog.indexOf("\n## [", firstHeading + 1);
    const topSection = changelog.slice(
        firstHeading,
        nextHeading === -1 ? changelog.length : nextHeading
    );

    if (!/^###\s+BREAKING\b/m.test(topSection)) return null;

    const major = Number(version.split(".")[0]);
    // The previous RELEASE's major — the first version heading strictly below
    // the top section. Never "every major that isn't the current one": that
    // filter drops the prior 3.x releases too, leaves 0, and makes `3 > 0` pass
    // forever (LESSONS.md RC-5).
    const below = nextHeading === -1 ? "" : changelog.slice(nextHeading);
    const priorRelease = /^## \[(\d+)\.\d+\.\d+\]/m.exec(below);
    // No prior release heading means the comparison has no subject. Defaulting
    // to 0 would make `major > 0` true for every 3.x and pass the guard exactly
    // when it cannot see anything — the RC-5 shape again.
    if (!priorRelease) {
        throw new Error(
            "release guard: a BREAKING heading is present but no prior release " +
            "heading was found, so the major bump cannot be verified"
        );
    }
    const lastMajor = Number(priorRelease[1]);

    return major > lastMajor ? null : { major, lastMajor };
}

describe("version and changelog agree on severity", () => {
    it("passes on the repository as it stands", () => {
        const result = findUnbackedBreakingChange(
            readRepoFile("CHANGELOG.md"),
            JSON.parse(readRepoFile("package.json")).version as string
        );
        expect(
            result,
            result === null
                ? undefined
                : `The changelog's top section carries a BREAKING heading but package.json is ` +
                `${JSON.parse(readRepoFile("package.json")).version}. Either bump the major, or ` +
                `state the decision explicitly under a different heading — a MINOR release of a ` +
                `breaking shape is a defensible posture, but it has to be written down rather ` +
                `than implied.`
        ).toBeNull();
    });

    // Positive controls that exercise the GUARD, not a copy of its regex.
    it("flags a BREAKING heading that no major bump backs", () => {
        const cl = "## [3.3.0] - 2026-09-01\n\n### BREAKING\n\n- x\n\n## [3.2.0] - 2026-08-01\n\n### Fixed\n\n- y\n";
        expect(findUnbackedBreakingChange(cl, "3.3.0")).toEqual({ major: 3, lastMajor: 3 });
    });

    it("accepts a BREAKING heading backed by a major bump", () => {
        const cl = "## [4.0.0] - 2026-09-01\n\n### BREAKING\n\n- x\n\n## [3.2.0] - 2026-08-01\n\n### Fixed\n\n- y\n";
        expect(findUnbackedBreakingChange(cl, "4.0.0")).toBeNull();
    });

    it("is silent when the top section carries no BREAKING heading", () => {
        const cl = "## [3.3.0] - 2026-09-01\n\n### Fixed\n\n- x\n\n## [3.2.0] - 2026-08-01\n\n### Fixed\n\n- y\n";
        expect(findUnbackedBreakingChange(cl, "3.3.0")).toBeNull();
    });

    it("throws rather than passing when there is no prior release to compare against", () => {
        const cl = "## [3.3.0] - 2026-09-01\n\n### BREAKING\n\n- x\n";
        expect(() => findUnbackedBreakingChange(cl, "3.3.0")).toThrow(/no prior release heading/);
    });

    it("throws rather than passing when the changelog cannot be parsed", () => {
        expect(() => findUnbackedBreakingChange("# Changelog\n\nno sections here\n", "3.3.0")).toThrow(
            /no '## \[' section heading/
        );
    });
});
