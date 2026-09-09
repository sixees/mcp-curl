# Work Handoff: ReDoS budget guards measure CPU time, not wall clock

**Date:** 2026-09-09 | **Branch:** `fix/013-redos-guards-measure-cpu-not-wall-clock` | **Plan:** `docs/todos/013-P2-redos-budget-guards-fail-under-the-suites-own-parallelism.md` | **Status:** complete

## Summary

`strip-blocks.test.ts`'s ReDoS guards asserted an absolute **wall-clock** budget.
`Date.now()` keeps counting while a vitest worker is descheduled, so beside the suite's
own parallel workers they measured the host's load rather than the pattern's cost — and
failed intermittently, a different case each run, on work costing 1-2 ms. All three guard
sites now measure CPU time through one shared helper, `cpuMs`, which also asserts the
precondition that makes CPU time valid here. The budget is unchanged at 100 ms; only the
clock moved.

The audit found the todo's remedy under-scoped and its cited precedent gone, and found its
acceptance criterion already satisfied by the unfixed code. Both are filed as RCs. Review
then found two toothless guards — one in the fixture this branch added, one pre-existing in
the flood table — and both are fixed.

## What was implemented

**The clock change.** `src/lib/response/strip-blocks.test.ts` — the three `it.each` flood
guards, over `stripHtmlComments`, `stripBlocksFixedPoint` and `stripMarkdownBeacons`, each
now read `expect(cpuMs(() => …)).toBeLessThan(REDOS_BUDGET_MS)`. `REDOS_BUDGET_MS`'s
docblock is re-measured in CPU terms and no longer describes a wall clock.

**The shared helper.** `src/lib/response/cpu-time.test-fixture.ts::cpuMs` is the single
implementation. It carries two guards of its own, both fail-closed:

- `assertOwnProcess` — `process.cpuUsage()` counts the whole process, so it measures one
  file's work only while that file has a process to itself. Vitest's default `forks` pool
  gives it one; a `threads`/`vmThreads` pool shares one process between files and every
  sibling worker's CPU lands in the same counter. Enforced, not documented, because the
  contaminated counter still returns a number that reads as a pass.
- `assertMeasuredToCompletion` — the clock stops when the body *returns*, which for an
  `async` body is its first `await`. TypeScript admits a promise-returning callback where
  `() => void` is expected, so nothing upstream objects. A thenable result is refused.

**The reuse fold.** `src/lib/response/parser.test.ts::"costs the same on a pathological
tail as on a short one (invariant 15)"` held an inline copy of the same idiom and a prose
copy of the pool precondition. Both fold into the helper.

**The declines, written in place.** `processor.test.ts::"ReDoS regression: 1 MB
pathological body completes within CI-tolerant 2 s"` and `sanitize.test.ts::"matches a
1 MB pathological 'ignore' chain in well under 2 s"` keep their 2 s wall-clock budgets,
each with the reason and the margin recorded beside it.

**Conventions.** `CONVENTIONS.md` → *Naming* gained the `*.test-fixture.ts` row that
`curl-output.test-fixture.ts` already cited as owning the rule, and which did not exist.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Change the clock, not the budget | A descheduled measurement is unbounded however wide the budget. The previous generation of this guard was widened to 2 s and four floods then passed the probe | Widen the budget (rejected: recorded in-file as what made the earlier guard worthless); serialise the suite with `poolOptions` (rejected: slows every run to fix three cases, and `forks` isolation is what makes CPU time valid) |
| Extract `cpuMs` rather than inline it at three more sites | `parser.test.ts` already held the idiom, so the next copy is the second — `02-reuse-first.md` mandates extraction there. It also gives the pool precondition one home instead of four prose copies | Inline at each site (rejected: four copies of the measurement *and* of the precondition) |
| Assert the pool precondition in code | The failure is silent: a contaminated counter returns a number and the guard reports a pass. `parser.test.ts` documented this and could not prevent it | Leave it as prose (rejected — this is the RC-29 lesson: a guard is not part of the thing it guards, so it does not move with it) |
| Keep the fixture in `src/lib/response/` | Both consumers are there, matching `curl-output.test-fixture.ts`'s co-location. `utils/` is leaf-level, so the move down stays available later at no cost | Put it in `utils/` now (rejected: a leaf-layer fixture for a consumer that does not exist) |
| Refuse a thenable at runtime, not at the type level | `cpuMs<T extends void>` rejects async bodies at compile time but also rejects today's expression-bodied arrows returning a value, costing braces at all 25 call sites | The generic (rejected on cost); a check on `undefined` (rejected: breaks every existing site, all of which return a string) |
| Assert the ratio's divisor exists rather than flooring it | A floor turns an unresolvable reading into a real-looking divisor, and `0 / floor` reports a ratio of zero — a pass from two measurements that never happened | Leave the floor (declined first, then reversed — see *Review context*) |
| Two wall-clock guards stay | 20x and 7x margins, no observed failure in 19 measured runs, and the mechanism is recorded beside each so the next reader does not widen the budget instead | Convert all five (rejected by the director as wider than asked); silently leave them (rejected: acceptance criterion 3 requires a disposition per site) |

