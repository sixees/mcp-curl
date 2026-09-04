# Work Handoff: Stop multiplexing headers and body onto one stream

**Date:** 2026-09-03 | **Branch:** `fix/header-channel-structural-split` | **Plan:** `docs/todos/002-header-channel-should-not-be-multiplexed.md` (resolved, removed) | **Status:** complete — pending push authorisation | **Review rounds:** 2

## Summary

`curl -i` writes the response header block and the body to one stream, and three
successive attempts to recover the boundary arithmetically each failed in a new
way. This replaces the arithmetic with a second stream: cURL writes headers to a
dedicated file descriptor via `--dump-header /dev/fd/3`, the Node parent opens a
fourth stdio pipe, and the split becomes structural. There is no boundary left
to infer, so nothing a hostile origin sends can move it.

The mechanism is **macOS-only** and that is a deliberate, operator-ratified
constraint — see RC-18, which records that the first version of this work
claimed Linux support from a macOS-only measurement.

## What was implemented

**The descriptor (`src/lib/execution/`).** `command-executor.ts` gained
`HEADER_DUMP_FD` / `HEADER_DUMP_PATH`, `platformSupportsHeaderDump()`,
`CommandResult.headerBytes` and `CommandResult.headerBytesReceived`, and a
conditional fourth stdio pipe drained at attach. Whether to open it is read off
the argv — `--dump-header` must be present *and* the path following it must be
`HEADER_DUMP_PATH` — so no caller has to agree with `buildCurlArgs` about it, and
a request body of `/dev/fd/3` cannot open the descriptor by appearing in argv. `curl-args-builder.ts` pushes `--dump-header` in place
of `-i` and no longer emits `%{size_header}`.

**The deletions (`src/lib/response/`).** `splitResponseHeaders`,
`SplitResponse`, `ParsedResponse.headerBytes`, `ParsedResponse.bodyBytes`, the
header-terminator precondition and the `%{size_header}` parse are all gone.
`parser.ts` went 244 → 143 lines. `header-channel.ts` takes header octets
directly and splits nothing.

**The refusal that is no longer needed.** `executeCurlRequest` used to refuse
`save_to_file` and `jq_filter` when the boundary was undetermined, because the
body might still carry the header block. stdout is body-only on every path now,
so the refusal is deleted and both operations work unconditionally.

