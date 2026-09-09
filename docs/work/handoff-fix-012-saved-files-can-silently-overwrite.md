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

- [x] Push and open a PR. **Done** — PR #40. The three commits the Surface 2 review
      produced were pushed on 2026-09-09, which moved the PR head from `b89ff01` to
      `c981e18`; until then the PR carried the pre-review state and no bot had seen the
      parsed write-sink guard.
- [x] Run `/sixees-workflow:review-pr-comments`. **Done** — see *Review Comments
      Addressed* below. Surface 3 has now run.

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

---

## Code Review — 2026-09-08 (Surface 2, `/sixees-workflow:review` of PR #40)

**Certification:** complete
**Roster closure:** closed · unresolved: `security-sentinel` → "Anything genuinely outside your lane gets one line under `notes:` and no finding"; `pattern-recognition-specialist` → "The correctness of any single instance → whichever reviewer owns that lane"

Two rounds, eight reviewers each, on the operator's instruction to repeat the loop
twice and to fix in-scope P1–P3, file a todo for an out-of-scope P1, and decline
out-of-scope P2/P3. Round 2's subject was round 1's fixes (K-16), not the original
diff. Base `6effe5b`, resolved by `git merge-base --fork-point origin/HEAD HEAD`.

**Roster:** the config's six plus the always-run floor of four, deduped to eight —
`typescript-reviewer`, `code-simplicity-reviewer`, `security-sentinel`,
`performance-oracle`, `architecture-strategist`, `pattern-recognition-specialist`,
`data-integrity-guardian`, `learnings-researcher`. All sixteen dispatches returned;
none failed, none was unmigrated. This is a wider roster than Surface 1 ran —
`architecture-strategist` and `performance-oracle` were not dispatched there, and
both produced findings or measurements this round.

### Findings

| Round | Class | `class-id` (aliases) | Sev | Reviewers | Disposition |
|---|---|---|---|---|---|
| 1 | Write-sink guard enforced an absolute with five call spellings | `fail-open-default` (`unchecked-assertion`, `missing-constraint`) | P1 (esc. from P2) | typescript, architecture, data-integrity, security | **fixed** `e5a8f41` |
| 1 | `createSafeFilenameBase` returned `fallback` unsanitised | `missing-validation` | P1 (esc. from P2) | typescript | **fixed** `e5a8f41` |
| 1 | Published `SavedFile` row stated the pre-fix filename | `stale-comment` | P2 | architecture, security | **fixed** `e5a8f41` |
| 1 | Barrel export orphaned by this branch | `dead-code` | P3 | code-simplicity | **fixed** `e5a8f41` |
| 1 | Third cwd-rooted fixture missing the `if (dir)` guard | `duplicated-logic` | P3 | pattern-recognition | **fixed** `e5a8f41` |
| 1 | `node:crypto` specifier load-bearing for the test's `doMock` | `convention-drift` | P3 | typescript | **fixed** `e5a8f41` |
| 1 | Lossy UTF-8 decode on read-back at `jq_query` | `missing-validation` | P2 | data-integrity | **already tracked — `docs/todos/016`**, note appended |
| 2 | Guard enumerated import *syntax*; five more forms cleared | `fail-open-default` (`unchecked-assertion`) | P1 (esc. from P2) | typescript, architecture, data-integrity, security | **fixed** `3f00f74` |
| 2 | The new invariant is in no numbered invariant | `convention-drift` | P2 | architecture | **fixed** `3f00f74` (invariant 17) |
| 2 | Reserved-name re-check after truncation unreachable | `dead-code` | P3 | typescript, security | **fixed** `3f00f74` |
| 2 | Round 1's own doc row overshot; RC-52 annotation non-canonical | `stale-comment` / `convention-drift` | P3 | security, architecture | **fixed** `3f00f74` |
| 2 | `realpath` block labelled defence-in-depth under a docblock denying it | `misplaced-decision` | P3 | architecture | **fixed** `3f00f74` (label) |
| 2 | Deletions' reachability proof pinned by no case | `lost-code-path` | P3 | typescript | **fixed** `3f00f74` |
| 2 | Fixture vars declared `string` while guarded for undefined | `unchecked-assertion` | P3 | typescript | **declined — remedy measured** |
| 2 | `jq-query.ts:105` over-indent | `convention-drift` | P3 | typescript | **declined — out of scope** |

**Rejected: 0.** Every class had a confirmed instance and a concrete `failure:`.

