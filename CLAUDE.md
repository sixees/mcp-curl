# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

**This file says how to work here, and nothing else.** Three companion documents
own the rest, and each fact lives in exactly one of them:

| Question | Document |
|---|---|
| How is this system built? What must a change not break? | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What must the work look like? | [`CONVENTIONS.md`](./CONVENTIONS.md) |
| What went wrong before, and what did it teach us? | [`LESSONS.md`](./LESSONS.md) |
| How is the workflow configured for this repo? | [`docs/compound/compound-engineering-profile.md`](./docs/compound/compound-engineering-profile.md) |

Session rules under `.claude/rules/` load automatically. They are gitignored and
per-clone — run `/sixees-workflow:init-compound` in a fresh clone to get them.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm start            # Run the server (stdio transport)
npm test             # Run vitest tests
npm run test:watch   # Watch mode tests
TRANSPORT=http PORT=3000 npm start  # Run with HTTP transport
```

## Before changing anything

**Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first if the change touches
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

- **Architecture, module map, tools, security model, invariants** →
  [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Code style, naming, layering rules, test and commit conventions, work-product
  paths** → [`CONVENTIONS.md`](./CONVENTIONS.md)
- **Reality Corrections and the shapes this project has earned** →
  [`LESSONS.md`](./LESSONS.md) — read it before planning anything touching a
  surface an RC already names.
