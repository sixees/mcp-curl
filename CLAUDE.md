# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

**This file says how to work here, and nothing else.** Three companion documents
own the rest, and each fact lives in exactly one of them:

| Question | Document |
|---|---|
| What must a change not break? (numbered invariants, trust boundaries) | [`ARCHITECTURE.md`](./.sixees/ARCHITECTURE.md) |
| How is this system built? (stack, lifecycle, security detail) | [`docs/architecture/architecture.md`](./docs/architecture/architecture.md) |
| What must the work look like? | [`CONVENTIONS.md`](./.sixees/CONVENTIONS.md) |
| What went wrong before, and what did it teach us? | [`LESSONS.md`](./.sixees/LESSONS.md) |
| How is the workflow configured for this repo? | [`docs/compound/compound-engineering-profile.md`](./docs/compound/compound-engineering-profile.md) |

Session rules under `.claude/rules/` load automatically. They are gitignored and
per-clone — run `/sixees-workflow:init-compound` in a fresh clone to get them.

**This document is read at the start of every session, and that is the whole
mechanism.** Nothing here is checked by anything. Keep it short enough to be read:
a `CLAUDE.md` nobody reaches the end of governs only its first half.

**This guidance is offered forward; your answers never are.**
`/sixees-workflow:refresh-compound` reports what the current scaffold carries that
this copy lacks — the paragraphs saying what this document owns and how to keep it —
and inserts only what you authorise. It writes no answer and removes no line.
`/sixees-workflow:reconcile-standards` is the other pass: it moves prose that belongs
in a sibling into that sibling, moves prose that belongs *here* in from one, and reconciles this file's section names against **the
shipped scaffold's** — never against the sections already in this copy, which are the
thing being measured. Both ask before writing, and neither commits.
**Keep this paragraph outside the blockquote above**, which you are told to delete once
the document is filled.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm start            # Run the server (stdio transport)
npm test             # Type-check (tests included), then run vitest
npm run typecheck    # Type-check only: the one gate that sees @ts-expect-error
npm run test:watch   # Watch mode tests
TRANSPORT=http PORT=3000 npm start  # Run with HTTP transport
```

## Before changing anything

**Read [`ARCHITECTURE.md`](./.sixees/ARCHITECTURE.md) first if the change touches
`src/lib/security/`, `src/lib/config/security/`, `src/lib/execution/`, or
`src/lib/response/`.** Those four directories carry the numbered invariants; a
change there that does not say which invariant it touches has not been thought
through yet.

Both ends of this system are hostile — the model picks the URL, the remote picks
the response bytes. Code that looks defensively over-engineered usually is not:
`--data-raw` over `--data`, resolving symlinks before the scope check, detecting
before sanitising. Check `ARCHITECTURE.md` before simplifying any of it.

## Ask before acting

- **Push and merge require explicit authorisation.** Commit freely on a feature
  branch; stop and ask before pushing, and again before merging. Recorded in the
  profile → §8.
- **Bring review findings back before merge**, with a disposition for each
  (fixed / declined-with-evidence / deferred-with-trigger). Never merge on green.
- **Anything under `configs/` may hold real credentials.** The `*.yaml`/`*.yml`/
  `*.ts`/`*.js`/`*.json` files there are gitignored for that reason — do not read
  them into a transcript or echo their contents.

## What lives where

- **Numbered invariants and the trust-boundary map** →
  [`ARCHITECTURE.md`](./.sixees/ARCHITECTURE.md). Cite them by number.
- **Stack, directory structure, request lifecycle, data stores, full security
  architecture** → [`docs/architecture/architecture.md`](./docs/architecture/architecture.md)
  (this one is published to npm; the root file is not)
- **Code style, naming, layering rules, test and commit conventions, work-product
  paths** → [`CONVENTIONS.md`](./.sixees/CONVENTIONS.md)
- **Reality Corrections and the shapes this project has earned** →
  [`LESSONS.md`](./.sixees/LESSONS.md) — read it before planning anything touching a
  surface an RC already names.
