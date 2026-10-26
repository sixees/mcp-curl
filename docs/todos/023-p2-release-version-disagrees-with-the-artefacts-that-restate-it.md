---
status: pending
effort: s
tags: [code-review, release, versioning, dist, invariants, changelog]
dependencies: []
---

# The release's version is restated in several places, and they disagree

## Problem Statement

`package.json` says `5.1.0`. Two other tracked artefacts make claims about that same version and disagree with it.

1. **The committed build.** `dist/` is tracked, and every earlier release commit included it rebuilt. The 5.1.0 commit did not. At HEAD, `dist/chunk-GNA6F4ZN.js::SERVER` still bakes in `VERSION: "5.0.1"`. That value feeds the `curl_execute` version line, `serverInfo.version` and the default User-Agent, so a run from the tagged commit without a rebuild reports `mcp-curl v5.0.1`. That is the new version-line feature reporting the wrong version. npm consumers are unaffected, because `prepublishOnly` runs the build. The rebuilt `dist/` is sitting uncommitted in the working tree.
2. **The severity contract.** 5.1.0 ships two `**BREAKING:**` changes as a MINOR, by an operator decision (2026-10-21, recorded in `docs/work/handoff-feat-embedder-base-url.md` and in the CHANGELOG). `.sixees/ARCHITECTURE.md` → invariant 11 still reads as absolute ("A breaking change … is a MAJOR bump"), and no RC records the exception. #46's `feat(url)!:` subject disagrees with the CONVENTIONS rule that `!` goes only with a MAJOR. A later round will either re-open the decision as a P1, or cite 5.1.0 as precedent without its condition.

## Findings

- class: a release fact (the version, and the severity it claims) is stated in several tracked artefacts, and the release step updated only some of them. Nothing checks that they agree.
- aliases: `convention-drift` (pattern-recognition-specialist), `convention-drift` (architecture-strategist). Merged on the shared confirmed instance `package.json::version`.
- instances:
  - `package.json::version`: `5.1.0` (and `package-lock.json`). **confirmed, in diff**
  - `CHANGELOG.md::[5.1.0]`: "Both changes shipped in a MINOR release by decision". **confirmed, in diff**
  - `dist/chunk-GNA6F4ZN.js::SERVER`: committed `"5.0.1"`. **confirmed**
  - `.sixees/ARCHITECTURE.md::Invariants #11`: no exception clause. **confirmed, out of diff**
  - `.sixees/CONVENTIONS.md::! breaking marker rule`: disagrees with #46's subject. **confirmed, out of diff**
- sweep:
  - `git grep -n -E '5\.0\.1|5\.1\.0' HEAD -- dist` → 1 candidate, 1 confirmed. Release commits 0c7f647, 16ebce1, 85443fa and 30f25b6 each rebuilt `dist/`; a2d4b9b touches 0 `dist/` files.
  - `MINOR` across the tracked tree → 2 recorded overrides of invariant 11 (3.3.0, 5.1.0).
  - `^###\s+BREAKING|^- \*\*BREAKING` in CHANGELOG → 3 bullets, 0 headings.
- root: source. `tsup.config.ts` bakes `pkg.version` in at build time, and the invariant's exception condition (the consumer population) lives only in changelog prose.
- Found by: pattern-recognition-specialist and architecture-strategist, Surface 2 review, 2026-10-26.

## Proposed Solutions

### Option 1: Fix both facets on this branch
- Commit the rebuilt `dist/` (`npm run build`).
- Record the 2026-10-21 MINOR decision as an RC via `skill: file-lessons`. Then either give invariant 11 its exception and its test in one place, or state that it binds without exception from the next release.
- Optionally extend `src/lib/release-guards.test.ts` to assert that the `VERSION` literal in the committed `dist/` equals `package.json`'s version. That fails at HEAD and passes after the rebuild.
- Pros: the release is self-consistent and the decision stays settled.
- Cons: touches `.sixees/` standards documents in a release PR.

### Option 2: Rebuild only, and record the decision separately
Commit `dist/` now, and file the invariant 11 record as follow-up work.
- Pros: the release PR stays narrow.
- Cons: the next release that changes a public entry point is reviewed against an invariant that still reads as absolute.

## Recommended Action

_Operator to choose._

## Acceptance Criteria

- [ ] `git show HEAD:dist/chunk-*.js` carries `VERSION … "5.1.0"` (or a guard asserts the committed build matches `package.json`).
- [ ] The MINOR-with-BREAKING decision is recorded as an RC, and invariant 11 has one spelling that agrees with it.

## Work Log

### 2026-10-26 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** Filed from `/sixees-workflow:review` inside `/sixees-workflow:work` PR-4 (`docs/release-5.1.0`). Confirmed `dist/` is tracked (`git ls-files dist`: 15 files) and that the working tree holds an uncommitted 5.1.0 build from this run's `npm run build`.
**Learnings:** The plan's task 16 named `package.json` only. The tracked build is a third place the version lives (K-8: two spellings of one fact).
