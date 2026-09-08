# Work Handoff: saved files can silently overwrite each other

**Date:** 2026-09-08 | **Branch:** `fix/012-saved-files-can-silently-overwrite` | **Plan:** `docs/todos/012-P1-saved-files-can-silently-overwrite.md` | **Status:** complete

## Summary

A saved response's identity was `${safeName}_${Date.now()}.txt`, written non-exclusively,
so two saves resolving to one path left the second silently replacing the first — both
callers holding the same filepath and no error on either side. This closes it with one
shared write helper, `writeUniqueFile`, that both save sites route through: `flag: "wx"`
converts a residual collision into `EEXIST`, and 32 bits of `randomUUID` are what separate
two saves whose name bases are already identical.

The approach followed `docs/todos/012` → *Fix*, with two audited departures from it. The
todo's prescribed snippet would have reinstated a defect `LESSONS.md` RC-33 removed, and
its ranking of the two collision sources is inverted for a real consumer — both recorded
as RCs before the first edit. A five-reviewer Surface 2 round then found that the first
implementation put its guarantees in prose rather than in the code, and that one of its
tests asserted a property its comment did not cover; both were fixed in the second commit.

## What was implemented

**The shared write helper** — `src/lib/response/file-saver.ts::writeUniqueFile`

- Name is `${safeName}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`; write is
  `{ mode: 0o600, flag: "wx" }`.
- Takes `content: Buffer` only, matching `saveResponseToFile` and
  `parser.ts::parseResponseWithMetadata`, which both refuse a `string | Buffer` union with
  RC-33's reasoning.
- Calls `createSafeFilenameBase` **itself** and takes the fallback as a parameter, so
  neither call site names the sanitiser and neither can omit it.
- Payload-first parameter order, matching the nine other exported functions in
  `src/lib/response/`.

**Both save sites route through it**

- `src/lib/response/file-saver.ts::saveResponseToFile` — now a one-line delegation. Its
  public signature stays `Buffer`-only, so RC-33's contract is untouched.
- `src/lib/tools/jq-query.ts::executeJqQuery` — encodes at the call site
  (`Buffer.from(persisted, "utf8")`), which also dropped a redundant second
  `Buffer.byteLength` of the same text. Imports through `../response/index.js`, the barrel
  it already used.
- Exported from `src/lib/response/index.ts`. **Not published** — `src/lib.ts` takes only
  `defendText` from that barrel, `src/lib/index.ts` does not re-export it at all, and the
  symbol appears in none of the four `.d.ts` files the `exports` map reaches.

**Patterns followed.** `createSafeFilenameBase`'s placement and barrel export as the
precedent for where the helper goes; `src/lib/release-guards.test.ts` as the precedent for
a structural guard over prose; `jq-query.test.ts`'s cwd-rooted `mkdtemp` fixture pattern
(and its macOS `/private/var` rationale) for the new test file.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Random suffix **and** `flag: "wx"`, not either | AC1 pins `Date.now` to a constant and demands two *distinct paths*; against an already-identical base, `wx` alone yields one path and one `EEXIST` and cannot pass. `wx` is what makes the residual an error. Measured — see RC-53 | The todo offered them as alternatives. `wx`-with-retry was rejected: AC5 asks for a collision to *surface as an error*, so the branch a retry adds is the branch the criterion forbids |
| No `encoding` on the write | Inert for a `Buffer`, already Node's default for a `string`. The todo's snippet prescribed `encoding: "utf-8"`, which is what RC-33 deliberately removed | Following the snippet literally. Rejected — see RC-52 |
| Keep `Date.now()` in the name | It is **not** part of the uniqueness guarantee, and the docblock no longer implies it is. It holds a second job: saved artefacts sort chronologically for anyone listing the directory. Deleting it to satisfy a uniqueness argument would silently drop that (K-20) | `code-simplicity-reviewer` traced all five ACs against a clock-free name and each still holds, offering deletion as the simpler option. Declined on the second-job ground it had not weighed |
| `content: Buffer`, not `string \| Buffer` | The union was enforced at the public boundaries and relaxed at the shared seam every save site funnels through — the invariant enforced where callers can bypass it and not where they cannot | Keeping the union because the two sites hold different things. That was the first implementation; see RC-55 |
| Sanitise `nameBase` inside the sink | The suffix does not neutralise a leading `../`. The todo asked for a helper "so no future save site has to remember", and a docblock precondition is exactly what must be remembered | Leaving it as documented prose. `createSafeFilenameBase` is idempotent, so both callers keep their exact output at no cost |
| `targetDir`'s precondition stays prose | Re-validating inside `response/` means importing the directory policy from `files/`, adding a `realpath` and a `stat` to every write for a precondition that holds at both sites and is checked at one boundary | A branded `ValidatedOutputDir` type minted only by `validateOutputDir`/`getOrCreateTempDir` — compile-time, zero runtime cost, and the right shape. Larger than this branch; recorded in RC-55 rather than grown into it |
| A structural write-sink guard instead of per-site collision tests | The exclusivity guarantee lives in one function, so a per-site test cannot see it. Nothing-but-the-helper-opens-a-file-for-writing covers every present *and future* save site, and was cheaper than one collision case per site | Two per-site collision cases, as `data-integrity-guardian` recommended. Stronger invariant chosen instead; see RC-54 |

