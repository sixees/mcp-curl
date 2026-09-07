# Work Handoff: carry wire octets through the parse boundary and the size gate

**Date:** 2026-09-07 | **Branch:** `fix/016-carry-wire-octets-through-to-persistence` | **Plan:** `docs/todos/016-P2-wire-octets-are-decoded-lossily-before-persistence.md` (audited as the prerequisite for `docs/todos/018`) | **Status:** complete as narrowed — see *Summary*; the branch deliberately delivers less than todo 016 asked for, and 016 stays open

## Summary

The response body was decoded to a UTF-8 `string` at the parse boundary and every
consumer downstream treated that string as the origin's bytes. This branch moves
the octets through to `processResponse`, makes the request perform exactly one
decode, and checks `MAX_RESPONSE_SIZE` against both representations.

**It does not make the persisted artefact byte-exact, which was todo 016's
headline goal.** That was built, reviewed, and reverted on the director's call:
`savedMessage` tells the model to read a non-JSON artefact *"with your own
tooling"*, `jq_query` cannot open a non-JSON file, and so writing raw octets
withdrew Step 2 sanitisation from the one representation the model is instructed
to read. The artefact's safety turns out to be a property of *who reads it*, and
that is `docs/todos/018`'s decision. 018 now carries the section.

The run was invoked on **018**. The audit found 016 was a genuine prerequisite and
the operator sequenced it first, so 018 is untouched as work and richer as a
record: four settled decisions and the artefact question are now written into it.

## What was implemented

### The parse boundary hands over octets — `src/lib/response/parser.ts`

`ParsedResponse` carries `bodyBytes: Buffer` and **no decoded sibling**. Both
arms set it from the same subarray, so nothing can disagree about where the body
ends. The separator-absent arm returns `raw`; the separator-found arm returns
`raw.subarray(0, separatorIndex)`.

The decoded field was in the first implementation, exactly as 016 planned it, and
was removed after a self-review sweep found **zero production readers** — see
RC-33 rule 2 below. The parser still decodes the bounded metadata tail, which is
a field it parses itself.

### One decode per request, and a gate on both representations — `src/lib/response/processor.ts`

`processResponse(responseBytes: Buffer, options)`; the runtime guard is
`!Buffer.isBuffer(...)`. `MAX_RESPONSE_SIZE` is checked twice, and the two arms
have different jobs — this is the correction to 016's acceptance criterion 2, not
its fulfilment:

| Arm | Job |
|---|---|
| decoded length (`Buffer.byteLength(response)`) | **the binding gate** — what bounds every stage below |
| wire octets (`responseBytes.length`) | defence-in-depth for a direct internal caller, and the arm that keeps the error message true |

A decode only ever inflates, so the decoded arm subsumes the wire arm for
correctness. **The wire arm is not reachable through `curl_execute`** — three
reviewers established that in round 2: `command-executor.ts::accountFor` aborts
the child before an over-cap chunk is retained, and `--max-filesize` is the
cURL-side half. It survives as defence-in-depth and because the decoded arm's
"not valid UTF-8" wording would otherwise be asserted about a merely-oversized
ASCII body. `ARCHITECTURE.md` invariant 14 now names the layers that actually
refuse — while it did not, raising `accountFor`'s cap would have violated no
invariant.

### One answer to "did a filter run" — `src/lib/response/processor.ts`, `src/lib/server/schemas.ts`

`let filterApplied = false`, set inside the filter block past every throw, read by
both the disk decision and `savedMessage`'s `filtered` flag. Plus `.min(1)` on
`jq_filter` in `CurlExecuteSchema` and `JqQuerySchema`.

### `saveResponseToFile` takes a `Buffer` — `src/lib/response/file-saver.ts`

Buffer only, no `string | Buffer` union, and `writeFile` with no `encoding`. The
one legitimate encode (`Buffer.from(content, "utf8")`) happens at the call site
where it is visible in a diff. This is plumbing 018 needs.

### Tests

- `src/lib/tools/curl-execute.size-and-save.test.ts` — 7 cases at
  `executeCurlRequest` with `executeCommand` stubbed, which is the outermost
  boundary a real input reaches. Every link in this chain was individually
  defensible; the defects existed only in the composition.
- `src/lib/tools/curl-output.test-fixture.ts` — shared fixture, type **derived**
  from `CommandResult` rather than restated, and an options object rather than
  two interchangeable `Buffer | string` positionals.
- `src/lib/response/parser.test.ts` — 6 cases on `bodyBytes`, plus a local
  `text()` helper so cases whose subject is characters decode at the assertion.
- `src/lib/response/processor.test.ts` — a local `processText` helper encodes for
  ~101 pre-existing string fixtures; 4 cases on the runtime type guard.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Land 016 before 018 | Byte-exact return is unreachable while ingest hands downstream a lossy `string`. Verified by measurement, not argument. | Absorb 016 into 018 (one ~1,000-line diff across three surfaces at once — the convergence rule already fired on this surface); proceed on 018 and ship an acceptance criterion known to be false |
