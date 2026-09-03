# Handoff — simplify-pass cleanup, three review rounds

**Branch:** chore/simplify-pass-cleanup-and-todos
**PR:** #35 → main
**Status:** in-review
**Created:** 2026-09-03, *during review* — no handoff existed for this branch, which
every round flagged as a process gap. Nothing here is inferred: it is written from
the four commits and the eighteen reviewer returns that produced them.

## What this branch is

`bc91fc5` applied the fixes a four-lane `/simplify` pass turned up. `8e356ae` filed
the six findings that pass could not fix as `docs/todos/006`–`011`. Then three
rounds of `/sixees-workflow:review` — `fb9ea8f`, `5f35d34`, `59103e3` — each of
which reviewed the round before it.

**Version impact: PATCH.** `buildCurlArgs`, `CurlArgsParams` and `processResponse`
are exported only from `src/lib/execution/index.ts`, which no `package.json`
`exports` entry reaches. Invariant 11 is not engaged. Two reviewers claimed
otherwise in round 1; the direct check settled it and `typescript-reviewer`
confirmed it independently in round 2.

## The one class that mattered

Four of five envelope reviewers found `unbounded-growth` independently in round 1
with the same instance list: five process-lifetime `Map`s, keyed by values the
model or the remote chooses, bounded only by a `setInterval` that a *caller* must
remember to start — and exported entry points exist that never start it.

It closed over three rounds, and each round's fix was the previous round's finding:

| Round | What it did | What the next round found wrong with it |
|---|---|---|
| 1 | Extracted `setBounded`; routed both log throttles through it. Declined `rate-limiter.ts` | The decline ruled out one *policy*, not every policy |
| 2 | Gave the counters a **rejecting** cap; fixed the check order | The cap borrowed a constant sized for a different subsystem, and the tests never reached it |
| 3 | Derived the counters' own ceiling; guarded the clock; rebuilt the fixture | — |

All five maps are now bounded at the write. `security-sentinel` re-swept in round 3
(21 candidates, 5 request-keyed collections, all opened) and confirms none remains.

## Key decisions

| Decision | Why |
|---|---|
| Two policies, not one seam | A log throttle **evicts** (losing a memo costs one stderr line); a counter **rejects** (evicting one resets it, bypassing the limit). Unifying them would need a policy flag — one function doing two things. `code-simplicity-reviewer` and `typescript-reviewer` both endorsed the split in round 3 |
| `RATE_LIMIT.MAX_TRACKED_KEYS` derived, not chosen | `SESSION.MAX_SESSIONS × MAX_PER_CLIENT_PER_MINUTE` is the most cardinality legitimate load can produce in one window, so the ceiling cannot refuse a caller inside their own quota — and it cannot go stale if either input moves |
| Client gate before host gate | The write happens before either throw, so whichever map is checked first takes a key for requests the other rejects. Hostnames are model-chosen and unbounded; client ids are server-generated and bounded |
| Kept eviction for the log throttles | See RC-19. Declined with evidence, and its author confirmed the decline |

## What to pay attention to during review

- **`normalizeLabel` was invisible to `rg`.** A raw NUL in its character class made
  git and ripgrep classify `wrap-error-logger.ts` as binary, so every sweep of
  `src/` silently skipped it — including the sweeps used to audit this class.
  Rewritten with `\u` escapes, verified identical across U+0000..U+2FFF. **If you
  add a control character to a source file, you blind every future review of it.**
- The rate limiter had **no test file** before `5f35d34`.
- `docs/architecture/architecture.md` is npm-published and claimed the `--resolve`
  pin "defeats DNS rebinding" without qualification. It now states the first-hop
  limit in all three places it appeared.

## Known issues and limitations

- **`docs/todos/006` and `007` are the real security exposure here, both P1, both
  untouched.** 006: the shipped binary registers tools without the defence wrap.
  007: SSRF validation covers hop 1 only, so a hostile origin's
  `302 Location: http://169.254.169.254/...` is still followed unchecked.
  **Merging this branch does not move either.**
- `runStdio`/`runHttp` still never call `startWrapErrorCleanup`, and
  `initializeLifecycle` has no slot for it. The write-site cap makes this
  survivable rather than fatal, and the comment says so instead of claiming the
  interval protects anything.
- `lastDetectedMap` mixes hostname and `jq_query` basename key spaces under one
  budget; `jq_query` is not rate-limited. Declined out of scope (both producers
  are outside the diff) and its author graded it marginal.

## Testing summary

1181 passed / 7 skipped / 0 failed, 35 files (from 1166 / 33 at the base).
`tsc --noEmit` unchanged at 12 pre-existing errors, all in test files this branch
does not touch.

**Teeth-probed, each restored from a `cp` backup and verified byte-identical:**
removing the `setBounded` cap fails 4 helper cases and both boundary cases;
sourcing `dnsResolve` from anything but `dnsResult` fails the producer assertion
(and, before it existed, failed *nothing*); reject→evict fails two rate-limiter
cases; dropping the negative-age clock guard fails a third; evict-then-prune fails
the ordering case.

**Test gaps:** the `checkRateLimits` mirror — a request the *host* gate rejects has
already taken a client key — is accepted and unasserted. `security-sentinel` judged
it not a finding (it raises no attacker capability) but worth one assertion.

## Divergences

**RC-19** — *Bounding a map and sizing the bound are two decisions, and only the
first got reviewed.* Filed in `LESSONS.md`. Round 1's decline on the rate limiter
was reopened by round 2 on the route RC-10 sanctions; round 2 then chose the right
policy and the wrong constant, which round 3 measured. It also records the declined
eviction→drop proposal so a later round cites it rather than re-litigating.

## Roster closure

**`unowned`** for every round. Three roster members defer *duplication across
files* to `pattern-recognition-specialist` and three defer *boundaries and
layering* to `architecture-strategist`; neither is in `review_agents` nor on the
floor. This was not theoretical — reviewers routed findings to both across all
three rounds, and those findings reached no reviewer. Adding them is the operator's
call, not the review's.