## What to pay attention to during review

- **`src/lib/response/file-saver.test.ts`'s write-sink guard is the load-bearing test.**
  It regex-scans every production `.ts` under `src/` for
  `writeFile`/`writeFileSync`/`appendFile`/`appendFileSync`/`createWriteStream`. If a
  future module legitimately needs to write a file, this guard is what will fail, and the
  fix is to extend the allowlist deliberately rather than to weaken the regex. It carries a
  **positive control** as a separate case for the reason K-18 names.
- **The `vi.doMock("node:crypto")` case.** `randomUUID` is imported directly, and Node
  core-module ESM bindings are typically non-configurable, so `vi.spyOn` cannot pin it the
  way `Date.now` is pinned. `resetModules` → `doMock` → dynamic re-import is the working
  route; `afterEach` unmocks and resets. Vitest 4 defaults to `pool: "forks"` with
  `isolate: true` and `vitest.config.ts` overrides neither, so the mock is per-file. Note
  that `vi.doMock`'s factory is *not* type-checked against `typeof import("node:crypto")` —
  a misspelled `randomUuid` would silently mock nothing, which is why the case also asserts
  the exact `basename`.
- **`jq-query.test.ts::routes its write through the shared helper`** asserts a filename
  *shape*, and its comment now says explicitly that this says nothing about `flag: "wx"`.
  Do not let a later edit re-inflate that claim.
- **Security-sensitive:** this diff changes a filesystem write in a module reached from
  both trust boundaries. `security-sentinel` and the built-in `/security-review` both
  returned clean and both noted the change is net security-positive — `flag: "wx"` closes a
  pre-existing symlink-planting arbitrary-write primitive (a predictable path in a shared
  `output_dir` could be pre-planted as a symlink and followed by the non-exclusive
  `writeFile`), and a `mode` gap on the same root, since `mode` applies only at creation so
  overwriting a precreated `0o666` file left it world-readable with response content in it.

## Known issues and limitations

- **The first write is still not atomic.** `flag: "wx"` stops a second writer truncating an
  existing file; it does not make the initial `writeFile` atomic, and `docs/todos/008`
  measured 197 ms for a 9.4 MB body. No in-repo consumer can observe a partial file — the
  path is returned only after the write resolves, and the random suffix makes it
  unguessable — but `data-integrity-guardian` correctly noted that an **out-of-process**
  agent with generic file tooling could `ls` a shared `output_dir`, take the newest entry
  and read a truncated document. Not fixed: AC4 names `flag: "wx"` as an accepted remedy in
  its own text, and the cheap-looking alternative is not cheap — `rename(2)` overwrites
  silently, so temp-name-then-rename would *reintroduce* the overwrite hole unless built on
  `link(2)` + `unlink`.
- **`jq_query`'s catch discloses an absolute path unsanitised**, where `curl_execute` routes
  through `sanitizeErrorMessage`. Pre-existing, and **declined with evidence rather than
  deferred**: `security-sentinel` confirmed it is not a hole — the wrap
  (`response/post-processor.ts::createWrapper`) runs `defendText` with
  `contentTypeUndetermined: true`, the strictest grammar, over every text part including
  error results, so invariant 1a holds at the wrap — and the success arm already returns the
  same path to the same consumer. It becomes live only if that wrap-level exemption changes.