**Reuse.** Two near-copies of the memory-accounting guard in `executeCommand`
became one `accountFor` before the header stream made a third — and the
consolidation closed a latent bug the copies hid: the stderr copy did not
`return` after rejecting on the size ceiling and continued into the append.
Separately, `formatter.ts`'s two metadata branches were near-copies of the
header-field emission and drifted the moment a field was added; they are one
`applyHeaderFields` now.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Inherited fd 3, not the temp file the todo prescribed | The todo named its own cleanup lifecycle as the risk and the reason it had been deferred once. A pipe has no cleanup path at all — the kernel reclaims it on exit, timeout and kill — and headers never transit the filesystem | Temp file (portable, but reinstates the lifecycle and puts `Set-Cookie` on disk); `%{header_json}` on the existing `-w` channel |
| Accept macOS-only rather than redesign | Operator ruling: this deployment is macOS-only, permanently. See RC-18 | Temp file for portability; a runtime probe; `%{header_json}` |
| Guard the flag rather than let cURL fail | Without the guard an unsupported host loses the **body** too, for a feature the caller merely asked to include | Let it fail loudly; document only |
| Derive capture from argv | Rung 1 of the escalation ladder: push the invariant inside the shared function so no caller can get it wrong | Normalise with `Boolean()` and pass one value to both sites — closes the truthiness gap but leaves two sites free to drift again |
| Bound retention, keep the count separate | A redirect chain was measured putting 2.5 MB on the descriptor against a 64 KB usable ceiling. Retention and counting answer different questions | No cap (what the first commit did, on reasoning that was wrong); cap both (would make the notice report our own limit back as the origin's) |
| Charge only retained bytes to the memory ceiling | Charging discarded ones aborts a request whose body is fine, with an error naming a response size the response never had | Charge everything — preserves prior abort behaviour, worse for availability |
| Report `bytesReturned`, not the ceiling constant | Two ceilings can fire; naming the wrong one produced `truncated at 64000 of 5000 bytes`, which reads as no truncation. A count of what was returned cannot contradict a count of what arrived | Report the ceiling that fired — equivalent, but a returned-count is self-evidently consistent |
| Delete `bodyBytes` | Zero production consumers and zero tests after this change, with a docblock reading "must use these octets" — a guarantee that looks in force | Wire it through to `save_to_file` (the real fix for the lossy-decode issue, but out of scope) |

## What to pay attention to during review

- **`platformSupportsHeaderDump()` is untestable on this machine except by
  stubbing `process.platform`.** Its whole purpose is behaviour on a platform we
  cannot run, so stubbing is the only thing giving it teeth: the guard's own
  branches in `curl-args-builder.test.ts`, and the `headers_unsupported` result
  in `curl-execute.headers.test.ts`. Verified: removing the guard fails both.
- **`command-executor.test.ts` spawns real cURL against a loopback socket.** It
  is the only such suite in the repo. Its cURL timeout is deliberately below
  vitest's default `testTimeout`, or a genuine hang would fail on the runner's
  clock before the abort path fired.
- **The `instanceof Readable` else-arm has never been observed to fire.** It
  exists because a cast's wrong arm attaches a handler that never fires, leaving
  the descriptor undrained — surfacing as a 30-second timeout blamed on the
  origin.
- **`accountFor` was verified equivalent to the two handlers it replaced**, but
  by reading, not by differential test.

## Known issues and limitations

- **macOS-only.** Elsewhere `include_headers` reports `headers_unsupported` — a
  fact about the host, distinct from the origin having sent no header block. The
  package is published to npm, so a non-mac consumer can install it.
- **No CI exists.** There is no `.github/workflows/` in this repository, which
  is why the platform error survived to review rather than being caught.
- **cURL stderr is returned inline to the model with no size ceiling** —
  measured at 6.2 MB in one request, against `ARCHITECTURE.md` invariant 14.
  Pre-existing and declined as out of scope; see below.
- **`save_to_file` writes a lossy UTF-8 decode.** A `charset=iso-8859-1` body
  containing `0xA3` is persisted as `EF BF BD`. Pre-existing; `bodyBytes` was
  the field that could have fixed it and it was dead, so it was removed rather
  than left looking like a guarantee.
- **Response headers reach the model verbatim, `Set-Cookie` included.** Judged a
  decline by the reviewer that raised it — a tool that silently withholds
  headers is lying about what the origin sent. Documented on the tool
  description in `curl-execute.ts`.

## Testing summary

`npm test -- --reporter=json`, verdict parsed from the artefact, not a summary
line. Final: **33/33 files, 1173 tests, 1166 passed, 0 failed, 7 skipped.**
Baseline before this work was 1152 passing.

Note the workflow's standing caveat that vitest is not on its list of trusted
structured reporters; the counts above are structural fields from the JSON
artefact rather than parsed console output.

`npx tsc --noEmit`: 12 errors, all pre-existing, all in three test files this
branch does not touch (`lib.test.ts`, `post-processor.test.ts`,
`schema.test.ts`). The build is `tsup` and does not run them. Unchanged from
baseline.

**Guards teeth-checked** — each mutated, confirmed failing, restored via `cp` in
the same turn: `--dump-header` in `buildCurlArgs`; `captureHeaders` wiring; the
header-stream drain; the `exitCode` gate on the reassurance; the retention
bound; the platform guard.

**Gaps, stated rather than assumed:**

- **The header acceptance ceiling is untested.** It trips at
  `LIMITS.MAX_RESPONSE_SIZE` (10 MB), but cURL caps its own header read near
  300 KB per transfer, so reaching it needs roughly 35 redirect hops. The
  fixture was judged too expensive for the value. The guard is defence in depth
  against a redirect-chain flood; the retention bound beside it *is* tested.
- **No Linux execution of anything**, by construction.
- `sanitizeErrorMessage` has no test anywhere (pre-existing).
- `accountFor` equivalence with the two handlers it replaced is read, not
  differentially tested.
- `header-channel.ts`'s own input cap is now unreachable through `curl_execute`,
  because the executor bounds retention at the same constant first. Retained as
  defence in depth for a direct caller of the exported function, but no
  production path exercises it.

## Commit history

```
feadd0d fix(response): give response headers their own descriptor
797be82 fix(response): honest degraded paths, bounded header retention, one capture decision
bcd831d fix(response): bound header acceptance, and stop inventing ratios across a transform
```

**Each commit fixes defects the previous one introduced.** That is the shape of
this branch and it is worth reading in order: `feadd0d` moved the precondition,
`797be82` fixed two P1s it created, and `bcd831d` fixed two defects `797be82`
created. Every round was caught by review, none by the suite.

## Review context

Suggested order: `command-executor.ts` (the mechanism), then
`curl-args-builder.ts`, then `header-channel.ts` / `formatter.ts` (reporting),
then `curl-execute.ts` (wiring). `ARCHITECTURE.md` invariant 13 is restated and
is the thing to check the code against.

**Round 1 — Surface 2, 6 dispatched, 6 returned, 0 failed.** 2 P1, 5 P2, 4 P3.
Both P1s were introduced by `feadd0d`; both fixed in `797be82`.

**Round 2 — the two P1 finders re-run against `feadd0d..797be82`.** Both
confirmed their prior findings closed, and both found new defects in the fixes:

- **`accountFor` bypass (P2).** The retention bound returned before the
  accounting, removing the acceptance ceiling entirely. Fixed in `bcd831d`.
- **The truncation ratio reproduced its own defect (P2).** `bytesReceived` in
  raw octets against `bytesReturned` in defended bytes; measured `1000 of 722`.
  The round-1 test could not see it — its fixture used padding no strip pattern
  matches (K-1). Fixed, with a fixture that actually exercises defence growth.
- **The unsupported-host path reported origin behaviour (P2).** Fixed.
- **The argv derivation was forgeable (P3).** Fixed.
- Two P3 stale-prose items and the `Set-Cookie` disclosure: fixed.

**Roster closure: `unowned`.** The configured roster in `sixees-workflow.local.md`
omits `pattern-recognition-specialist` (duplication) and `architecture-strategist`
(boundaries and layering); three reviewers defer lanes to them. Both gaps are
live here — this change performs a DRY extraction and restates invariant 13, and
`typescript-reviewer` explicitly deferred *"`curl-args-builder.ts` importing
`HEADER_DUMP_PATH` from `command-executor.ts` inverts the dependency direction"*
to the missing architecture reviewer. Not auto-added: a narrowed roster is the
operator's decision.

## Reality Corrections

**RC-17 — Three correct fixes in a row, because the layer could not answer the question.**
Filed in `LESSONS.md`. The todo prescribed `--dump-header <tempfile>` and named
the cleanup lifecycle as the reason it had been deferred; an inherited descriptor
removes that lifecycle rather than getting it right. The todo's instance list was
also a third of the real one — "6 non-test hits → 3 confirmed instances" against
17 hits across 5 files, missing `header-channel.ts`, which was created in the
todo's own source PR.

**RC-18 — The measurement was real; its scope was assumed.**
Filed in `LESSONS.md`. RC-17 said "measured before committing to it" and
`ARCHITECTURE.md` said `/dev/fd/N` works "on macOS and Linux". The measurement
was macOS-only and the Linux claim is false: libuv backs the extra stdio slot
with `socketpair(2)`, and Linux cannot reopen a socket through `/proc/self/fd`.
Found by two independent reviewers before merge.

**No POST-AUDIT annotation was added to the plan**, because the plan is the todo
and this run consumes it — the annotation would be deleted with the file. Both
RCs are in `LESSONS.md`, which is the durable record.

## Follow-up work

- [ ] Push and open a PR (needs authorisation).
- [ ] **`dist/` is dirty and was not staged.** `npm run build` regenerated it
      with new hash-named chunks; it is tracked in this repo. No restore command
      was run — `skill: pr-resolver-safety` bans `git checkout`/`restore`/`clean`
      outright, so this is the operator's to resolve.
- [ ] Decide on a CI workflow. There is none, which is why the platform error
      reached review.
- [ ] Consider whether the roster should regain `architecture-strategist` and
      `pattern-recognition-specialist`.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/003-P2-memory-ceiling-released-before-peak.md` | P2 | pre-existing backlog | earlier review |
| `docs/todos/004-P2-entity-decode-serves-two-channels.md` | P2 | pre-existing backlog | earlier review |
| `docs/todos/005-P1-bracketed-label-defeats-beacon-strip.md` | P1 | pre-existing; carries its own written "leave open, do not schedule" | earlier review |

**This run created no todos.** Two P2s were held by their reviewer rather than
re-graded upward, with an explicit note that by consequence alone they read as
P1 — the lossy `save_to_file` decode, and the unsupported-host reporting as it
affects a Linux consumer of the published npm package rather than this
deployment. Both are the dispositioner's call; the macOS-only ruling covers the
deployment, not the package's consumers.

Declined findings, recorded here rather than filed:
cURL stderr returned inline with no ceiling (P2, pre-existing, invariant 14,
measured 6.2 MB); `formatResponse`'s anonymous `headerInfo` bag (P3, signature
identical at base); `Set-Cookie` forwarded verbatim (P3, declined by the reviewer
that raised it, but undocumented); `processor.ts`'s stale citation of
`parser.ts::headerBytesReceived` (P3, outside the changed set).

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/002-header-channel-should-not-be-multiplexed.md` | Stop multiplexing headers and body onto one stream | Replaced `curl -i` with `--dump-header` on a dedicated descriptor; retired the byte arithmetic, `%{size_header}`, the lossy-decode hazard, the trailer ambiguity, the terminator precondition and the save/jq refusal | `/sixees-workflow:work` | 2026-09-03 |

---

## Review Comments Addressed — 2026-09-03 (Surface 3, round 1)

Bots engaged: **Codex** (scoped trigger), **Copilot** (reviewer request; off this
command's roster, engaged on explicit operator instruction), **CodeRabbit** (its 8
comments predated the round and were triaged with it). 12 comments → 7 classes.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| New tests assume `process.platform === "darwin"` | codex (P1), copilot, coderabbit ×3 — **one class, five comments** | Fix needed | Real-cURL descriptor tests gated with `itOnDarwin` (`it.skipIf`); the two that never open the descriptor left ungated. Mocked suites in `curl-execute.headers.test.ts` pinned to `darwin` by a module-level `beforeEach`, its near-copy helper in the unsupported-host suite deleted. `curl-args-builder.test.ts`'s platform helper hoisted out of the nested describe so the supported-path tests pin too |
| Handoff describes `args.includes(HEADER_DUMP_PATH)` | copilot | Documentation | Corrected to the shipped derivation — `--dump-header` present *and* the following path equal to `HEADER_DUMP_PATH`. The handoff described the form the P3 fix replaced |
| CHANGELOG claims exits 23/35/56/63 produce empty bodies | coderabbit | Fix needed | False: cURL writes what it has received before it fails. Rewritten to state the observed regression, and the clean-exit gate re-justified on the *correct* grounds — a non-zero exit says nothing about completeness |
| Three stale handoff claims | coderabbit | Documentation | (a) the builder stub is not the only platform-guard coverage — `curl-execute.headers.test.ts` stubs too; (b) unsupported hosts report `headers_unsupported`, not "no headers received"; (c) `Set-Cookie` exposure *is* documented in `curl-execute.ts` |
| RC-17 asserts `/dev/fd/3` works "on a POSIX host" | coderabbit | Documentation | Forward annotation added in the file's existing supersession style, pointing at RC-18. **Not retro-edited** — the over-broad claim is what RC-18 exists to record (`.claude/rules/03-divergence.md`) |

### Declined Findings

| Comment | Reviewer | Severity | Scope | Reason declined |
|---|---|---|---|---|
| CHANGELOG should say "the Node parent" opens the pipe, not "the server" | coderabbit | P3 | in scope | **False positive.** The Node parent process *is* the MCP server; the two name one process. No inaccuracy, and no consequence stated |
| Add direct tests for the header-acceptance ceiling and `accountFor` equivalence | coderabbit | P3 (its own label: Trivial / Heavy lift) | in scope | **Already decided**, with the reasoning in *Testing summary* → *Gaps*: the ceiling needs ~35 redirect hops to reach because cURL caps its own header read near 300 KB, and the fixture was judged too expensive for the value. The gap is disclosed rather than hidden. `accountFor` equivalence is real and out of the contained band |

### Verification

Suite **1173 tests / 1166 passed / 0 failed / 7 skipped** (JSON artefact, `success: true`),
unchanged from baseline. `tsc --noEmit`: **12 errors, all pre-existing**, in three test
files this branch does not touch.

**Teeth probe on the new gates**, mutated and restored via `cp` in the same turn:
inverting `itOnDarwin` moved pending 7 → 11 (the four real-cURL tests skip), and
pinning the mocked suites to `linux` instead of `darwin` produced **19 failures** in
`curl-execute.headers.test.ts`. That is the finding measured rather than assumed —
without the pin, 19 assertions were hostage to the runner's platform.

### Files Modified

`src/lib/execution/command-executor.test.ts`, `src/lib/execution/curl-args-builder.test.ts`,
`src/lib/tools/curl-execute.headers.test.ts`, `CHANGELOG.md`, `LESSONS.md`,
`docs/work/handoff-header-channel-should-not-be-multiplexed.md`

**This round filed no todos. 3 remain open against the repo** (003, 004, 005), all
pre-existing and none created here.

## Review Comments Addressed — 2026-09-03 (Surface 3, round 2)

3 comments returned (2 findings + the standing Codex summary), against 12 in round 1.
Copilot returned nothing. Both findings were in round 1's own fixes, which is the
expected shape of a follow-up round rather than a regression.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Exit 63 can precede any body byte, so "exits 23, 56 and 63 all follow a partial transfer" is false | coderabbit | Fix needed | Correct — round 1 replaced one absolute with its mirror (K-11). Reworded to "cURL can emit partial output before a non-zero exit", keeping the completeness point that justifies the clean-exit gate |
| `serveOnce` orphans the first loopback server when a test serves twice | codex (P2) | Fix needed | Confirmed by reading: `server` was a single reference and the descriptor-derivation test calls `serveOnce` twice, so `afterEach` closed only the second. Fixed at the shared function — every server is tracked in an array and the hook closes all of them — rather than at the one call site, so a test added later cannot reintroduce it |

### Declined Findings

None this round.

### Verification

Suite **1173 / 1166 passed / 0 failed / 7 skipped**, `success: true`. The server-tracking
fix is resource hygiene in the test harness and carries no assertion of its own; it is
verified by reading the reference change plus a green suite, and that is stated rather
than claimed as covered.

## Review Comments Addressed — 2026-09-03 (Surface 3, round 3)

4 comments, of which **2 findings** — both from CodeRabbit, both on round 2's fix.
**Codex found nothing** ("Didn't find any major issues", reviewed `7205b348d3`) and
**Copilot returned nothing**.

### Changes Made

One class, two instances: *a wait on an event that may never arrive*.

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| `afterEach` can hang: `server.close()` waits for accepted connections, and a cURL run that aborts before sending leaves a socket no handler ends | coderabbit (Major) | Fix needed | **Round 2 introduced this.** Before it, teardown was a fire-and-forget `server?.close()`, so no wait existed to hang. Accepted sockets are now tracked and destroyed first, and teardown awaits nothing at all — removing the failure mode rather than shortening it |
| `server.listen` emits `"error"` without calling the listening callback, so a bind failure leaves the promise pending | coderabbit (Minor) | Fix needed | `once("error", reject)` registered before `listen()`. A bind failure now surfaces as itself instead of as a test timeout |

### Declined Findings

None this round.

### Verification

Suite **1173 / 1166 passed / 0 failed / 7 skipped**, `success: true`. `tsc --noEmit`
unchanged at **12 pre-existing errors**.

**The hang was measured, not accepted on the reviewer's word** — and the first attempt
to reproduce it returned a false negative because it raced the accept, waiting on the
client's `connect` rather than the server's `connection`. With the server-side socket
confirmed accepted, `await server.close()` does not return: probe printed `HUNG` at a
600 ms cutoff on Node v24.18.0. Recorded because the near-miss is the interesting part
— a probe that resolves in the reassuring direction reads exactly like a false positive
(`.claude/rules/01-known-shapes.md` K-2).