**Escalations, and the join that produced them.** `learnings-researcher` supplied the
`Class:` lines and confirmed the read on the second round: RC-34 carries
`fail-open-default`, RC-28 and RC-29 carry `unchecked-assertion`. The guard class
escalated on that match in **both** rounds — it survived a correct fix, which is a
verdict on the layer and the reason round 2 moved to the parser rather than to a
fourth regex. `security-sentinel` graded round 2's instance P2 with auditable
reasoning (no attacker-reachable source; hardening not vulnerability); the merge
kept the highest of four P2s and the ledger match then escalated it. The
disposition was identical either way.

### Declines, with the evidence

- **`string | undefined` on the four fixture variables.** Correct diagnosis — the
  declared type does contradict the `if (dir)` guard. **The remedy was applied and
  reverted:** it produces 33 `TS2345` errors at body call sites across three test
  files, so protecting one teardown line costs 33 `dir!` assertions, which is worse
  code than the documented guard. K-15 — the remedy was run, not read.
- **`jq-query.ts:105`'s over-indent.** Verified against `6effe5b`: the line is not
  in the diff. Out-of-scope P3.
- **5.9 ms of fixture cost** paid by the string-only `it.each` rows, on
  `performance-oracle`'s own measurement — 38x the regex-hoisting saving it was
  asked about, and neither worth touching on a 758 ms suite.
- **`architecture-strategist` withdrew its own round-1 proposal** to add a
  `CONVENTIONS.md` → *Documentation* sentence, on the ground that it would be a
  third spelling of a rule two documents already carry.

### Two reviewer claims rejected on evidence

- **"Dropping the barrel export removed a published export on a v4.0.0 package"**
  (`security-sentinel`, out-of-lane note). Refuted: `createSafeFilenameBase` appears
  in **zero** of the four `.d.ts` files *and* zero of the four runtime entry points
  the `exports` map reaches, at the base commit. It was never published.
- **"`ARCHITECTURE.md` invariant 20 understates the filepath"** (same). There is no
  invariant 20 — they run 1–16. The substance was real and is folded into invariant
  14's correction.

### Handoff assessment

The original handoff was accurate on every claim I could check, and its *Key
decisions* table did the job it exists for — three settled positions (`Date.now()`'s
second job, the structural guard over per-site tests, `targetDir`'s prose
precondition) were re-raised by reviewers and closed by citation rather than
re-litigated.

**Verified:** 1308/1301/0/7 test counts exactly; 9 new cases (7 + 2); the 12 `tsc`
errors and their files; "no lint script"; the published-API claim in all four
`.d.ts` files and all four runtime entry points; the prior `/security-review`
artefacts (`reviewer_status: "ok"`, `findings_count: 0`, empty `findings.jsonl`
reconciling); the ledger's machine-read format for all 51 entries.

**Two gaps it had.** Its *Commit history* lists three commits where the branch
carries five: **`458c321` — an unrelated `/sixees-workflow:reconcile-lessons` run
filing RC-51 and correcting the ledger preamble — rides on this PR and the handoff
never mentions it.** Merging #40 merges that work too. And "the nine other exported
functions in `src/lib/response/`" is wrong as a count: there are 20, one of which
(`plainBranchNotices`) does not follow payload-first. The convention holds; the
figure does not.

### Outstanding

| File | Priority | State |
|---|---|---|
| `docs/todos/016-P2-wire-octets-are-decoded-lossily-before-persistence.md` | P2 | open, pre-existing; a fourth independent confirmation and one new fact appended this round |
| `docs/todos/020-P3-save-failure-after-the-request-reports-as-a-request-failure.md` | P3 | open, filed by this branch, trigger recorded |

**No todo was created by this review.** No out-of-scope P1 arose, so the deferral
cap was not approached.

**Blockers: none.** Both escalated P1s are fixed and probed.

**Operator-side, unchanged by this review:** the version is still `4.0.0` and this
repo bumps before the merge; `2402cc5`'s message under-describes its contents;
`458c321`'s presence on this PR is a scope decision; and **Surface 3 has not run** —
no bot reviewer was dispatched and none auto-reviews.

---

## Review Comments Addressed — 2026-09-09 (Surface 3, `/sixees-workflow:review-pr-comments` of PR #40)