## What to pay attention to during review

- **`cpuMs`'s two throws are the whole safety of every guard that calls it**, and both are
  the shape a later simplification deletes without turning anything red.
  `cpu-time.test-fixture.test.ts` exists for that reason and nothing else. Its positive
  control matters more than it looks: with `cpuMs` stubbed to return `0`, **all 110
  strip-blocks cases still pass** — that control is the only thing in the tree that
  notices.
- **The pool precondition has no unit test, deliberately.** `isMainThread` is not
  injectable, so a unit test could only assert against a stub of the fixture's own import.
  It is verified by running the suite under `--pool=threads`, where 25 guards fail with the
  fixture's message. Re-run that if the check is touched.
- **`assertOwnProcess` rules out the shared-pool case and nothing more.** libuv-threadpool
  CPU still lands in the counter and `isMainThread` cannot see it. Both directions inflate
  a reading, so they redden a guard rather than green one — which is why one boolean is the
  whole check.
- **The flood table's per-case mutation notes are now load-bearing.** A flood case is a
  guard only if some removable mechanism in the subject makes it expensive. One case here
  had none for two releases. Each input now records the figure it reaches under its
  mutation; a new variant added without one inherits exactly that defect.
- **`REDOS_BUDGET_MS`'s docblock is the owner of the calibration**, and `ARCHITECTURE.md`
  invariant 15 cites it by name for the 2 s-versus-1.1 s lesson. Removing figures from the
  docblock breaks that citation silently — it did, mid-branch, and was restored.

## Known issues and limitations

- **21 of the 24 flood cases are unexamined for the toothless shape.** `security-sentinel`
  probed all three `stripHtmlComments` cases and found one decorative; it explicitly did
  not examine the 15 `stripBlocksFixedPoint` and 6 `stripMarkdownBeacons` cases, naming
  them *suspected-unknown, not suspected-defective*. Confirming each needs one probe per
  cost-bearing mechanism per case. Not done here. **This is the largest thing this branch
  leaves open** and it is a decision for the director, not a silent decline.
- **The `*.test-fixture.ts` boundary is a filename with no import guard.**
  `file-saver.test.ts::productionFiles` exempts the suffix by name, so a write binding
  placed in a fixture and imported from production would satisfy invariant 17's sweep. This
  branch doubles the exempt set from one file to two. The rule is now written
  (`CONVENTIONS.md` → *Naming*) and the new fixture carries the boundary note, but nothing
  mechanical enforces it. Declined as out of scope; see *Follow-up work*.
- **The load harness is scratch and is not committed.** What is durable is the measured CPU
  figures in `REDOS_BUDGET_MS`'s docblock and in `cpuMs`. Reproducing the original failure
  needs contention: on an idle 24-core machine the unfixed code passes 4/4.
- **`bounded-throttle.ts::setBounded`** shares the `() => void` shape with load-bearing
  synchrony. Untouched here, all callers sync. Noted, not filed.
- **`jq/parser.ts::parseJqExpression`** bounds a production parse with a `Date.now()`
  budget. That is correct there — production wants a latency bound, not a CPU bound — and
  is the mirror of the class this branch fixed, not an instance of it.

## Testing summary

**Runner and mode the verdict came from:** `npm test -- --reporter=json`, verdict parsed
from `numFailedTests` in the JSON artefact rather than from a summary line. Note that the
`/work` contract treats vitest as a runner without a trustworthy structured mode; the real
gate here is the load comparison below, not the count.

