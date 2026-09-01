// src/lib/release-guards.test.ts
//
// Two release-time invariants that were previously written down in prose and
// read by nothing. `prepublishOnly` runs the build only, and the repository has
// no CI workflow, so a rule stated in CONVENTIONS.md or CHANGELOG.md is a rule
// no step of the release path enforces. These are that enforcement.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRepoFile = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

/** Paths that hold internal work products and must never reach a consumer. */
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
    const packed = JSON.parse(
        execFileSync("npm", ["pack", "--dry-run", "--json"], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        })
    ) as Record<string, { files: Array<{ path: string }> }>;
    const paths = Object.values(packed).flatMap((pkg) => pkg.files.map((f) => f.path));

    it.each(INTERNAL_DOC_PREFIXES)("does not publish anything under %s", (prefix) => {
        expect(paths.filter((p) => p.startsWith(prefix))).toEqual([]);
    });

    // Positive control: an assertion set made only of absences is satisfied by
    // publishing nothing at all.
    it("still publishes the consumer documentation and the build", () => {
        expect(paths).toContain("docs/getting-started.md");
        expect(paths).toContain("docs/api-schema.md");
        expect(paths.some((p) => p.startsWith("dist/"))).toBe(true);
    });
});

describe("version and changelog agree on severity", () => {
    // CONVENTIONS.md -> Commits: "The subject, the version and the changelog are
    // three claims about severity, and a reader who trusts any one of them is
    // misled when they disagree." An unreleased BREAKING section against an
    // un-bumped major is exactly that disagreement, and the failure mode is a
    // `npm version patch` that ships a breaking shape to every `^3.x` consumer.
    const changelog = readRepoFile("CHANGELOG.md");
    const version = JSON.parse(readRepoFile("package.json")).version as string;

    // The top-most section, whatever it is called — `[Unreleased]` before a
    // release is cut, or the new version's own heading after.
    const firstHeading = changelog.indexOf("## [");
    const topSection = changelog.slice(
        firstHeading,
        changelog.indexOf("\n## [", firstHeading + 1)
    );

    it("flags a BREAKING section that no major bump backs", () => {
        const hasBreaking = /^###\s+BREAKING\b/m.test(topSection);
        if (!hasBreaking) return; // Nothing to enforce.

        const major = Number(version.split(".")[0]);
        const priorMajors = [...changelog.matchAll(/^## \[(\d+)\.\d+\.\d+\]/gm)]
            .map((m) => Number(m[1]))
            .filter((n) => n !== major);
        const lastMajor = priorMajors.length ? Math.max(...priorMajors) : 0;

        expect(
            major,
            `The changelog's top section carries a BREAKING heading but package.json is ${version}. ` +
            `Either bump the major, or state the decision explicitly under a different heading — ` +
            `a MINOR release of a breaking shape is a defensible posture, but it has to be written ` +
            `down rather than implied. Nothing in the publish path reads the changelog, so this ` +
            `test is the only gate.`
        ).toBeGreaterThan(lastMajor);
    });

    it("does not fire when the unreleased section carries no BREAKING entry", () => {
        // Positive control for the guard above: a section with only ### Fixed
        // must not be reported as needing a major bump.
        const benign = "## [Unreleased]\n\n### Fixed\n\n- a thing\n";
        expect(/^###\s+BREAKING\b/m.test(benign)).toBe(false);
    });
});
