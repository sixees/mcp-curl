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
  It is verified by running the suite under `--pool=threads`, where every case calling
  `cpuMs` fails with the fixture's message — **29 cases** at the end of Surface 2, measured;
  the count moves whenever a case is added, so `cpu-time.test-fixture.test.ts`'s docblock
  owns it. Re-run that if the check is touched.
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

- **CLOSED — the 21 flood cases were probed.** This bullet described the state before the
  addendum; the result is in *The full teeth matrix* below and the accounting is corrected
  in the review record at the end of this file. Read those, not this. Left in place so the
  ordering stays legible: it was the largest thing the branch left open, the director
  called it, and it was done here rather than deferred.
- **The `*.test-fixture.ts` boundary is a filename with no import guard.**
  `file-saver.test.ts::productionFiles` exempts the suffix by name, so a write binding
  placed in a fixture and imported from production would satisfy invariant 17's sweep. This
  branch doubles the exempt set from one file to two. The rule is now written
  (`CONVENTIONS.md` → *Naming*) and the new fixture carries the boundary note, but nothing
  mechanical enforces it. **CLOSED — no longer declined:** the director's call sent it into
  this branch, and `file-saver.test.ts` now carries a *nothing in production imports a
  test-only module* sweep. See the addendum and the review record.
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

Final full suite **as of this section's writing: 1342 total, 1335 passed, 0 failed, 7
pre-existing skips, 287 suites** — superseded twice since, by the addendum's own work and
then by the Surface-2 review. The current figure is in the review record at the end of this
file; that is authoritative and this is the state at the first commit.
`tsc --noEmit` holds at the pre-existing 12 (schema.test.ts 7, post-processor.test.ts 4,
lib.test.ts 1) with **zero in any file this branch touches**.

**Tests added:** `cpu-time.test-fixture.test.ts` — **four** cases after Surface 2 (three at
first commit, plus the two-clock case the review added): the CPU reading is real
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
| `--pool=threads` | every `cpuMs` caller | 29 cases fail with the fixture's message |

**Gap:** the 21 flood cases named under *Known issues* have no per-case teeth measurement.

## Commit history

```
git log --oneline main..HEAD
55030de test(response): measure the ReDoS guards in CPU time, not wall clock
2c0bc76 test(response): close two toothless guards Surface 2 found in the clock change
650a5d6 test(response): re-measure the budget's calibration, and enforce the fixture boundary
45ae2a9 docs(lessons): record the budget decision as binding
```

Four commits at the time of the Surface-2 review; that review's fixes add to them.

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
instances, swept all 39 test files plus `jscpd` (40 existed at the merge-base and 41 after this
branch, so the count was one short as written), opened every candidate, and confirms the
two remaining wall-clock sites are the complete remainder — no fourth site.

**Fixes are the least-reviewed text on this branch.** Findings 1-5 were all written after
the reviewers read the diff. Each carries its own probe, but nothing has reviewed the fixes
themselves; point the next pass at them rather than back at the original diff.

## Reality Corrections

- **RC-57** — the remedy named two of three sites, and cited a precedent deleted two PRs earlier
- **RC-58** — the acceptance criterion was already satisfied by the unfixed code
- **RC-59** — the budget's calibration was measured on two mechanisms of four, and its own figures came from a mis-sorted probe
- **RC-60** — the run that wrote "derive the mechanism list from the subject" then shipped a list derived from the guard

Entries are in `LESSONS.md`. No plan file exists for this work — the input was a todo — so
there is no POST-AUDIT annotation to add.

## Follow-up work

- [x] **Extend invariant 17's sweep to forbid a production import of
      `*.test-fixture.ts`** (finding 6) — **done in this branch**, director's call. The
      Surface-2 review then found the sweep enumerates call targets; see the review record.
- [x] **Probe the remaining flood cases for teeth** (finding 7) — **done in this branch**,
      director's call. The Surface-2 review found the mechanism list one short; the
      corrected accounting is in the review record.
- [ ] **Director's call: convert the strip budgets to a RATIO, keeping 100 ms as the derived
      value.** Surface 2 measured this and it is **`s`-to-`m`, not `l`** — the premise that
      made it `l` was per-case conversion, which is not needed. One baseline measured once per
      file with `REDOS_BUDGET_MS` derived from it leaves all 24 assertion lines unchanged and
      rescales the whole matrix rather than re-measuring it. Teeth improve: HEAD ratio 0.44
      against 11.72 with `noGt` removed is a **26x** separation, where the absolute budget has
      a 2.1x window. The real caveat is denominator noise — a benign 256 KB baseline spread
      1.9x against floods at 1.03x — so a stable denominator is the `m` part, and a ratio
      catches an exponent change rather than a constant-factor one. **RC-59's settled 100 ms
      is not reopened by this**; the value survives as the derived target.