| | idle | 28 CPU spinners on 24 cores |
|---|---|---|
| baseline `aaf323a` | 4/4 green | **2 of 4 runs failed** — 124 ms and 161 ms against the 100 ms budget, different case each run |
| this branch | green | **3/3 green** at load average 12-23 |

Final full suite: **1342 total, 1335 passed, 0 failed, 7 pre-existing skips, 287 suites.**
`tsc --noEmit` holds at the pre-existing 12 (schema.test.ts 7, post-processor.test.ts 4,
lib.test.ts 1) with **zero in any file this branch touches**.

**Tests added:** `cpu-time.test-fixture.test.ts` — three cases: the CPU reading is real
(positive control), a body returning a value is measured (the other direction of the
promise check, since every live caller returns a string), and a promise-returning body is
refused.

**Teeth verified by probe, each read by name.** `strip-blocks.ts` was backed up with `cp`
and restored byte-identical after every mutation, verified against both the backup and
HEAD.

| Mutation | Expected failure | Observed |
|---|---|---|
| `withinClosableRegion` bound removed | block + beacon floods | 7 cases, 254 ms - 2.8 s CPU |
| `stripHtmlComments` no-closer latch removed | all three comment floods | 40465 ms, 34937 ms, 31114 ms |
| `cpuMs` stubbed to return `0` | the fixture's positive control | fails — **and all 110 strip-blocks cases still pass** |
| `assertMeasuredToCompletion` removed | the promise case, by name | fails |
| ratio divisor forced unresolvable | `"costs the same on a pathological tail…"` | fails: `expected 0 to be greater than 0` |
| `--pool=threads` | every `cpuMs` caller | 25 cases fail with the fixture's message |

**Gap:** the 21 flood cases named under *Known issues* have no per-case teeth measurement.

## Commit history

```
git log --oneline main..HEAD
55030de test(response): measure the ReDoS guards in CPU time, not wall clock
```

A second commit carries the review fixes and this handoff.

## Review context

**Suggested review order:** `cpu-time.test-fixture.ts` first (it is the mechanism), then
its test, then `strip-blocks.test.ts`'s docblock and flood table, then the two declines.

**Surface 2 roster** — `sixees-workflow.local.md`'s six agents plus `learnings-researcher`.
`data-integrity-guardian` is not in this clone's roster and was not dispatched; its lane is
migrations and persistent data, which this diff has no subject in.

**Certification:** this run did not invoke `/sixees-workflow:review`, so no
`Certification:` line was produced. The roster was dispatched directly against a scope
resolved once (`git merge-base --fork-point origin/HEAD HEAD` → `aaf323a`, one commit) and
handed to every reviewer as data. Read the coverage below as what it is: seven reviewers
that returned, and no certification claim.

**`/security-review`:** ran, `reviewer_status: "ok"` read from
`docs/work/.scratch/security-review/013-cpu-clock-20260909/summary.json`,
`findings_count: 0` reconciled against 0 records in `findings.jsonl`. Its own hard
exclusions cover this diff twice — test-only files, and CPU/regex DoS — so the clean pass
is the expected result rather than evidence about the guards.

### Findings and dispositions