Operator instruction: engage codex and Copilot, three rounds, resolve all comments
after each round. **Before round 1 the PR head was `b89ff01`** — the three commits
the Surface 2 review produced were unpushed, so the PR carried the pre-review
regex write-sink guard. Pushed on authorisation to `c981e18` first; every bot in
every round below reviewed the current code.

**Copilot engagement, recorded because the signal is misleading.** Three routes were
tried: GraphQL `requestReviews(botIds:)` with the bot id discovered at runtime, and
REST `requested_reviewers` with logins `Copilot` and `copilot-pull-request-reviewer[bot]`.
All three returned success and left `requested_reviewers` empty, which was read as
"Copilot is not engaged" and reported that way. **That reading was wrong** — Copilot
reviewed in round 1. Its review request is consumed on submission rather than held as
a pending reviewer, so an empty `requested_reviewers` is not evidence either way.
Which of the three routes fired is not determinable from the outcome.

### Round 1 — Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Invariant 17 sits between 15 and 16 (MD029) | `coderabbitai` | Fix needed | Moved the invariant 17 block after invariant 16. Pure reorder — sorted line multiset unchanged, every existing citation still resolves. The reported remedy ("restore invariants 15 and 16") misdiagnosed: both were present; the skipped prefix was a symptom of the block's position |
| Dynamic-import arm accepts only `ts.isStringLiteral` | `coderabbitai` | Fix needed | **Graded P1, not the reported "Trivial".** Fail-open in the write-sink guard. Arm now fails closed on any specifier it cannot read, rather than enumerating a second node kind — see *Class escalation* below |
| Guard fires on type-only `fs` imports | `coderabbitai` | Fix needed | Skipped at both levels: `ImportClause`/`ExportDeclaration.isTypeOnly`, and `ImportSpecifier.isTypeOnly` for the inline `{ type Stats, readFile }` form the comment did not name |
| Follow-up checklist says nothing has been pushed | `coderabbitai` | Documentation | Both items were false, not merely stale. Marked done with the facts |

### Round 1 — Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| `srcRoot` resolves to `src/lib`, so the positive control reads a nonexistent `src/lib/lib/response/file-saver.ts` and throws ENOENT | `copilot-pull-request-reviewer` | would be P1 if true | in scope (`gh pr diff 40`) | **False positive — path arithmetic off by one level.** The test file is at `src/lib/response/`, so two `..` reach `src`, not `src/lib`. Measured: the positive control `sees the owner…` — the exact case that would throw the described ENOENT — passes, 38/38 green. The same arithmetic is load-bearing again in `finds no other production module…`, which skips the owner via `relative(srcRoot, file) === OWNER`; a wrong `srcRoot` would make that comparison never match and report the owner as its own offender |

### Round 1 — Class escalation (the write-sink guard, third instance)

The guard has now missed a write-capable form three times, and `coderabbitai` graded
the third "🔵 Trivial / nitpick". Re-derived from consequence and escalated: a
production module doing `await import(`fs/promises`)` creates a real write binding
and the guard reported nothing, so `ARCHITECTURE.md` invariant 17 silently stopped
holding. `class-id: fail-open-default`, matching `LESSONS.md` RC-34.

| Instance | Enforcement layer | Fixed by |
|---|---|---|
| Five call spellings (`writeFile(`, …) | text match on call sites | Surface 2 round 1 — match import syntax instead |
| Five import syntax forms (default, `{ promises }`, dynamic, re-export) | regex over import lines | Surface 2 round 2 — move to the TypeScript parser |
| Literal node kinds inside the dynamic-import arm | `ts.isStringLiteral` only | **this round** — fail closed on an unreadable specifier |

Adding `isNoSubstitutionTemplateLiteral`, as the comment's patch proposed, would have
been a third enumeration of the same class and would have left `import(spec)` clear on
the same argument. The arm now reports any specifier it cannot resolve, which is what
`forbiddenFsBindings`'s own docblock already claimed it did and the code did not. That
also closes one of the file's two documented residuals (a computed specifier), so the
residuals comment was corrected rather than left as a second spelling of one fact.

**Still open by design, and stated in the file:** `createRequire(...)("fs")`, whose
callee is a call expression rather than the `require` identifier this parse keys on,
and a third-party `fs` wrapper.

### Round 2 — no findings