| `processResponse` takes the Buffer and decodes internally | A `(text, bytes)` parameter pair makes disagreement *expressible*; taking the bytes and deriving the text makes it unreachable | `bodyBytes` in the options bag beside a `string` first argument |
| `ParsedResponse` carries no decoded sibling | Zero production readers. Keeping it cost a second full decode of a body up to 10 MB. | Keep it as 016 planned; make it a lazy getter |
| **Revert persisting origin octets** | The artefact's only route for a non-JSON body is the host's own file tooling, outside every defence. Raw octets withdraw Step 2 sanitisation from it. | Gate the artefact on whether the body parses as JSON (~40 lines, a third round on a surface that had not settled in two); keep octets and stop advertising the read (real capability loss); abandon the branch |
| Check both size representations rather than swapping | The inflated count was doing real work as a bound. Honesty and bounding are two different consumers of one measurement. | Wire only (016's AC 2 as written — measured 10.3x peak RSS); decode only (the pre-existing message defect) |
| **016 stays open** | Its AC 1 is now 018's, its AC 2 is superseded by RC-34, and `jq-query.ts`'s lossy read is still its instance 5. Closing it on the write half would make that instance unfindable to anyone re-running the recorded sweep. | Mark it resolved and file a fresh todo for the reader (a duplicate weaker than the record that exists) |
| No new todo filed for `jq-query.ts` | 016 already lists it as a confirmed instance and 016 remains open, so it is tracked where a future reviewer will look. | File `019` — would have been a second record of one instance |
| **`jq_filter` keeps accepting `""` on `curl_execute`** — *revised during review (Surface 3), from round 2's decision to add `.min(1)`, on @coderabbitai's and @copilot-pull-request-reviewer's feedback* | The guard was a courtesy on a published export and cost a MAJOR bump; `filterApplied` holds the property either way, and `""` was already a self-describing no-op. Kept on `JqQuerySchema`, where it narrows nothing. `LESSONS.md` RC-36 | Bump to 4.0.0 and keep it (break costs nothing with one consumer, but the version claim would outrun the change); MINOR plus a documented changelog exception (leaves version and changelog making different severity claims) |

## What to pay attention to during review

- **`processResponse`'s save arm carries a long comment explaining a change that
  is *not* there.** That is deliberate — the next reader will have the same idea,
  and the comment plus `docs/todos/018` is what stops it being re-tried. Judge
  whether it earns its length.
- **The two size-gate arms look redundant and are not.** A teeth probe showed the
  wire arm fails no correctness case. If you conclude it is dead code, read the
  message-truth assertion in `curl-execute.size-and-save.test.ts` first.
- **`ARCHITECTURE.md` invariant 1a needed no edit and that is a claim worth
  checking.** Its premise — *"`processResponse` writes post-strip content to
  disk"* — is true again only because the persistence change was reverted. Two
  reviewers found nine stale-prose instances against it while the change was in;
  all nine retired when it came out. If any part of the persistence change comes
  back, those nine come back with it.
- **`Buffer.isBuffer` rejects a bare `Uint8Array`.** Three reviewers verified no
  reachable caller can hand one over (`processResponse` is on no published entry
  point). The guard's *message* does not tell a hypothetical JS caller that
  `Buffer.from(u8)` is the remedy. Declined as an empty population; disagree if
  you can name the caller.
- **`bodyBytes` is a subarray, so it keeps cURL's whole stdout buffer alive.**
  Measured as adding no retention — `stdoutBytes` was already live for the whole
  function via `headerBytes` and `stderr` — and peak RSS is identical at both
  refs. Worth re-checking if the parser's lifetime ever changes.

## Known issues and limitations

- **The persisted artefact is still lossy for a non-UTF-8 origin.** This is
  016's headline defect and it is unfixed. It is now 018's, with the reasoning
  written into 018 rather than left implicit.
- **`jq-query.ts::executeJqQuery` reads with `{ encoding: "utf-8" }`.** Three
  reviewers flagged it independently. Not a regression — the artefact was already
  lossy — but it is the class's last live silent member. Tracked as 016 instance 5.
- **`docs/todos/003` (memory ceiling released before peak) is now more
  load-bearing**, not less. `performance-oracle` measured the worst case moving
  from ~3.3 MB of invalid octets to the full 10 MB. Its filed severity should be
  reconsidered with those numbers.
- **`STRIP_PATH_MAX_BYTES` is measured on the decode**, so a non-UTF-8 body skips
  the strip path at ~85–141 KB of wire instead of 256 KB. Pre-existing and
  untouched here; surfaced by `performance-oracle` and worth a todo if it is not
  subsumed by 018.
- **`command-executor.ts`'s stderr handler decodes per chunk** (`data.toString()`),
  which corrupts a multi-byte sequence straddling a chunk boundary — the exact
  mirror of what this branch fixed for stdout. Out of scope, file untouched,
  named by `typescript-reviewer` as a K-11 sibling.
- **Three pre-existing `tsc` errors** in `src/lib.test.ts`,
  `src/lib/response/post-processor.test.ts` and `src/lib/schema/schema.test.ts`.
  None is in this diff; all three exist at `ccf6e62`.

## Testing summary

**Runner and mode:** `npx vitest run --reporter=json --outputFile=<path>`, verdict
parsed from the structural result counts in that artefact, not from a summary
line. Note `CLAUDE.md`'s stack caveat: vitest is not on the list of runners whose
structured output is trusted here, so treat this as a strong signal and not a
certification.

**Final run:** 1,289 total — **1,281 passed, 7 skipped, 1 failed.**

The single failure is `src/lib/response/strip-blocks.test.ts`'s ReDoS wall-clock
budget, a file this branch does not touch. Across four full runs it failed on
**four different tests** in that file, which is the signature `docs/todos/013`
records. Tracked there; not caused here.

**Teeth probed.** Each guard reverted in turn, restored from a `cp` backup in the
same turn, and confirmed to fail a distinct case:

| Probe | Failed |
|---|---|
| drop the decoded-length gate | `refuses a body under the wire cap whose DECODE exceeds it` |
| drop the wire-length gate | `refuses a body over the cap in wire octets, quoting the wire count` (message-truth) |
| persist origin octets again | `applies the strip stages to what lands on disk` + the filtered-arm case |

**Two false greens in my own tests, both caught by probing rather than by
reading:**

1. The strip-stage case used an `application/json` fixture. JSON documents are
   exempt from the markup and markdown stages, so the defended text equalled the
   origin bytes and the assertion could not tell them apart. Re-pointed at
   `text/markdown`, where both stage sets run.
2. The wire-gate case asserted only that an over-cap body is refused — which the
   decoded gate also does, since a decode only ever inflates. Strengthened to
   assert the message-truth property the wire arm uniquely owns.

**Gaps.** No test observes that the body is decoded exactly once; that is a
performance property and `performance-oracle` measured it instead. Nothing pins
the memory ceiling against the decode multiple — `performance-oracle` names that
as the fix for `docs/todos/003` and it crosses a module boundary.

## Commit history

```
262a508 fix(response): narrow to the plumbing and the size gate; 018 owns the artefact
238d7d7 fix(response): one predicate for "did a filter run", and derive the test fixture
b8ea7b5 fix(response): drop the decoded body field — nothing read it
a238642 docs(todos): record the four settled decisions on 018
39b1ef3 fix(response): carry the wire octets through to persistence and the size gate
```

The sequence is worth reading in order: `39b1ef3` implements 016 as written,
`b8ea7b5` and `238d7d7` fix defects found in it, and `262a508` narrows it. The
branch argues with itself and the record shows where.

## Review context

**Suggested order:** `src/lib/response/parser.ts` (the boundary) →
`src/lib/response/processor.ts` (the gate, the decode, the save arm) →
`src/lib/tools/curl-execute.size-and-save.test.ts` (what is actually guaranteed) →
`ARCHITECTURE.md` invariant 14 → `LESSONS.md` RC-33 and RC-34.

**Related:** `ARCHITECTURE.md` invariants 1, 1a, 11, 14, 16. `docs/todos/016`
(this branch's plan, still open), `docs/todos/018` (the next piece, and now the
owner of the artefact question), `docs/todos/003`, `docs/todos/012`,
`docs/todos/013`, `docs/todos/015`.

## Reality Corrections

Both are filed in `LESSONS.md`, which is the durable ledger; these are the inline
copies. Numbering is per-project per `docs/compound/compound-engineering-profile.md`
§1; the ledger held 32 entries before this branch.

### RC-33 — the plan to carry wire octets to disk was audited, built, and then narrowed under review

**Plan said:** todo 016 solution 1 — octets beside the decoded string, carried
through to `saveResponseToFile`, so the artefact is byte-exact. Three signatures
move; invariant 14 gains a note.

**Reality:** the mechanism was real and the scope was wrong in both directions.
`{"name":"Jos\xe9"}` is `7b2261223a224a6f73e9227d` on the wire and `…efbfbd…`
after the round trip, so the loss is genuine. But (a) one of 016's three named
consequences did not exist — `diskBytes` was `Buffer.byteLength(content, "utf8")`
while `saveResponseToFile(content)` wrote that same string as UTF-8, so the two
agreed exactly, and an earlier draft of this RC asserted otherwise on a premise
one `git show ccf6e62` would have settled; and (b) persisting the octets broke a
defence, because `savedMessage` routes a non-JSON artefact to the host's own
tooling and `jq_query` cannot open one, so raw octets removed Step 2 sanitisation
from the one representation the model is told to read.

**Correction:** narrowed. The plumbing, the single decode and the dual gate
landed; the artefact stays defended text and its form moved to 018. 016 stays
open.

**Files:** `src/lib/response/parser.ts::ParsedResponse`,
`src/lib/response/processor.ts::processResponse`,
`src/lib/response/file-saver.ts::saveResponseToFile`,
`src/lib/tools/curl-execute.ts::executeCurlRequest`, `ARCHITECTURE.md` invariant 14.

### RC-34 — making a measurement honest removed the bound the dishonest measurement was providing

**Plan said:** 016 AC 2 — *"`MAX_RESPONSE_SIZE` is measured against wire octets,
not against the inflated decoded length."* The defect it named was real: a 4 MB
body of invalid octets was refused as *"12000000 bytes"*, a number found nowhere
on the wire.

**Reality:** that inflated count was also the only thing bounding the work, since
every stage after the gate runs on the decode. On an ordinary 9.5 MB gzip —
1.81x inflation, not an attack — the request went **refused → accepted, 126 →
478–490 ms CPU, peak RSS +19 MB → +196 MB (10.3x)**, past
`MAX_TOTAL_RESPONSE_MEMORY`, which the neighbouring constant documents as the
ceiling across *all* concurrent requests. Three concurrent 10 MB invalid-octet
bodies: all three rejected at base, all three fulfilled on the branch.

**Correction:** both representations are checked, and `ARCHITECTURE.md` invariant
14 owns the detail and the measurement rather than this entry restating them —
round 2 found the figures duplicated across six documents with one copy already
drifted. The decoded arm binds. The wire arm is **defence-in-depth for a direct
internal caller, not a fast path on a live route**: `accountFor` refuses an
over-cap body streaming, so nothing reachable gets that far.

**Files:** `src/lib/response/processor.ts::processResponse`, `ARCHITECTURE.md`
invariant 14, `src/lib/tools/curl-execute.size-and-save.test.ts`.

## Follow-up work

- [ ] **`docs/todos/018`** — the agreed next piece. Now carries four settled
      decisions and the artefact-form question. Read the 016 row before starting.
- [ ] **`docs/todos/016`** — still open on `jq-query.ts`'s lossy read-back.
- [ ] **`docs/todos/003`** — reconsider its severity with `performance-oracle`'s
      numbers; the worst case moved from ~3.3 MB to 10 MB.
- [ ] `STRIP_PATH_MAX_BYTES` measured on the decode — decide whether 018 subsumes it.
- [ ] `command-executor.ts`'s per-chunk stderr decode — K-11 sibling, out of scope here.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/018-P1-json-only-proxy-parse-to-validate-return-original-bytes.md` | P1 | JSON-only proxy; parse to validate; **now also owns the saved artefact's form** | operator scope decision 2026-09-07; enriched by this run |
| `docs/todos/016-P2-wire-octets-are-decoded-lossily-before-persistence.md` | P2 | Partly landed. Open on `jq-query.ts::executeJqQuery`'s `readFile(…, "utf-8")` | this branch's plan; kept open deliberately |

**This run created no new todos and closed none.** The branch is net-neutral on
its own todos. `jq-query.ts` was deliberately not filed separately — 016 already
records it as a confirmed instance and 016 remains open, so a second file would
be a weaker duplicate of an existing record.

### Resolved Todos

_None._ The run was invoked on `docs/todos/018`, which is not resolved — it is the
next piece of work. `docs/todos/016` is partly implemented and deliberately left
open. **No todo file was deleted by this run.**

---

## Code Review — 2026-09-07

**Certification:** complete
**Roster closure:** closed [unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"]

**Scope reviewed:** `ccf6e62c24a73c1e5551e58087cd8ff1e10926f1..HEAD`, resolved by
`git merge-base --fork-point origin/HEAD HEAD`. Roster: the 6 configured in
`sixees-workflow.local.md` unioned with the 4-agent floor, deduped to 8. The
config omits `data-integrity-guardian` and `learnings-researcher`; both were
dispatched as floor members and neither was auto-added to the config.

### Reviewer status

| Reviewer | Floor | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| `learnings-researcher` | floor | none | done | — | 6 known patterns: RC-1, RC-2, RC-15, RC-28, RC-31, RC-32 |
| `code-simplicity-reviewer` | floor | v1 | findings | 1 | declined the fixture extraction, the 7-case set and `processText` as justified, each with a reason |
| `security-sentinel` | floor | v1 | findings | 3 | ran three measured probes from the scratchpad; verified the in-process reader claim and refuted the strip-subset claim |
| `data-integrity-guardian` | floor | v1 | findings | 2 | scope shortfall — no `Bash`; judged the changed files whole, and said so. Also reported the tree moving mid-review |
| `typescript-reviewer` | optional | v1 | findings | 2 | scope shortfall — no `Bash`; declared it. Withdrew one forming finding as already fixed |
| `architecture-strategist` | optional | v1 | findings | 4 | scope shortfall — no `Bash`; declared it. Also reported the tree moving mid-review |
| `pattern-recognition-specialist` | optional | v1 | findings | 2 | widened the K-4 sweep past the three literal spellings; 0 additional hits |
| `performance-oracle` | optional | v1 | findings | 2 | pinned every measurement to `git archive` of committed refs rather than the working tree |

8 dispatched, 8 accounted for. No `failed`, none `not migrated`. Every `v1` floor
agent named both lenses or their absence, so nothing withholds certification.

### `/security-review`

Ran; its identification sub-task completed and its report was persisted to
`docs/work/.scratch/security-review/016-octets-20260907-1132/raw.md`, then parsed
by `security-review-parser`.

- `reviewer_status: "ok"` → proceeds
- `findings_count: 1`, and `findings.jsonl` holds exactly 1 parseable record → **reconciled**
- `sec-016-octets-20260907-1132-1`, `medium`, `must_fix: false`, `src/lib/response/processor.ts:1087`
- `parser_warnings_total: 1` — the report's secondary location (`:839`) cannot be
  carried by the single-location schema; recorded as a warning rather than dropped

That finding is the same class as the P1 below and was already fixed by the
revert. **Coverage caveat:** `/security-review` resolves its own scope and
dispatches its own sub-task, so a truncation at that boundary is not observable
from here — and its inline diff *was* truncated to a 2 KB preview with the full
128 KB persisted to a side file. The sub-task was pointed at the full file
explicitly. A positive signal means it replied, not that it replied about
everything.

### Findings by class

17 raw findings across 8 reviewers plus 1 from `/security-review`, merged on
confirmed-instance overlap into 10 classes.

| Class | Severity | Instances | Reviewers | Disposition |
|---|---|---|---|---|
| `unescaped-sink` — undefended artefact, and the server advertises reading it | **P1** | 2 confirmed | security-sentinel, architecture-strategist, /security-review | in scope — **fixed by reverting the persistence change**, on the director's call |
| `unbounded-growth` — the size ceiling stopped bounding the work | P2 | 4 (1 in-diff confirmed) | performance-oracle | in scope — **fixed**; both representations now checked |
| `stale-comment` — the JSON exemption's premise falsified in 9 places | P2 | 9 confirmed | data-integrity-guardian, architecture-strategist | in scope — **retired by the revert**; invariant 1a's premise is true again and needed no edit |
| `unchecked-assertion` — invariant 14's "the read path defends" | P2 | 2 confirmed | architecture-strategist, security-sentinel | in scope — **fixed**; the paragraph is deleted |
| `duplicated-logic` — `jq_filter: ""` answered by two predicates | P2 | 1 confirmed | security-sentinel | in scope — **fixed**; one `filterApplied` boolean plus `.min(1)` |
| `repeated-computation` — `ParsedResponse.body` had no reader | P2 | 2 confirmed | code-simplicity-reviewer, performance-oracle, security-sentinel | in scope — **fixed in `b8ea7b5`, before the reviewers returned** |
| `broken-contract` — the fixture restated `CommandResult`; inverted arg order | P2 | 4 confirmed | typescript-reviewer, pattern-recognition-specialist | in scope — **fixed**; derived from `CommandResult`, options object |
| `missing-validation` — fidelity closed on writes, open at the reader, recorded closed | P2 | 4 confirmed | data-integrity-guardian, pattern-recognition-specialist, architecture-strategist | **split** — in-diff half (018's row, RC-33) **fixed**; `jq-query.ts` is an out-of-scope sibling and stays in 016, which is why 016 stays open |
| `stale-comment` — a removed symbol cited, a count understated | P3 | 2 confirmed | typescript-reviewer | in scope — **fixed** |
| `convention-drift` — a test-only module in the production tree | P3 | 1 confirmed | architecture-strategist | in scope — **fixed**; renamed `curl-output.test-fixture.ts` |

- Rejected: **0.** Every class carried at least one confirmed instance and a
  concrete failure scenario.
- Declined by the reviewers themselves, with reasons, and recorded rather than
  re-filed: `docs/todos/012`'s filename collision (already tracked at P1);
  `docs/todos/003`'s memory ceiling (routed to `performance-oracle`, which
  escalated it with numbers); `savedMessage`'s incomparable size numbers (K-14 —
  disclosed wording, settled across two prior rounds); `command-executor.ts`'s
  per-chunk stderr decode (out of scope, K-11 sibling); `output_dir`'s breadth
  (pre-existing); `Buffer.isBuffer`'s message wording (K-14 — empty population).
- Escalated and answered: **1** — the P1. Put to the director, who chose to
  narrow the branch rather than fix forward.
- Todos created: **0.** Todos closed: **0.**

### Handoff assessment

Written after the review, so it describes the post-fix state. The builder's own
Surface-1 pass caught two of the ten classes before any reviewer returned — the
dead field and the false-green test fixture — and both are recorded as caught. The
builder also had two claims refuted by measurement it did not take itself: that
`jq_query` defends what it reads, and that the persisted artefact was
byte-fidelity's natural home. Both were written into `ARCHITECTURE.md` as
justifications, which is the worst place for an unchecked premise, and both were
removed.

### Verified claims

| Claim | Verdict |
|---|---|
| "Tests pass" | Verified — ran the suite in JSON reporter mode and parsed structural counts. 1,281 passed, 1 failed (the todo-013 flake, in an untouched file, a different test on each of four runs) |
| "Key files complete" | Verified — `git diff --name-only` against the resolved base matches the commit messages; no unlisted `src/` change |
| "`processResponse` has one caller" | Verified — `rg` found exactly one production call site; the docblock's claim held |
| "`processResponse` is not on a published entry point" | Verified by three reviewers against `package.json` exports, `src/lib.ts`, `src/lib/index.ts` and the generated `.d.ts` files. **True of `processResponse`, `saveResponseToFile` and `ParsedResponse` only — it was carried as a blanket claim about the branch and that was wrong.** See the row below |
| ~~"Invariant 11 untouched"~~ | **Refuted in round 2, by three reviewers.** `CurlExecuteSchema` IS published on the `./lib` entry (`src/lib/index.ts:31`) and is the MCP tool's input schema. At base `jq_filter: ""` parsed and returned the body; it is now rejected. Accept → reject on a published surface is a **MAJOR** by invariant 11. The narrowing is right (`CONVENTIONS.md` → *Security*: an explicitly-supplied empty input fails closed) — the version number is the director's call at merge, the same shape `docs/todos/018` → *The published exports go with them* uses. `JqQuerySchema` is **not** a break: `applyJqFilter` already threw on an empty filter, so only the error's site moves |
| "`jq_query` runs the full `defendText` pipeline on what it reads" | **Refuted** — three ways, by two reviewers. Invariant 1 holds via the post-processor wrap instead. The claim is deleted |
| "The strip pass bought only the markup subset" | **Refuted** on the non-JSON route — `jq_query` cannot open such a file, so there is no defended reader. This is the P1 |
| "`savedMessage`'s byte count was wrong at base" | **Refuted by my own re-check** — `git show ccf6e62` shows the two agreed exactly. RC-33 corrected |

### Coverage caveats

- **The working tree moved mid-review.** Commit `b8ea7b5` landed while the roster
  was running, and four reviewers reported it. Each re-verified its findings, and
  `performance-oracle` had pinned all measurements to `git archive` of committed
  refs, so the findings stand — but round 1 was not conducted against a frozen
  tree, and that is the orchestrator's error, not the reviewers'. A re-run of
  Surface 2 against the final tree would be the conservative call before merge.
- **Three reviewers hold no `Bash`** and read files at HEAD rather than applying
  the range. All three declared it. Structural, not fixable by re-running.
- **Surface 3 has not run.** No bot reviewer has seen this branch.

### Blockers

**None outstanding.** The one P1 was escalated, answered by the director, and
closed by narrowing the branch.

---

## Code Review — 2026-09-07, round 2

**Certification:** complete
**Roster closure:** closed [unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"]

Re-run against a **frozen** tree at `77f82af` on the director's instruction, because
round 1 had been dispatched mid-edit and the narrowing landed after most reviewers
had read the code. Same 8-agent roster; 8 returned. No commits were made while
they ran.

### Findings by class — round 2

**11 classes. Eight are prose, two are test scaffolding, one is a plan document.
None is production behaviour.** Two reviewers verified the code clean, one by
fuzzing the decode-inflation premise across 200,000 random buffers with no shrink.

| Class | Severity | Reviewers | Disposition |
|---|---|---|---|
| `fail-open-default` — todo 018's artefact gate named a predicate whose domain cannot answer it | P2 | architecture | **fixed in 018** — full parse + `isCompositeValue`, no strip cap, plus a bare-scalar acceptance criterion |
| `misplaced-decision` — the request ceiling documented at the one layer that cannot reach it | P2 | security, data-integrity, architecture | **fixed** — invariant 14 names `accountFor` and `--max-filesize`; the wire arm is described as defence-in-depth |
| `stale-comment` — prose from the reverted design survived it | P2 | data-integrity, code-simplicity | **fixed** — three comment blocks re-derived from the landed tree |
| `broken-contract` — `.min(1)` narrows a published contract; the handoff certified otherwise | P2 | security, data-integrity, architecture | **fixed** — the false row is struck through and corrected in *Verified claims* |
| `untyped-boundary` — `as Mock` erased the executor's signature | P2 | typescript | **fixed** — `vi.mocked` in all three suites; probe now yields 42 errors where it yielded 0 |
| `convention-drift` — one measurement restated in six places, one copy already drifted | P2 | pattern | **fixed** — invariant 14 owns it; RC-34, the handoff and todo 016 cite it |
| `broken-contract` — the fixture could construct a `CommandResult` the executor cannot | P3 | typescript | **fixed** — empty and absent collapse to `undefined`, as the executor does |
| `stale-comment` — four false claims in the fixture's docblocks, incl. the pre-rename filename | P3 | typescript | **fixed** |
| `duplicated-logic` — the shared stub hostname reached one of two call sites | P3 | pattern, typescript, code-simplicity | **fix attempted and reverted — see RC-35.** The constant cannot exist: `vi.mock` hoists above imports |
| `stale-comment` — `bodyBytes` claimed "exactly as the origin sent them" | P3 | data-integrity | **fixed** — qualified per arm, with the test it named |
| `stale-comment` — todo 016's finding list in the present tense | P3 | architecture | **fixed** — all six instances carry their state at HEAD |

- Rejected: **0**.
- **Declined, out of scope, with the reason recorded here rather than as a todo:**
  `security-sentinel`'s P3 on `saveResponseToFile`'s output-directory guard, which
  compares `realpath(resolve(outputDir))` against `realpath(resolve(targetDir))`
  where `targetDir = outputDir ?? …` — the same value, so it validates nothing.
  The reviewer's own assessment is that the population is empty (the one caller
  validates upstream via `resolveOutputDir` + `validateOutputDir`) and that the
  lines pre-exist this branch and are untouched by it. Declining rather than
  fixing, because widening a branch that has already been narrowed once to delete
  a pre-existing dead guard is the scope creep that produced round 1.
- Escalated: **0**. Todos created: **0**. Todos closed: **0**.

### One finding whose fix did not survive contact — RC-35

Three reviewers asked for a shared stub-hostname constant. It is **not
implementable**: `vi.mock` factories hoist above every import, so
`curl-execute.headers.test.ts` failed to load entirely — 0 tests collected,
`Cannot access '__vi_import_4__' before initialization`. The other suite
referencing the same constant **passed**, on import-order luck, and would have
become an unexplainable flake later. The constant was removed rather than kept
working by accident; the fixture records the constraint so the next reviewer
raising this drift gets a reason instead of a repeat attempt.

### Reviewer status — round 2

| Reviewer | Floor | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| `learnings-researcher` | floor | none | done | — | 7 prior RCs. **Cited RC-34 as prior art in error** — it is this branch's own entry |
| `code-simplicity-reviewer` | floor | v1 | findings | 1 | answered the "does `bodyBytes` still earn its keep" question directly: yes, via the honest wire count and 018's scheduled need |
| `security-sentinel` | floor | v1 | findings | 2 | both P3, and it said plainly neither is a vulnerability. Fuzzed the decode premise over 200k buffers |
| `data-integrity-guardian` | floor | v1 | findings | 3 | scope shortfall — no `Bash`; declared it |
| `typescript-reviewer` | optional | v1 | findings | 3 | scope shortfall — no `Bash`; declared it. Traced round 1's class to a new layer |
| `architecture-strategist` | optional | v1 | findings | 4 | scope shortfall — no `Bash`; declared it |
| `pattern-recognition-specialist` | optional | v1 | findings | 2 | swept 70 size-idiom candidates; found one spelling per question |
| `performance-oracle` | optional | v1 | **clean** | 0 | re-measured the regression closed; pinned every number to `git archive` of committed refs |

### `performance-oracle` — the regression is closed, measured

Returned `clean`, 0 findings, with round 1's harness and inputs against
`git archive` extractions of both refs:

| Case | base `ccf6e62` | HEAD `77f82af` |
|---|---|---|
| 9.5 MB gzip (wire 9,500,000 → decoded 17,222,813; **1.813x**) | REFUSED | **REFUSED** |
| 9,999,999 × `0xFF` (decoded 29,999,997) | REFUSED | **REFUSED** |
| N=3 concurrent, same body | 0 fulfilled / 3 rejected | **0 fulfilled / 3 rejected** |

It teeth-probed both arms independently and got the same result recorded above:
disabling the decoded gate fails exactly the decode case; disabling the wire gate
fails only the message-truth assertion.

Three things it found that are better than this handoff claimed:

- **HEAD does one fewer O(n) pass than base** — 3 full-body `Buffer.byteLength`
  calls against base's 4, because the decoded gate replaced base's step-1
  measurement and `diskBytes` became O(1). The second gate costs ~0.7–1.0% of
  `processResponse`.
- **The persistence revert is net-neutral, not a loss.** Round 1's 107.5 → 96.5 ms
  win is given back, but HEAD is level with base: `Buffer.from(content, "utf8")`
  replaces an encode `fs.writeFile` was already doing internally for a string.
  Deltas sit inside run-to-run spread and the minima cross over.
- **`bodyBytes` adds no retention** — identical peak RSS on every case, because
  `result.stdoutBytes` is alive across `executeCurlRequest` on both trees anyway.
  `docs/todos/003`'s worst case is neither better nor worse than base.

Bundle impact +854 bytes; the fixture does not ship (`tsup` declares four explicit
entries, no glob).

### Coverage caveats — round 2

- **The tree moved under `performance-oracle`, and that was my error again.** I
  began applying round-2 fixes while it was still running, having said in the same
  breath that I would not. It reported nine modified files with mtimes spanning
  its run. **Its numbers are unaffected** because it pinned every measurement to
  `git archive` of committed refs rather than the working tree, and it verified
  the drift in the gate region is comment-only and byte-identical — so its verdict
  holds for the tree as it stands. That is the reviewer defending the result, not
  me. **Recorded as a recurrence**: the same discipline failure as round 1, made
  once after being named. The other seven reviewers had returned before I started
  editing.
- Three reviewers hold no `Bash` and read files at HEAD; all three declared it.
  Structural, not fixable by re-running.
- **The round-2 fixes themselves are unreviewed.** Everything in *Findings by
  class — round 2* was applied after its reviewer returned. They are prose, test
  scaffolding and a plan document, with the code paths unchanged and re-probed —
  but no reviewer has read them.
- **Surface 3 has not run.** No bot reviewer has seen this branch.

### Blockers

**None outstanding.** No P1 in round 2. Every in-scope class is fixed, one is
declined with its reason above, and one turned out to be unfixable and is recorded
as RC-35.

---

## Comment pass — 2026-09-07

A pass over every site this branch touched, against three criteria from the
director: comments describe the current code and not its history; they give the
why rather than restating the logic; and parents and children agree on the facts
that cross between them.

**The history criterion cut the most.** Comments had accumulated what was tried
and reverted, what an earlier version did, and what a review round found — a
running commentary on the branch's own argument with itself. That belongs in
`LESSONS.md` RC-33/34/35 and the todos, which already hold it. Removed from
`processResponse`'s doc-block and save arm, the Step 1 gate, the decode, the
`filterApplied` block, `ParsedResponse.bodyBytes`, `saveResponseToFile`,
`curl-execute.ts`'s call site, both `jq_filter` schema comments, six blocks in
`curl-output.test-fixture.ts`, and four test comments. The save arm went from 30
lines to 16 and says more.

One was a comment *about a previous comment* — `curl-execute.ts` explained why it
no longer contrasted against a removed field. Deleted; the field is gone and the
contrast has no reader.

### Two false claims the pass found

- **`SavedMessageFacts.diskBytes` said the buffer length and the string
  measurement "diverge on every non-UTF-8 body".** They do not: `diskContent` is
  `content` encoded, so they agree exactly. A leftover from the octet-persistence
  version, and the kind of claim a reader would have trusted.
- **`processResponse`'s `@param responseBytes` justified its runtime guard as
  defending against "a JS caller from a custom-tool hook".** No such caller can
  exist — three reviewers verified the function is on no published entry point.
  Restated as what it is: a free fail-closed check on a function with one
  compiler-checked caller.

### Call-chain dispositions, now reconciled

| Fact | Chain | Was |
|---|---|---|
| Who enforces `MAX_RESPONSE_SIZE` | `accountFor` → `processResponse` → invariant 14 | the parent did not say it was the binding one; the child called its own check a fast path |
| What `bodyBytes` is | `CommandResult.stdoutBytes` → `ParsedResponse.bodyBytes` → `processResponse` | the child restated the parent's argument instead of citing it |
| **`outputDir` must arrive validated** | `executeCurlRequest` → `ProcessResponseOptions` → `saveResponseToFile` | **a real gap — the middle link dropped a security precondition its child depends on.** `ProcessResponseOptions.outputDir` now carries it, and `saveResponseToFile`'s `@param` names where it is met |
| What is on disk | save arm → `saveResponseToFile` → `savedMessage` → `jq_query` → invariant 1a | agreed already; verified rather than assumed |
| `filterApplied` → `filtered` | `processResponse` → `savedMessage` | agreed |

One code change, disclosed because it is not a comment: the fixture's header
collapse called `toBuffer` twice for a non-empty block. Now once.

Suite after the pass: 1,281 passed, 7 skipped, 2 failed — both the `strip-blocks`
wall-clock flake. `git diff` over `src/` adds no non-comment line apart from that
one.

## Review Comments Addressed — 2026-09-07 (Surface 3, round 1)

**Reviewers engaged:** `codex` (mention trigger, scoped to the branch's diff) and
`copilot-pull-request-reviewer` (requested via `gh api … /requested_reviewers`,
`201 Created`). Copilot is off `/sixees-workflow:review-pr-comments`'s roster by
decision; the director named it explicitly and named the mechanism, so it was
engaged through the API rather than by mention.

**Baseline before the triggers:** `count=3`, `openCount=3` — three CodeRabbit
inline threads were already open from an earlier automatic run. **After:** 11
entries, merging to **5 distinct findings**. 11 comments is not 11 findings.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| 018's opening decision admits every `JSON.parse` success, contradicting its own settled composite gate (`018:168`, `018:220`) | coderabbitai ×2 | Fix needed — `stale-comment` | Opening decision now requires object-or-array and points at *Require object-or-array* as the single owner; the V8-message example replaced with the repo-owned classification. **Sweep found a third instance neither bot saw** — `018:139`, the bullet carrying the artefact-safety argument |
| `.min(1)` on `jq_filter` narrows an accepted input on a published entry point (`schemas.ts:93`, `schemas.ts:95`) | coderabbitai + copilot | Decision conflict → director settled | **Reverted on `CurlExecuteSchema`; kept on `JqQuerySchema`.** Release stays MINOR. `LESSONS.md` RC-36 |
| `@param outputDir` claims "nothing here checks it" while the function re-resolves the path (`file-saver.ts:69`, `types/response.ts:56`) | copilot ×2 | Fix needed — `stale-comment` | Both docblocks now state the real precondition: the **allowed-root policy** is not enforced here; the normalisation cross-check is defence-in-depth |
| `type Mock` imported but unused after the move to `vi.mocked` (three test files) | copilot ×3 | Fix needed — `dead-code` | Import removed from all three. `tsconfig.json` sets no `noUnusedLocals`, so nothing was failing — a genuine dead import left by this branch's own edit |
| Codex review summary; "Didn't find any major issues" on `3cb27d6` | chatgpt-codex-connector ×2 | Question/ack — no defect | **Answered.** No thread to resolve on either — `kind: "issue"` carries no resolved state |

### Declined Findings

**None this round.** Every finding was real and in scope, which is not the usual
shape of a bot round — read it as this diff carrying a lot of prose rather than
as the reviewers being unusually accurate. Recorded explicitly because an absent
table reads as "declines were not written down".

### Decisions Revised

| Original decision | New approach | Reason | Reviewer |
|---|---|---|---|
| Add `.min(1)` to `jq_filter` on both schemas, per `CONVENTIONS.md` → *Security* (round 2 of this branch) | `.min(1)` removed from `CurlExecuteSchema`; retained on `JqQuerySchema` | Two facts already in the codebase: the guard's own comment conceded it was *"the courtesy"* and named `filterApplied` as the guarantee, and `""` was falsy at base so the filter block never ran and `filtered: false` was already honest. The guard cost a MAJOR bump on a published export and protected a property held one layer down. Director settled it: revert, stay MINOR. `LESSONS.md` RC-36 | coderabbitai, copilot |

**The asymmetry is deliberate and was verified rather than assumed.** On
`JqQuerySchema`, `jq_filter` is required, `splitJqFilters("")` returns `[]`, and
`applyJqFilterToParsed` already throws *"filter must specify a path"* — so that
`.min(1)` narrows nothing and only moves the error's site. Confirmed by reading
`src/lib/jq/parser.ts::splitJqFilters` and `src/lib/jq/filter.ts::applyJqFilterToParsed`,
because the sibling's comment asserting it was a checkable premise (K-3).

**Teeth probed.** The test that asserted the schema rejection now asserts the
property that survives — an empty filter is no filter, and the response does not
advertise filter output. Re-adding `.min(1)` fails that test and only that test;
restored from a `cp` backup, not from git.

### Outstanding Todos

**0 filed this round. 0 open against #38.**

### Observed, not filed — the suite's timing guards

`processor.test.ts`'s *"does not run a defence pass over a body it will not
return"* failed once under full-suite parallelism and passes in isolation
(109/109, 686 ms). Across four consecutive full runs the failing set moved every
time — 2 failures, then 2, then 1 — and `numPassedTests` moved with it
(1281/1282). That is `docs/todos/013`'s class, whose title is already "the suite
has no reliable green"; the guard is a CPU-time ratio, not a ReDoS budget, so it
is a second file exhibiting the same shape.

**Not filed and not added to 013**: the timing test is not in this branch's diff
(`git diff main..HEAD -- src/lib/response/processor.test.ts` touches 256 lines,
none of them that test), so it is out of scope, and 013 already owns the class.
Recorded here rather than as a file, per `pr-resolver-safety` → *Severity against
scope*: an out-of-scope P2 is declined, not deferred.

### Files Modified

`src/lib/server/schemas.ts`, `src/lib/response/file-saver.ts`,
`src/lib/types/response.ts`, `src/lib/tools/curl-execute.size-and-save.test.ts`,
`src/lib/tools/curl-execute.headers.test.ts`,
`src/lib/tools/register-all-tools.test.ts`,
`docs/todos/018-P1-json-only-proxy-parse-to-validate-return-original-bytes.md`,
`LESSONS.md` (RC-36), and this handoff.

**Suite after the round:** 1281 passed, 7 skipped, 1–2 failed — the todo-013
timing flake only, different tests each run. `tsc` errors confined to the same
three pre-existing files (`src/lib.test.ts`,
`src/lib/response/post-processor.test.ts`, `src/lib/schema/schema.test.ts`), all
of which fail at `ccf6e62` too.