- [ ] **Director's call: commit the mutation matrix as a runnable artefact.** Declined once at
      effort `m`, and the count has since been wrong in three consecutive rounds for the same
      reason: a hand-re-derived probe cannot be a positive control on itself. `LESSONS.md`
      RC-60 rule 4 records the argument; the counter-argument is that it is test scaffolding
      for a single-operator tool and the annotations now carry their subsets.
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

---

## Addendum — `performance-oracle`'s return, and the director's two scope calls

`performance-oracle` returned 21 minutes after the other reviewers, having **measured
rather than read**. Its three findings are all about figures this branch wrote, and two of
them invalidate the calibration the first commit recorded. Everything below was
re-measured independently before being written down.

### The calibration was wrong in two independent ways (RC-59)

| Recorded in the first commit | Measured |
|---|---|
| passing population 0.15 – 10 ms | **0.11 – 22 ms** idle; ~30 ms through the suite; **~53 ms beside 72 CPU hogs** |
| weakest regression 254 ms (2.5x above budget) | `opener flood behind a leading >`, `noGt` latch — **figure owned by `strip-blocks.test.ts::REDOS_BUDGET_MS`**, since it has moved three times (254 → 117 median → 112 floor) and a copy here is the one nobody re-reads |
| `processResponse` 1 MB case ~100 ms, margin 20x | **17 ms**, margin ~117x |
| `detectInjectionPattern` 1 MB ~270 ms, margin 7x | **48-53 ms**, margin ~40x |

Two causes, both mine. The population figures came from a probe sorted with
`sort -t' ' -k2 -g` over `AssertionError: expected N to be less than M` — field 2 is the
word `expected`, so the sort did nothing and the extremes were arbitrary; the 254 ms was
the vitest *duration column* rather than the CPU figure. And only two of at least four
cost-bearing mechanisms were probed; the two missed carry the weakest regressions.

**The consequence was not cosmetic.** The docblock concluded there was 2.5x of room below
the weakest regression, which licensed widening the budget to ~120 ms — and at that value
the guard passes with `stripTagTokens`'s `noGt` latch deleted and the tag strip quadratic
on any `>`-free flood. The sentence written to prevent a toothless guard authorised one.

The two wall-clock margins were taken from pre-existing prose in those files and never
re-measured. That prose was itself stale; both figures are now measured at HEAD and say so.

### The full teeth matrix, 24 cases × 5 mechanisms

Measured on esbuild bundles under the scratchpad — the repository source was never
mutated for this. **Superseded by the Surface-2 review.** This said "18 of 24 have a
mutation above the budget; 6 do not, and a seventh regresses only to 97 ms" — which totals
25 cases of 24, and the double-count concealed a miscount. The mechanism list was also one
short. Corrected twice since: `closer flood with no >` is the sole detector of a sixth
mechanism at 5.0-7.2 s, and `openers nested inside the bounding closer` of a PAIRED mutation
at 3.9 s that no single-mechanism probe can see. **The count is owned by
`strip-blocks.test.ts::REDOS_BUDGET_MS` and `LESSONS.md` RC-60 — read it there, not here**,
per `.claude/rules/03-divergence.md`: a figure restated in a document that is read once and
archived is the copy that rots. Every case carries its figure inline.

Also recorded, because no single-mutation probe can show it: **5 of the 6 beacon inputs
contain no `)` at all**, so `lastCloserEnd` is 0, `withinClosableRegion` returns at
`end <= 0`, and no pattern runs. They cost 0.11-0.15 ms because they measure an early
return, and two of them need the region bound *and* the label class broken together before
anything regresses.

### The director's two calls, both executed

- **Finding 6 — invariant 17's fixture exemption: fixed in this branch.**
  `productionFiles` and `srcRoot` are hoisted to module scope so one walk serves both
  sweeps — a second copy would let the two disagree about what "production" means, silently
  narrowing one of them. A new `describe("nothing in production imports a test-only
  module")` adds `moduleSpecifiers` (fails closed on any specifier it cannot read) and 11
  positive plus 3 negative cases. Type-only imports are **not** exempt here, unlike in the
  `fs` sweep, because the remedy differs: a type imported from a fixture can simply be
  moved. Probed by making `processor.ts` import the fixture — the sweep reported
  `lib/response/processor.ts (./cpu-time.test-fixture.js)` and failed; source restored
  identical to HEAD. `forbiddenFsBindings` was deliberately not refactored to share the
  traversal: it reads bindings where this reads specifiers, and it is the most-reviewed
  code in the file.
