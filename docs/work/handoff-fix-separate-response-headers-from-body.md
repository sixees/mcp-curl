# Handoff — separate response headers from the body

**Branch:** fix/separate-response-headers-from-body
**PR:** #32 · **Status:** in-review · **Created:** 2026-09-01

> Created **during review**, not by the original work. No handoff existed when
> `/sixees-workflow:review` ran — recorded as a process gap, and it meant three
> rounds of reviewers worked code-first with less context than normal.

## What this branch does

`curl -i` prepends the response header block to the body on stdout. Everything
downstream treated that combined string as a body: `save_to_file` wrote a file
that was not the JSON it claimed to be, and `jq_filter` had to be refused
outright. The branch separates the two so headers are reported as the response
metadata they are.

Commits: `816ff1c` (the original fix) · `5bcec16` (Compound Engineering
onboarding, unrelated — see *Known issues*) · `65d86e6`, `28f89d1`, `09d4a62`
(review rounds 1-3).

## Key decisions

| Decision | Why |
|---|---|
| Header text takes `defendText`, the shared five-stage pipeline | It previously got `sanitizeAndDetect` alone — Step 2 of five — losing beacon and script stripping. It had been defended for years only because it sat inside the body |
| Header text declared `text/markdown` | Strictest grammar; header values are rendered by whatever the client renders |
| …but with `decodeEntities: false` | That stage is additive and its output is returned. Decoding would hand the model a live instruction the origin sent as inert text |
| Boundary from cURL's `%{size_header}`, not from the bytes | A body may legitimately *be* an HTTP transcript, so no pattern can separate a real header block from a forged one |
| Byte-exact indexing of `stdoutBytes` | `%{size_header}` counts wire bytes; a lossy UTF-8 decode inflates U+FFFD 1→3 and moves the offset |
| Undetermined boundary refuses `save_to_file`/`jq_filter` | Those turn unproven bytes into durable or parsed artefacts. Refusing is what makes the documented guarantee true on every path |
| A plainly-JSON body is excluded from strictest-grammar | `processResponse` writes post-strip content to disk; a model-facing posture must not rewrite the persisted artefact |
| 3.3.0, not 4.0.0 | Breaking in form; the package has no consumers, so the major-bump rule protects nobody. Recorded in the changelog as a deliberate posture, explicitly barred from being cited as precedent |

## What to pay attention to during review

- **Any new text channel.** Three separate defects came from text reaching the
  model through a path that assembled its own pipeline. `ARCHITECTURE.md`
  invariant 1a; coverage is still partial and `docs/todos/001` names what is left.
- **Any byte offset.** An offset measured on one representation may only index
  that representation. Invariant 13.
- **Sweeps.** `docs/todos/001`'s original sweep was structurally incapable of
  finding a channel that called no defence at all (RC-6). Derive a sweep from the
  class, not from the instance in hand.

## Known issues and limitations

- **This PR carries two unrelated changes.** `816ff1c` is the response fix;
  `5bcec16` is Compound Engineering onboarding. Flagged before the PR was opened;
  the operator chose the current branch deliberately.
- **`docs/todos/002` is the significant one.** The `-i` multiplexing means the
  boundary must be recovered arithmetically, and that arithmetic has failed three
  times in three rounds. Rung 3 of the escalation ladder: the layer is wrong.
  Chunked trailers are the live residue — `%{size_header}` does not count them,
  so trailer text lands in `response`. Verified against real cURL.
- **`docs/todos/003`** — memory ceiling released before the peak. Pre-existing.
- **`dist/` is committed**, so the diff carries build output.
- **`npm audit --omit=dev` reports 11 advisories**, `js-yaml` being the one with a
  named path into this code. Pre-existing; not addressed here.

## Testing summary

`npm test` — 32 files, 1057 passed, 7 skipped (platform-conditional). Typecheck
clean on all changed source. `dist/` rebuilt and verified to correspond to `src/`.
`npm pack --dry-run` ships seven consumer docs and nothing internal.

**Test gaps:** no test drives a `Content-Type` past the 8192-byte window; the
chunked-trailer case has no test (it is todo 002's acceptance criterion); the
`<500ms` linearity assertion guards the pre-PR scan, which no code in the tree
can now reach, so it is a fossil rather than a live gate.

## Code review — 2026-09-01

Three rounds, six reviewers each (`security-sentinel`, `typescript-reviewer`,
`performance-oracle`, `data-integrity-guardian`, `code-simplicity-reviewer`,
`learnings-researcher`). 18 reviewer-runs, all returned.

| Round | Findings | P1 after merge | Outcome |
|---|---|---|---|
| 1 | 8 raw → 4 classes | 2 | All fixed |
| 2 | 15 raw → 10 classes | 2 | All in-scope fixed |
| 3 | ~25 raw → 12 classes | 4 | In-scope fixed; 2 filed |

**Every round found defects in the previous round's fix**, which is what three
rounds were for. Six Reality Corrections filed: RC-1 through RC-6 in `LESSONS.md`.

**Blockers:** none outstanding for this branch. `docs/todos/002` is P1 but is
deliberately out of scope — it replaces the mechanism rather than repairing it.