- **12 pre-existing `tsc --noEmit` errors**, all in `.test.ts` files outside this diff
  (`src/lib.test.ts`, `post-processor.test.ts`, `schema.test.ts`). `npm run build` uses tsup
  and is clean. Not touched.
- **`createSafeFilenameBase`'s barrel export is now unused** — the helper is its only
  production caller and the test imports it directly from `./file-saver.js`. Left in place
  deliberately: removing an export is unrelated to closing 012.
- **`skill: file-todos` and this repo disagree on todo naming.** The skill specifies
  `{id}-{status}-{priority}-{desc}.md`; `CONVENTIONS.md` → *Where work products go*
  specifies `<nnn>-<P1..P3>-<slug>.md`, which all 16 files on disk follow. The project's
  convention was used. Flagged, not resolved — it is a standing K-8 between shipped prose
  and a project document, and not this run's to settle.

## Testing summary

**Verdict source:** `npm test -- --reporter=json --outputFile=<path>`, parsed from the
artefact. The declared command was run with a reporter appended, not replaced by a resolved
runner.

- **1308 tests collected, 1301 passed, 0 failed, 7 pre-existing skips.** `success: true`;
  structural failure count over `.testResults[].assertionResults[]` is `0`.
- **9 new cases** — 7 in `src/lib/response/file-saver.test.ts` (new file), 2 in
  `src/lib/tools/jq-query.test.ts`.
- **Lint:** the project declares no lint script. `tsc --noEmit` reports 0 errors in the five
  touched files. `npm run build` (tsup + DTS) succeeds.

**Teeth verified in both directions, not assumed:**

| Probe | Result |
|---|---|
| Revert the whole fix (name + flag) | 5 of 6 original assertions fail. The 6th was the utf-8 round-trip, which the probe did not touch |
| Drop **only** `flag: "wx"`, keep the name | **1** case fails — the helper's — and **neither public save site**. This is what proved the original `jq-query` test was a false green, and it is why the write-sink guard exists |
| Plant `writeFile(` in `src/lib/response/formatter.ts` | The write-sink guard fails and names `lib/response/formatter.ts` |

**Gaps.** No case asserts a collision at a *public* save site — deliberate, since the
write-sink guard covers the failure that motivated one (an inlined re-implementation at any
site) more completely than two per-site cases would. Concurrency is sequential in the tests:
AC1 says "concurrent", but with the clock pinned the discriminator is `randomUUID`, which is
order-independent, so nothing is lost. Both restores during probing used `cp` from a copy
set aside beforehand — never `git restore`, `checkout --`, or `stash`.

## Commit history

```
2402cc5 test(response): use a synthetic org id in the truncation fixture
99c8af6 fix(response): move the write helper's guarantees into the code from its prose
3b90ed7 fix(response): route both save sites through an exclusive write
```

**`2402cc5`'s message under-describes its contents, and that is a staging error
rather than a deliberate grouping.** It carries the two-line fixture change its
subject names *and* all of `LESSONS.md` RC-52..RC-55, this handoff, the addition
of `docs/todos/020`, and the deletion of `docs/todos/012` — those had been staged
earlier in the run and were swept in when the test file was added and committed.
The intended separate docs commit then found nothing to commit.

Not corrected in place: `git commit --amend` is on
`skill: pr-resolver-safety`'s forbidden list, and `git reset --soft` is the same
ban in a different spelling. Nothing is lost and the tree is correct; the branch
is unpushed, so regrouping is the operator's to do if wanted. A squash merge
makes it moot.

## Review context

**Suggested review order**

1. `src/lib/response/file-saver.ts::writeUniqueFile` — the whole change is this function
   and its docblock's four claims.
2. `src/lib/response/file-saver.test.ts` — read the write-sink guard's comment first; it
   explains why the obvious test does not work.
3. `src/lib/tools/jq-query.ts` — the encode at the call site, and the byte count now taken
   from the same `Buffer`.
4. `LESSONS.md` RC-52 → RC-55.

**Related** — `ARCHITECTURE.md` invariant 8 (resolve-then-validate ordering, unchanged here
and confirmed by trace at both call sites), invariant 11 (published API, untouched),
`LESSONS.md` RC-33 (the byte contract this seam had to re-establish), RC-28 (why the saved
arm carries no `content`, which is what removed the detectability this defect relied on).