- **Finding 7 — the 21 unexamined flood cases: probed in this branch.** Result is the
  matrix above.

### Settled by the director, not open

**The budget's value is now a live question.** The usable window is ~53 – 112 ms and 100 ms
sits near the top of it. That leaves the five marked cases unable to fail, and only ~1.9x
between the slowest loaded pass and the threshold. The todo settled "keep the budget at
100" on the premise that the margin was 50x above passing and 2.5x below regressing; both
halves of that premise are refuted. Lowering toward ~75 ms would sit more centrally and
give `closer flood with no >` teeth at 97 ms, at the cost of pass headroom. **Put back to the director on the real figures and answered on
2026-09-10: 100 ms stays, documented as measured.** `LESSONS.md` RC-59 carries that as a
binding record — a later round proposing ~75 ms or a per-subject split is answered by citing
it, and what reopens it is new measurement rather than a new argument.

### Round-2 reviewer note

`performance-oracle` read the committed diff while this session held uncommitted fixes in
the tree, and said so explicitly (K-9). It confirmed two of its would-be findings were
already closed there and did not file them. It also confirmed the change's premise by
measurement: under 72 spinners the slowest flood read **177 ms wall against 53 ms CPU**, so
a wall-clock budget of 100 ms would have failed it while CPU time did not — and it could
not defeat CPU time on this subject, `strip-blocks.ts` being wholly synchronous with no
`await`, `Worker`, `spawn` or timer in the measured region.

**These fixes are again the least-reviewed text on the branch** (K-16). Nothing has
reviewed the addendum's own changes; point the next pass at them.

---

## Review record — 2026-09-10

**This is the section the pointers above name.** Where an earlier section is marked
superseded, the authoritative figure is here or in the owner it cites — never in both.

**Certification:** complete — all 16 dispatches returned; one optional reviewer
(`pattern-recognition-specialist`) declared its own lens set rather than the two
`class-id` lenses in `skill: review-findings` → *Lenses*, in both rounds. It is not a
floor member, so this is a coverage note and not a withheld certification.

**Roster closure:** closed — the effective roster is `sixees-workflow.local.md`'s six plus
the four-agent floor, deduped to eight; every deferral edge found in the agent files lands
inside it. `unresolved: pattern-recognition-specialist → "The correctness of any single
instance → whichever reviewer owns that lane"` — a refusal naming no peer, so it can be
neither subtracted nor confirmed.

**Surfaces run:** Surface 2 only, twice. **Surface 3
(`/sixees-workflow:review-pr-comments`) has NOT run** — no bot has reviewed #41.

### Rounds and reviewers

| | Round 1 (on `55030de`..`45ae2a9`) | Round 2 (on `111fe8c`) |
|---|---|---|
| typescript-reviewer | findings (3) | findings (2) |
| security-sentinel | findings (4) | findings (3) |
| performance-oracle | findings (3) | findings (2) |
| architecture-strategist | findings (2) | findings (2) |
| data-integrity-guardian | clean | findings (2) |
| code-simplicity-reviewer | clean | findings (1) |
| pattern-recognition-specialist | clean | findings (1) |
| learnings-researcher | digest (`envelope: none`) | digest |

No reviewer failed, and none returned `partial` or `not-applicable`. Round 2 was pointed at
round 1's fix commit rather than back at the original diff (K-16), which is where it found
five of its eleven findings.

### The three false greens round 1 found, all in the branch's own centrepiece