| # | Finding | Raised by | Sev | Disposition |
|---|---|---|---|---|
| 1 | `cpuMs` accepts an async body it can only measure a prefix of; the diff's own comment pointed a maintainer at that path | typescript-reviewer, architecture-strategist, security-sentinel | P2 | **fixed** — thenable refused in the helper; the `processor.test.ts` remedy corrected to say `cpuMs` will not do it; both probed |
| 2 | Flood case `"opener flood, one trailing closer"` cannot fail on any regression — 1.1 ms with the bound, 1.2 ms without | security-sentinel | P3 | **fixed** — closer moved inside the flood, which puts the remaining openers past the last closer; 34937 ms under mutation. Per-case mutation figures added to all three |
| 3 | Ratio divisor floored below the clock's resolution, so `0 / floor` passes having measured nothing | typescript-reviewer, security-sentinel | P3 | **fixed** — floor replaced with an assertion that the measurement happened |
| 4 | Budget calibration stated in three places and drifted; one comment asserted the immunity this branch removes, and `ARCHITECTURE.md`'s citation stopped resolving | architecture-strategist | P3 | **fixed** — contradicting comment removed and pointed at the owner; the cited fact restored to the docblock |
| 5 | New fixture omits the boundary note its precedent carries; the `CONVENTIONS.md` → *Naming* row both fixtures cite did not exist | architecture-strategist | P3 | **fixed** — note added, row added |
| 6 | No mechanical guard that a production module imports no `*.test-fixture.ts`; invariant 17's sweep exempts the suffix | architecture-strategist | P3 | **declined-with-evidence** — root is pre-existing and the fix belongs in `file-saver.test.ts`'s invariant-17 sweep, which is out of scope for a clock change. Exposure is latent: `tsup` bundles four entries and no production module imports either fixture. **Put to the director in *Follow-up work*** |
| 7 | 21 flood cases unexamined for the shape finding 2 confirmed | security-sentinel | note | **escalated** — see *Follow-up work*; not a silent decline |
| 8 | `assertOwnProcess` claims more than `isMainThread` verifies | typescript-reviewer (not filed) | note | **answered** — fails closed; docblock now scoped to what it checks |
| 9 | Near-verbatim justification prose in the two declining files | code-simplicity-reviewer, pattern-recognition-specialist (neither filed) | note | **answered** — two instances, each with different site-specific content, below the three-instance floor; no failure mode |

**Reviewer status:** typescript-reviewer `findings`(2) · architecture-strategist
`findings`(3) · security-sentinel `findings`(2) · code-simplicity-reviewer `clean` ·
pattern-recognition-specialist `clean` · learnings-researcher digest (`envelope: none`) ·
security-review-parser `ok`. No reviewer failed.

**The sweep question is closed by an independent pass.**
`pattern-recognition-specialist` derived the class from its definition rather than from my
instances, swept all 39 test files plus `jscpd`, opened every candidate, and confirms the
two remaining wall-clock sites are the complete remainder — no fourth site.

**Fixes are the least-reviewed text on this branch.** Findings 1-5 were all written after
the reviewers read the diff. Each carries its own probe, but nothing has reviewed the fixes
themselves; point the next pass at them rather than back at the original diff.

## Reality Corrections

- **RC-57** — the remedy named two of three sites, and cited a precedent deleted two PRs earlier
- **RC-58** — the acceptance criterion was already satisfied by the unfixed code

Entries are in `LESSONS.md`. No plan file exists for this work — the input was a todo — so
there is no POST-AUDIT annotation to add.

## Follow-up work

- [ ] **Director's call: extend invariant 17's sweep to forbid a production import of
      `*.test-fixture.ts`** (finding 6). A few lines against the existing AST walker in
      `file-saver.test.ts` plus a positive control. Declined here as out of scope; say the
      word and it goes in this branch.
- [ ] **Director's call: probe the remaining 21 flood cases for teeth** (finding 7). One
      probe per cost-bearing mechanism per case. This is `l` effort and its own piece of
      work; it wants a todo rather than this branch.
- [ ] **If this repo gains a Linux CI runner with tick-based CPU accounting**, re-check the
      ratio guard: the divisor assertion will fail loudly there rather than passing
      vacuously, which is intended, but the loop count may need raising until the reading
      resolves.
- [ ] **If either 2 s wall-clock guard starts failing**, the remedy is CPU time, not a
      wider budget. `sanitize.test.ts` additionally needs `cpu-time.test-fixture.ts` moved
      down into `utils/`, since `utils/` is leaf-level.

### Outstanding Todos

_None filed by this run._ Findings 6 and 7 are with the director above; whether either
becomes a todo is their call, not this run's.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/013-P2-redos-budget-guards-fail-under-the-suites-own-parallelism.md` | The ReDoS budget guards fail on every full-suite run, so the suite has no reliable green | All three guard sites measure CPU time through one shared helper; budget unchanged. Acceptance criterion 1 was unusable as written (the unfixed code passes it on an idle machine) and was replaced by a load comparison: baseline 2/4 failing under 28 spinners, this branch 3/3 green. Criterion 2 met by probe at all three sites. Criterion 3 met — an independent sweep confirms the two remaining wall-clock assertions are the complete remainder, and each is justified in place | `/sixees-workflow:work` | 2026-09-09 |