**Surface 2 roster and coverage** — five specialists dispatched against the diff:
`data-integrity-guardian` (P2 + P3), `typescript-reviewer` (P2), `security-sentinel` (P3),
`code-simplicity-reviewer` (P3), `pattern-recognition-specialist` (clean). All five
returned; none failed. `/security-review` ran and its output was parsed by
`security-review-parser` — `reviewer_status: "ok"`, `findings_count: 0`, and the empty
`findings.jsonl` reconciles with that count. Artefacts under
`docs/work/.scratch/security-review/work-012-20260908t1930z/`.

**Not run, and therefore not claimed:** `architecture-strategist` and `performance-oracle`
were not dispatched — this diff adds no module and changes no loop or query. **Surface 3
has not run.** No bot reviewer was dispatched and none auto-reviews; the PR is unreviewed by
Surface 3 until `/sixees-workflow:review-pr-comments` is run. `/security-review` resolves
its own scope and dispatches its own sub-task, so its coverage of the whole diff is not
observable from here and is not asserted.

## Reality Corrections

Filed in `LESSONS.md`, which is the single source of truth for them. Pointers only.

- **RC-52** — the todo's prescribed fix would have reinstated a defect RC-33 removed
- **RC-53** — the collision source the todo ranked second is the only one that fires for a
  real consumer
- **RC-54** — the test asserted the filename and its comment claimed the flag
- **RC-55** — the extraction relaxed the byte contract at the one seam every caller funnels
  through

**No POST-AUDIT annotation was added**, because the input was a todo and there is no plan
file in `docs/plans/` for this work. RC-52 and RC-53 both name
`docs/todos/012-…md` as their `Plan:` and record what the todo said, so the divergence is
attributed to the document it diverged from.

## Follow-up work

- [ ] Push and open a PR — awaiting authorisation. Nothing has been pushed.
- [ ] Run `/sixees-workflow:review-pr-comments` once a PR exists; Surface 3 has not run.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/020-P3-save-failure-after-the-request-reports-as-a-request-failure.md` | P3 | A save failure after the request completed reports as a *request* failure, inviting a retry that re-applies a non-idempotent mutation. Pre-existing in `curl-execute.ts`'s outer catch; 012 added `EEXIST` as one further trigger, and that half is declined on an empty population. Carries a trigger | `data-integrity-guardian`, this run |

**Declined, not deferred** — recorded here rather than filed, so a later round cites this
instead of re-opening it:

- **The `EEXIST` half of todo 020.** Reaching it needs 32 bits of `randomUUID` to repeat
  inside one millisecond under an identical `safeName`. Population empty (K-14).
- **A retry loop on `EEXIST`.** AC5 asks for a collision to surface as an error; a retry is
  the branch that criterion forbids. Settled in RC-53 — cite it rather than re-litigating,
  per `.claude/rules/03-divergence.md` → *Settled conflicts stay settled*.
- **`jq_query`'s unsanitised path in its catch.** Not a hole; the wrap defends it. Evidence
  in *Known issues* above.
- **Re-validating `targetDir` inside the helper.** Cost exceeds value at one checked
  boundary; the branded-type alternative is recorded in RC-55.
- **`temp-manager.ts::cleanupOrphanedTempDirs` keys orphan deletion on directory mtime**, so
  a second server instance starting up can delete a live-but-idle instance's temp dir and
  every saved artefact a caller holds a path to. Real data-loss shape, entirely pre-existing,
  untouched and not worsened by this diff. Noted by `data-integrity-guardian` out of lane.
  **Not filed** — it is a distinct subject from this branch and wants its own investigation
  rather than a todo written from a one-line observation.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/012-P1-saved-files-can-silently-overwrite.md` | Saved response files have no uniqueness constraint and are written with a plain overwrite | Closed by `writeUniqueFile`: `flag: "wx"` plus 32 bits of randomness, one shared sink for both save sites, sanitising moved into the sink, and a structural guard that no other module opens a file for writing. All five acceptance criteria met; criteria 2 and 5 were only *apparently* met by the first commit and are covered by the guard added in the second | Claude Code | 2026-09-08 |