Trigger: `@codex review` scoped to `6a911bc`, plus a Copilot re-request via GraphQL
`requestReviews`. Codex reviewed `6a911bc` and reported none. **Copilot did not
re-review.** That was first written up here as evidence that round 1's review came from
one of the REST calls rather than the GraphQL mutation. **Round 3 refutes that
inference** — it fired the REST route alone, on an unchanged head, and also produced no
review. What is actually supportable: Copilot reviewed exactly once, in round 1, after
all three routes had been fired within a few minutes of each other, and neither
single-route attempt afterwards produced anything. Which route works is not
determinable from these three observations.

**A gap in the fetch, recorded because it fails silently.** `pr-comments` returned
three entries, all `chatgpt-codex-connector` top-level. It did **not** return the four
review comments `coderabbitai` posted on `6a911bc` at 06:28:14–06:28:52, because those
are replies into threads CodeRabbit had already auto-resolved when it saw the fix
commit land — and a resolved thread does not appear in the fetch. So "no CodeRabbit
findings this round" was not something the fetch could establish. Read directly via
`reviewThreads(first:50)` including resolved ones: all four are acknowledgements, none
is a new finding, and one ratifies the round-1 escalation —
*"The P1 severity is appropriate because the bypass could leave a write-capable `fs`
binding unreported and defeat invariant 17… The fail-closed handling for unreadable
dynamic specifiers is stronger than the proposed literal-kind expansion."*

**Anyone repeating this loop should read resolved threads directly.** A round that
fixes everything gets its threads auto-resolved, and every reply landing after that is
then invisible to the next round's fetch — including an objection, if there had been
one.

### Round 3 — no findings

Trigger: `@codex review` scoped to the unchanged head `6a911bc`, plus a Copilot
re-request via REST `requested_reviewers`. Codex reviewed `6a911bc` a second time and
reported none. No new review thread was opened by any reviewer, and no reviewer other
than codex posted at all.

**Round 3 had no new subject, and that bounds what it establishes.** The head was the
same commit round 2 had already reviewed clean, so this was a second pass over an
identical tree rather than a round with fresh material. It is a fair thing to ask of a
non-deterministic reviewer and it is not equivalent to a round on new code.

**One trigger was rewritten before posting.** The first draft ended by naming
`forbiddenFsBindings` as "the subject most worth a fresh look" and referred to codex's
previous clean verdict. Both are steering rather than scope under
`/sixees-workflow:review-pr-comments` → §3 — one narrows what gets examined, the other
invites the reviewer to conclude there is nothing left — and either would have produced
a round that reads as independent without being so. Reposted with the head sha, what
had not changed, and the path list, and nothing else.

### Surface 3 — final tally across three rounds

| Disposition | Count |
|---|---|
| fixed | 4 |
| declined | 1 |
| answered | 4 |
| deferred | 0 |
| escalated | 0 |

**Fixed : declined = 4 : 1.** Todos: **0 filed this run, 0 open against #40.**
Threads outstanding: **0** — all five inline threads are resolved and each carries a
reply. The four `answered` entries are codex's own status and clean-verdict comments;
they carry no defect, they are top-level, and **they cannot be closed** — a
`kind: "issue"` entry has no resolved state and returns on every future read.

**Per reviewer.**

| Reviewer | Findings | Fixed | False positives | Decline rate |
|---|---|---|---|---|
| `coderabbitai` | 4 | 4 | 0 | 0/4 |
| `copilot-pull-request-reviewer` | 1 | 0 | 1 | 1/1 |
| `chatgpt-codex-connector` | 0 over 3 reviews | — | — | — |

CodeRabbit auto-reviewed on push without being triggered — it was not on the requested
roster — and produced every finding this surface acted on. It also posted four
acknowledgement replies confirming the fixes, one of which ratified the round-1
escalation. Copilot's single finding was a false positive on path arithmetic. Codex was
the only explicitly requested reviewer that ran in all three rounds and it found nothing
in any of them.

**The fix:decline ratio departs from the two-thirds-decline expectation the command
sets, and the reason is the subject rather than the triage.** The diff contains a
freshly written TypeScript-compiler-API walk, which is code with real holes rather than
stylistic ones; three of the four fixes were in that one function. Rounds 2 and 3, which
reviewed the fixes themselves, produced nothing — which is the shape a converging loop
has.

**Operator-side, unchanged by this surface:** the version is still `4.0.0` and this repo
bumps before the merge; `2402cc5`'s message under-describes its contents; and
`458c321` — an unrelated `reconcile-lessons` run filing RC-51 — still rides on this PR.
Merging #40 merges that work too.
