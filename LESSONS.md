# Lessons

> Seeded by `/sixees-workflow:init-compound`. **It is yours now** — nothing
> overwrites it, and nothing refreshes it. Append to it; do not rewrite it.

**This file is the Reality Correction ledger.** Every RC lands here, permanently,
in addition to the PR handoff it was filed in.

**Why it exists, and it is the whole point of the file.** A handoff is read once,
by the run that wrote it, and then it is archived. An RC recorded only there is a
lesson that expires the moment the PR merges — so the next session rediscovers it,
pays for it again, and files it again under a new number. This file is the one
place a lesson outlives the run that learned it.

It is not a changelog. A changelog says what shipped; this says what reality
turned out to be, and what it cost to find out.

Read it when a rule looks arbitrary, and **before planning anything that touches a
surface an RC already names**. Do not read it as a checklist: a new defect that
looks like none of these still needs its own investigation.

---

## Filing an RC

**When.** Reality diverges from the plan. What the plan assumed was not true, and
the work had to change course.

**Number.** `RC-N`, sequential across the whole trail. The unit — per project, per
feature or per theme — is declared in this project's Compound Engineering profile.
Claim the number at the time; it is durable once assigned.

**Where.** Two places, both required: inline in the PR handoff beside the work it
corrected, and appended to the ledger below. Add a one-line `POST-AUDIT`
annotation in the plan pointing at the RC — and **never retro-edit plan text.** The
plan is the record of what was believed; correcting it in place destroys the only
evidence that anything diverged.

**What is not an RC.** Plan typos go to commit history. Requirement pivots go to a
kickoff update. Unrelated bugs go to the todo system. An RC is specifically: the
plan said X, reality was Y.

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

Name the files and symbols. An RC that says "fixed the auth handling" is a note to
nobody — the next reader needs to know *where* to be careful.

### A near-miss is recorded as caught

An RC found before merge is recorded as **caught**, not re-framed as a failure that
slipped through. A dense ledger is the discipline working, and a project whose
ledger is thin is usually one that stopped filing, not one that stopped diverging.

### Settled conflicts stay settled

**A review finding that reverses an earlier round's change is a divergence, and
gets an RC like any other.** It is not a fix to apply.

When a finding asks you to undo what a previous round did: stop, state both
positions in one line each, and put it to the director. Record the answer here.
Then treat that RC as binding — a later round proposing the same reversal is
answered by citing it, not by re-litigating. Without this, review surfaces with no
memory of each other oscillate, and round N's fix becomes round N+1's finding.

---

## Shapes

**The `K-` shapes live in `.claude/rules/01-known-shapes.md`, not here**, and
that placement is the point: rules load at the start of every session, so the
vocabulary is in context *before* the work — which is the only time a lookout list
helps. They are also shipped prose, refreshed by
`/sixees-workflow:refresh-compound`, so they improve for every repo at once; a copy
in this file would freeze at the day it was seeded. **Do not restate the table here**,
and do not edit the loaded copy — `.claude/rules/` is a materialisation, so a local
change to it is lost at the next refresh. A shape you want changed is a change to the
plugin; a shape that is *yours* goes below.

An entry's `Class:` field cites those ids. Instances are a query, never a list
maintained by hand:

```bash
grep -n '^\*\*Class:\*\* .*K-9' LESSONS.md          # every entry citing K-9
grep -c '^\*\*Class:\*\* —$' LESSONS.md              # entries that matched no shape
```

### A shape this project earned

**A shape seen three times *here* that the loaded table does not name — number it `C1`,
`C2`, …, never `K-`.** Different prefixes so a grep for one cannot match the other,
and so it stays visible which shapes were inherited and which this project paid for
itself. State the rule once, and let the entries cite it; **a heading never owns the
list of its instances**, because that copy goes stale on the next entry and then
reads as the shape being obsolete.

**`—` is a real answer**, and so is a long-empty section: the inherited table is a
wide net. But treat a *run* of `—` as a signal the list is missing something rather than
as a tidy ledger.

**Naming the shape is a step in filing an RC, not a periodic tidy-up** — which is
why the entry format has a field for it. A blank field is a question the filer has to
answer; a paragraph of law is not. Measured once, in the project that wrote this
section: the law was stated and nothing asked the question, so the ledger reached
RC-45 with nine shapes past the threshold, **one** heading written, and one entry
restating an existing class under a new name with its own counter.

---

## RC ledger

> Newest last. Append; never edit an entry once filed. If an RC turns out to be
> wrong, file a new one that says so and cite it.
>
> **Two annotations may be added to a filed entry, and nothing else.** A
> `**Class:**` line, and a `**Mechanism superseded:**` line naming what no longer
> exists at HEAD and the RC that replaced it. Both are **additive** — they sit above
> the body and change no word of it, because the body is the record of what was
> believed, and correcting it in place destroys the only evidence anything diverged.
>
> **The body is frozen; an annotation is maintained.** It points at HEAD, so when HEAD
> moves again the pointer names the newer RC — an annotation that has itself gone stale
> is the defect it exists to prevent.
>
> **The second one is required rather than optional, because an entry's lesson
> outlives its fix and this format states them in one breath.** A reader arriving for
> the durable half is told the mechanism with equal confidence, and a binding entry is
> *cited rather than re-litigated* — so a stale mechanism inside one is the most
> expensive stale prose a repository can hold: the next round is instructed not to
> check it. Append-only and current are in conflict only if rewriting the entry is the
> sole way to correct it.