| Defect | Measured | Fixed by |
|---|---|---|
| `cpuMs`'s controls never anchored the reading's **scale** — divisor `1000 → 1_000_000` | **131/131 cases green**; every budget unfailable by any regression under 100 s | an absolute CPU floor, `> 0.5` |
| Nothing distinguished CPU time from wall clock — `process.cpuUsage()` → `Date.now()` | whole suite green; the flakiness the branch removes, returning silently | an `Atomics.wait` case, 55 ms wall / 0.06 ms CPU |
| `closer flood with no >` marked `NO TEETH` while being the sole detector of a sixth mechanism | **5,006 ms** (`lastTagCloserEnd`'s attribute walk); every other case under 32 ms | re-annotated with the mechanism and its figure |

### The teeth accounting was wrong in three consecutive rounds, for one reason

The count went **seven → six → five → four** without-teeth, and each correction had the same
cause: the mechanism list was re-derived by hand and was narrower than the subject each time,
in a different place.

| Round | List used | What it missed |
|---|---|---|
| 1 | two mechanisms | four more, carrying the weakest regressions |
| 2 | five mechanisms | `lastTagCloserEnd`'s attribute walk — 5.0-7.2 s, one detector, marked toothless |
| 3 | seven, but **singletons only** | pairs. `openers nested inside the bounding closer` is under 6 ms under either the walk or the widened opener class and **3.9 s under both** |

**One round "positively verified" the 19/5 count by probing singletons** — its instrument
could not see what it reported absent (K-18), and it said so in scope. Two reviewers reached
different counts in the same round for exactly that reason. Final, verified twice
independently: **24 cases, 20 with teeth, 4 without.** A seventh mechanism
(`lastTagCloserEnd`'s `\b` word-char check, 875-899 ms) is detected only by `non-boundary
closer name` and had appeared in no list at all. `LESSONS.md` RC-60 rule 4.

### Verified claims

| Claim | Verdict |
|---|---|
| suite green | **1363 total, 1356 passed, 0 failed, 7 pre-existing skips, 288 suites** — from `numFailedTests` in a JSON artefact |
| `tsc --noEmit` at the pre-existing 12, none in touched files | holds — schema.test.ts 7, post-processor.test.ts 4, lib.test.ts 1; **0** in all 8 touched `.ts` files, matched by exact path |
| no lint gate | confirmed — there is no `lint` or `typecheck` script; the gate is `npm test` plus a manual `tsc` |
| pool precondition fails closed | **29 cases** fail under `--pool=threads` with the fixture's message |
| the fixture cannot reach npm | holds — `tsup` bundles four named entries, `files` ships `dist` plus named docs |
| `ARCHITECTURE.md` invariant 15's citation of `REDOS_BUDGET_MS` resolves | holds at HEAD |
| the 1 MB `processor.test.ts` guard bounds the patterns | **FALSE** — it passes with `stripBlocksFixedPoint` throwing on entry; it bounds the cap, and now says so |
| "Tests added: three cases" | was **four**; corrected |
| "swept all 39 test files" | 40 at the merge-base, 41 after; corrected |
| the handoff's own suite total and commit log | both stale; corrected, and the count is now owned here |

### Handoff assessment

**Unusually honest about its own gaps, and materially wrong about its own state.** It
surfaced the toothless-guard class, the load-harness gap and the unexamined flood cases
proactively — that is the behaviour to reinforce, and two of those became this review's
largest findings. But three sections contradicted each other about whether two pieces of work
were done, the "largest thing this branch leaves open" described work already completed, and
the commit log listed one of four commits. Round 1's fixes then introduced a **second**
generation of the same defect: six pointers to a "review record" section that did not exist,
and figures corrected at one site and left standing at five others. The class is
`stale-observation`/`stale-comment`, it matches RC-18 in prior art, and it is now recorded as
RC-60 rules 2 and 4.

### Dispositions

**Fixed (14 classes)**: the three false greens; the vacuous 1 MB guard's comment; the
handoff's self-contradictions; the calibration miscount and misattributed slowest case; the
`ImportTypeNode` and `import x = require()` blind spots in **both** AST sweeps; the two
sweeps' divergent boundary spellings, now one shared `TEST_ONLY` predicate; the abandoned
promise; the overstated layering citation; the fixture boundary's uncited enforcement; the
misattributed load mechanism (V8 background threads, not memory bandwidth); the scale
control's own wall-clock dependence; the inverted floor-versus-median rationale.

**Declined with evidence (2)**: widening the AST sweeps to `createRequire`, `module.require`
and aliased `require` — population is one operator acting deliberately, and the limit is now
stated at the guard and cited from all four documents that assert the rule. And
`processor.test.ts::savedFilepath` not registering artefacts for cleanup — out of diff, and
the artefacts land in an OS-reaped temp directory.

**With the director (2)**: the ratio-form conversion of the budget guards, and committing the
mutation matrix as a runnable artefact. Both are recorded under *Follow-up work*.

**Blockers: none.** No P1 was found in either round.
