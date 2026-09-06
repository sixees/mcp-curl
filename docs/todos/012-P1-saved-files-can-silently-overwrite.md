---
id: 012
title: "Saved response files have no uniqueness constraint and are written with a plain overwrite"
status: open
severity: P1
tags: [data-integrity, pre-existing, worsened-by-008]
class-id: missing-constraint
source: /sixees-workflow:work review round on fix/over-cap-preview-computed-then-discarded (data-integrity-guardian)
reviewers: [data-integrity-guardian, performance-oracle]
created: 2026-09-06
---

# Saved response files can silently overwrite each other

## Problem

A saved response's identity is `${safeName}_${Date.now()}.txt` and the write is
non-exclusive, so two saves that resolve to one path leave the second silently
replacing the first — with **both callers holding the same filepath** and no
error on either side.

Three things compound:

- **The query string is never part of the name, at any length.**
  `saveResponseToFile` passes `urlObj.hostname + urlObj.pathname`, and WHATWG
  `URL.pathname` excludes `?search` entirely — so two URLs differing only in
  their query always collide, whether the path is 5 characters or 500.
- `createSafeFilenameBase` maps every non-alphanumeric to `_` and slices to
  `LIMITS.FILENAME_MAX_LENGTH` (50), which is a **second, independent** collision
  source for long paths. It is not the cause of the query-string case.
- `Date.now()` is millisecond resolution.
- `writeFile` carries no `flag: "wx"`, so an existing path is overwritten rather
  than refused.

## Evidence

Measured, not argued:

```
new URL("https://api.example.com/items?page=1").hostname + .pathname
  -> api.example.com/items          (21 chars — nowhere near the 50 cap)
new URL("https://api.example.com/items?page=2").hostname + .pathname
  -> api.example.com/items
IDENTICAL: true
```

**Corrected 2026-09-06.** The first version of this block measured
`createSafeFilenameBase(url)` directly and recorded a base beginning `https___`
— reachable only through the `catch (error instanceof TypeError)` fallback for
an INVALID URL, which the real path never takes. It therefore recorded
truncation-to-50 as the mechanism. That is wrong in a way that matters: an
implementer raising `FILENAME_MAX_LENGTH` to 200 would re-run the old
measurement, see two distinct bases, and close this P1 with the defect live.

- `src/lib/response/file-saver.ts:92` — `` const filename = `${safeName}_${Date.now()}.txt`; ``
- `src/lib/response/file-saver.ts:95` — `writeFile(filepath, content, { encoding: "utf-8", mode: 0o600 })`, no flag
- `src/lib/response/file-saver.ts:30` — `base = base.slice(0, LIMITS.FILENAME_MAX_LENGTH)`
- `src/lib/config/limits.ts:71` — `FILENAME_MAX_LENGTH: 50`
- `src/lib/tools/jq-query.ts:150,154` — the same construction and the same non-exclusive write

An agent batching two `curl_execute` calls in one turn — `?page=1` and `?page=2`
— that both go over cap and complete in the same millisecond gets one file. Note
the two conditions are independent: the identical base holds always, and only
the millisecond collision is a race. The
first caller's `jq_query` on its own filepath returns the second caller's body,
reported as its own.

## Why it is P1 here rather than P2

`data-integrity-guardian` graded it P2 and named the tension explicitly: an
unguarded reachable path to corrupt persisted state is P1 by its own anchor, and
it defaulted down only because the collision needs a same-millisecond
coincidence — *"if concurrent tool calls are normal in the deployment, this is
P1."*

**They are normal.** This server's consumers are an orchestrated internal agent
fleet, and parallel tool calls in a single turn are ordinary for those clients.
The operator confirmed the grading when this was escalated.

## What the 008 branch changed about it

Nothing in `file-saver.ts` — but it removed the **detectability**. Before that
branch, an over-cap response returned a defended preview of its own body, so a
caller receiving another request's file had a copy of what it should have got.
`ProcessedResponse`'s saved arm now carries no `content` at all, so a
substitution presents as a perfectly ordinary success.

Recorded because it changes the priority, not the mechanism: the branch was
right to remove the preview (`LESSONS.md` RC-28) and this is the consequence to
close separately.

## Fix

One shared helper beside `createSafeFilenameBase`, called from both save sites:

```ts
await writeFile(path, content, { encoding: "utf-8", mode: 0o600, flag: "wx" });
```

retrying with a fresh suffix on `EEXIST`; or replace `Date.now()` with
`randomUUID()`. **`flag: "wx"` is the load-bearing half** — it converts a silent
overwrite into an error, which is the property the naming scheme cannot provide.
Put it in `file-saver.ts` and have `jq-query.ts` import it, so no future save
site has to remember: there are two sites today with the same shape, which is
`02-reuse-first`'s condition for extracting rather than patching.

## Acceptance criteria

- [ ] Two concurrent saves of **two URLs differing only in their query string**
      (`?page=1` / `?page=2`), with `Date.now` stubbed to a constant, produce two
      distinct paths with both files' bytes intact. Stated this way and not "the
      same URL" because the same-URL case is the narrower one — the query-string
      case is what an agent paginating an API actually produces, and a fix that
      only lengthens the filename passes the same-URL test and fails this one.
- [ ] `jq_query`'s save path takes the same helper — asserted, not assumed.
- [ ] A collision surfaces as an error rather than as a successful overwrite.
