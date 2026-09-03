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

---

## Review Comments Addressed — 2026-09-03

Surface 3, round 1. Codex requested (`@codex review`); CodeRabbit had already
posted ten comments unprompted across four waves earlier the same day. One read
after a 15-minute wait returned **14 entries — 13 findings + 1 review summary**.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Backward wall-clock step resets an active quota (`rate-limiter.ts:33`) | @coderabbitai + @chatgpt-codex-connector | Fix needed (P2) | Windows now measure elapsed time on `performance.now()`. The `age < 0` arm is **deleted**, not reinterpreted — both failures it stood between were mirrors of one wrong clock |
| `MAX_TRACKED_KEYS` is not an upper bound (`session.ts:40`) | @coderabbitai + @chatgpt-codex-connector | Fix needed (P3, claim only) | The **comment** claimed a bound it does not have. Corrected to say what the sizing is against and what churn past it costs. Behaviour unchanged — see Declined |
| `headers_unsupported` platform qualifier inverted (`documentation.ts:66`) | @coderabbitai | Fix needed (P2) | Said "(macOS only)" against the state **non**-macOS hosts report. This text is served to the model as an MCP resource |
| `docs/todos/003` Fix section contradicts the section this branch added | @coderabbitai | Documentation | Fix section now marks the `executeCurlRequest` release as intermediate and points at the measurement below it |
| `docs/todos/007` names a section the caveat was not added to | @coderabbitai | Documentation | *Threat Model* → *Business Rules / Invariants*. Verified against `architecture.md` — the caveat is at lines 76, 171 and 330 |
| `docs/todos/011` DAG places 13 of the 16 directories it names | @coderabbitai | Documentation | `session/`, `prompts/` and `resources/` added, each placed from what its imports read today |
| `docs/todos/010` proposed signature drops per-response metadata | @coderabbitai | Fix needed (P2) | `defendChannel(text, channel, hostname)` → `(text, channel, meta)`. `processResponse` passes the origin's `contentType`/`contentTypeUndetermined` (`processor.ts:549-551`) and those select which strip stages run; a channel-only profile would have silently weakened `PERSISTED_BODY` |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Size `MAX_TRACKED_KEYS` for session churn, or add admission control | @chatgpt-codex-connector (**P1**), @coderabbitai (Major) | **P3** (re-derived) | In scope | Re-graded from consequence. The premise is right and the comment now says so. Reaching the cap needs that many distinct hostnames each clearing DNS resolution **and** the SSRF check inside one window — both run *before* `checkRateLimits` (`curl-execute.ts:158-166`) — and the map drains one window later. Bounded refusal, self-healing, no reachable failing case |
| Avoid a full map sweep on every capacity rejection | @chatgpt-codex-connector (**P1**) | **P3** (re-derived) | In scope | Same unreachable precondition, plus the amplification is not what was claimed: **measured at 0.152 ms** for a full sweep of a 30,000-entry live map. Sustaining one core needs ~6,600 over-cap requests/second, each preceded by a successful DNS resolution. Next-expiry tracking would add state to avoid work in a state that is not reached |
| Roll back the client increment when the host limiter throws | @coderabbitai | P2 | In scope | Reopened on the new consequence (self-lockout), not declined by citation. Re-declined on the merits: the proposed fix makes retries against a saturated host **free to the client**, and each retry still costs the server a DNS resolution and an SSRF check before `checkRateLimits` runs. Charging the client for them is the safer direction |
| Bracket IPv6 addresses in `--resolve` | @coderabbitai | P3 | In scope | False positive, and contradicted by the reviewer's own cited evidence. Measured on curl 8.7.1: bare `2001:db8::1` gives `Added example.test:443:2001:db8::1 to DNS cache` → `Trying [2001:db8::1]:443`. A malformed address is rejected with exit 49, so the parse is real |
| Test that a resident label stays throttled after an eviction | @coderabbitai | P3 | In scope (outdated) | The premise is inverted. `setBounded` evicts **first-inserted**, so a label inserted early is the victim, not the survivor — the proposed test asserts the opposite of the documented design. The bystander case is already covered at the shared seam (`bounded-throttle.test.ts`) |

### Decisions Revised

| Original | New approach | Reason | Reviewer |
|---|---|---|---|
| `windowClosed` treats a negative age as closed, to stop a future-stamped entry wedging the cap | Windows measure elapsed time on a monotonic clock; the negative-age arm is gone | The guard fixed one half of a two-sided defect and shipped the other half. Fixing the clock removes both and deletes the special case (K-11) | @coderabbitai, @chatgpt-codex-connector |

### Resolved Todos

None — no `docs/todos/` file claims `pr: "#35"`.

### Outstanding Todos

Unchanged: `docs/todos/006` and `007` remain the branch's stated P1 exposure and
neither is moved by this round.

### Files Modified

`src/lib/security/rate-limiter.ts`, `src/lib/security/rate-limiter.test.ts`,
`src/lib/config/session.ts`, `src/lib/resources/documentation.ts`,
`docs/todos/003`, `007`, `010`, `011`, and this handoff.

**Verification:** 1182 passed / 7 skipped / 0 failed across 35 files (from
1181/7). `tsc --noEmit` unchanged at 12 pre-existing errors in `lib.test.ts`,
`post-processor.test.ts` and `schema.test.ts`. Teeth-probed: restoring
`Date.now()` with the negative-age arm fails both new backward-step cases;
`rate-limiter.ts` restored from a `cp` backup and verified byte-identical by
`shasum`.

**Class trace.** The defect's shape is *a process-lifetime elapsed-time window
measured on the wall clock*. Two siblings exist in this diff and were read:
`detection-logger.ts` and `wrap-error-logger.ts` both compare `Date.now()`
deltas. **Not changed** — a backward step there delays or advances a log memo,
and the map-growth half is already held by `setBounded`'s cap, which evicts
whether or not the expiry sweep frees anything. The consequence is log timing,
not enforcement. Named here so a later round recognises the class rather than
re-reporting it.
