---
id: 013
title: "The ReDoS budget guards fail on every full-suite run, so the suite has no reliable green"
status: open
severity: P2
tags: [test-infrastructure, pre-existing, flake]
class-id: unchecked-assertion
source: /sixees-workflow:work review round on fix/over-cap-preview-computed-then-discarded (performance-oracle F3, then measured directly)
reviewers: [performance-oracle]
created: 2026-09-06
---

# The ReDoS budget guards fail on every full-suite run

## Problem

`src/lib/response/strip-blocks.test.ts` asserts ReDoS protection with an absolute
wall-clock budget:

```ts
const REDOS_BUDGET_MS = 100;
...
expect(Date.now() - start).toBeLessThan(REDOS_BUDGET_MS);
```

Vitest runs test files in parallel worker threads and this config sets no
`poolOptions`, so these cases run beside every other file — including
`sanitize.test.ts`, which is itself deliberately CPU-heavy. Under that contention
the guards measure the scheduler, not the regex.

## Evidence — measured on both branches, four runs each

**`main` at `5adb7d3`, in a clean worktree:**

```
run 1: passed 1213 failed 2
run 2: passed 1214 failed 1
run 3: passed 1213 failed 2
run 4: passed 1212 failed 3
```

**`fix/over-cap-preview-computed-then-discarded` at `cc69dc2`:**

```
run 1: passed 1248 failed 3
run 2: passed 1250 failed 1
run 3: passed 1249 failed 2
run 4: passed 1250 failed 1
```

Every failure in both sets is a `REDOS_BUDGET_MS` case in `strip-blocks.test.ts`,
and a *different* subset each run. The same file run in isolation passes 3/3
(110/110).

**So this is pre-existing and not introduced by the 008 branch** — the rate and
the failing set are the same on `main`. It is recorded here because it was found
during that branch's review and because it invalidates a claim the project relies
on.

## Why it matters more than a flaky test usually does

**`main` does not currently run green on a full-suite run.** Every "tests pass"
statement made from a full run — in a handoff, a PR body, a merge decision — is
reporting a result the suite cannot actually produce reliably. `compound-engineering-profile.md`
§8 says *"never merge-on-green"*; this is the other half of that problem, where
green is not available to merge on.

It also hides real regressions: a reviewer who sees 1-3 red ReDoS cases on every
run learns to discount them, and a genuine ReDoS regression arrives wearing the
same clothes.

## Why the margin argument does not save it

`performance-oracle` graded these "confirmed, not a defect" on the reasoning that
the budget is 100 ms against work measured at 2881 ms before the fix — a ~29x
margin that scheduler noise cannot cross. That is sound for the *isolated* case
and is why the file passes alone. It does not hold when the case is descheduled
mid-measurement: `Date.now()` keeps counting while the thread is not running, so
the measured figure is unbounded regardless of the margin.

## Fix

Same remedy already applied to `processor.test.ts`'s ratio guard in the 008
branch, and measured there at **0 false failures in 6 runs under 24-spinner load
with detection intact**:

```ts
const started = process.cpuUsage();
// ... work ...
const spent = process.cpuUsage(started);
const ms = (spent.user + spent.system) / 1000;
```

CPU time is the quantity these guards actually mean — the claim is about the
regex's work, not about how busy the host was. Keep `REDOS_BUDGET_MS` at 100 and
keep every case; only the clock changes.

Two sites: `strip-blocks.test.ts:110` and `:400`. Check for the same shape
elsewhere before closing — `rg -n "Date\.now\(\)" src --glob '*.test.ts'`.

## Acceptance criteria

- [ ] Four consecutive `npm test` full-suite runs pass with zero failures.
- [ ] The guards still fail when the ReDoS defect is reintroduced by probe —
      teeth verified, not assumed.
- [ ] No other wall-clock timing assertion remains in the test tree, or each
      remaining one is justified in place.
