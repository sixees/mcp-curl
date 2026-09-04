---
id: 011
title: "The layering arrow names 4 of 16 directories, so invariant 10 is uncheckable for the rest"
status: open
severity: P2
tags: [architecture, conventions, pre-existing]
class-id: layer-inversion
source: /simplify altitude lane (architecture-strategist), 2026-09-03
reviewers: [architecture-strategist]
created: 2026-09-03
---

# The layering arrow covers 4 of 16 directories

## Problem

`CONVENTIONS.md` → *Structure* → *The layering arrow* states invariant 10 over
`config/`, `security/`, `tools/` and `utils/`. `src/lib/` has **sixteen**
directories. For the other twelve a review can neither approve nor reject an
import, so the rule degrades into a convention nobody can cite.

Worse, the one directory the arrow does place contradicts its own placement:
`utils/` is documented as leaf-level and "imports nothing above itself", yet
`utils/url.ts` imports `config/security/url-schemes.ts` and `utils/sanitize.ts`
imports `config/limits.ts`.

## Confirmed unadjudicable edges

- `security/file-validation.ts::resolveSharedTempDirSafely` → `files/temp-manager.ts`
  — pulls in three pieces of mutable singleton state, filesystem I/O and a
  failure-backoff timer, so `validateFilePath`'s allowed-roots set varies with
  another module's I/O history. That may be fine; **nobody can say**, because
  `files/` is not on the arrow.
- `execution/curl-args-builder.ts` → `security/index.js` — `execution/` unplaced.
- `utils/url.ts` → `config/security/url-schemes.ts` — contradicts the stated leaf rule.
- `utils/sanitize.ts` → `config/limits.ts` — same shape.
- `response/` → `security/` + `jq/` + `files/`; `schema/` → `tools/` — both unplaced.

**No cycle exists today** — all sixteen directories' import edges were enumerated
and the graph is a DAG. `config/` imports nothing outside itself, which is the one
arm the arrow does protect, and it holds.

## Cost

The next import that closes a cycle arrives as a module-init ordering bug at
runtime, because there is no rule to cite in review and nothing checking one.

## Why this is filed rather than fixed

It is a `CONVENTIONS.md` change plus new CI tooling, not a source cleanup — well
outside a `/simplify` pass, and the DAG it commits to is an architectural
decision the operator should make rather than inherit from a reviewer's reading.

## Fix

State the arrow over every directory as an explicit DAG. A defensible reading of
the current tree:

```
types/ ← config/ ← utils/ ← security/ ← files/ ← execution/, response/, jq/
      ← tools/ ← schema/, extensible/ ← server/ ← transports/

session/    ← config/, types/            → consumed by server/, transports/
prompts/    ← utils/                     → consumed by server/, extensible/
resources/  ← nothing outside itself     → consumed by server/, extensible/
```

The second block is the three directories the first one leaves unplaced; each
position is what the tree's imports read today, not a preference. All sixteen are
named so the acceptance criterion below can be checked rather than assumed.

Then stop it being prose: `dependency-cruiser`, or `eslint-plugin-import`'s
`no-restricted-paths`, in CI. `CONVENTIONS.md` → *Structure* already says to work
down the ladder types → linter → test; this rule currently sits below the bottom rung.

## Acceptance criteria

- [ ] Every directory under `src/lib/` has a stated position on the arrow.
- [ ] A violating import fails the build by name, not by a reviewer remembering.
- [ ] Teeth check: add a deliberately inverted import (`config/` → `security/`),
      confirm CI fails, remove it.
- [ ] The `utils/` "imports nothing above itself" claim is corrected or the two
      imports contradicting it are moved.
