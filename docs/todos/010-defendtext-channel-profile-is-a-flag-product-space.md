---
id: 010
title: "defendText's channel profile is a boolean product space each caller picks for itself"
status: open
severity: P2
tags: [architecture, security, pre-existing]
class-id: misplaced-decision
aliases: [duplicated-logic]
source: /simplify altitude lane (architecture-strategist), 2026-09-03
reviewers: [architecture-strategist]
created: 2026-09-03
---

# defendText's channel profile is a flag product space

## Problem

`DefendTextOptions` carries four independent selectors — `contentType`,
`contentTypeUndetermined`, `excludeJsonDocuments`, `decodeEntities`. Five
production call sites use four combinations, but only **three channel profiles
actually exist**: persisted body, inline, diagnostic.

The valid combinations are a small subset of the type's inhabitants, and nothing
marks the boundary. A sixth channel — a `verbose` transcript, a future diagnostic
string — written as `defendText(text, { contentType: undefined, contentTypeUndetermined: false })`
typechecks, passes review as *"it calls `defendText`"*, and gets Step 2 alone:
`isMarkup` false, `isMarkdown` false, `sniffedAsMarkup` false, so `needsStripPath`
is false and Steps 3–5 are skipped. **That is precisely the defect invariant 1a
was written after (RC-1), reachable again today.**

Concrete now rather than hypothetical: the diagnostic profile (`MARKDOWN_MIME`,
`contentTypeUndetermined: false`, `decodeEntities: false`) is spelled by hand in
two files — `response/header-channel.ts::extractHeaderChannel` and
`tools/curl-execute.ts::executeCurlRequest`. Change one and the header channel and
the stderr channel diverge with nothing erroring.

## Evidence

`rg -n 'defendText\(' src -g '!*.test.ts'` — 5 production call sites, 4 distinct
option sets, 2 sites sharing one set verbatim (`header-channel.ts` ~109-114 and
`curl-execute.ts` ~252-257).

## Relationship to RC-12

RC-12 named **one coordinate** of this space (`decodeEntities`, K-13) and it is
open as `docs/todos/004`. This todo is the *shape*, not that trade — it does not
re-litigate which way `decodeEntities` should go, and closing it must not.

## Why this is filed rather than fixed

Medium refactor across five call sites in the four invariant-carrying directories.
`/simplify` applies no fix that reshapes a defence's API.

## Fix

Rung 1 — name the channels. A closed set in `response/` — `PERSISTED_BODY`,
`INLINE`, `DIAGNOSTIC` — with the option matrix stated once and an exhaustiveness
check per `CONVENTIONS.md` → *Structure* ("exhaustiveness over defaults"). Add
`defendChannel(text, channel, meta)` and route all five sites through it.
The wrong combination then is not constructible and the diagnostic profile has
one spelling.

**`meta` is not optional, and a `(text, channel, hostname)` signature is the trap.**
`PERSISTED_BODY` is the only channel whose options are not fixed: `processResponse`
passes the origin's `contentType` and `contentTypeUndetermined` straight through
(`processor.ts:549-551`), and those two select the grammar and the JSON exemption —
i.e. which strip stages run. A channel-only profile cannot express that call, so
routing it through one would silently change what gets stripped. The channel fixes
the *policy* fields (`excludeJsonDocuments`, `decodeEntities`); the per-response
content-type metadata still travels with the call.

**Additive only.** `defendText` and `DefendTextOptions` are exported from
`src/lib.ts` §7 — adding `defendChannel` alongside is MINOR; removing or
narrowing the option bag would be MAJOR, so do not do that as part of this.

## Acceptance criteria

- [ ] A profile-table test asserts each named channel produces its documented
      option set.
- [ ] A regression test asserts `header-channel.ts` and the stderr path produce
      byte-identical output for identical input — currently true only by
      coincidence of two hand-written literals.
- [ ] `defendText`'s option bag remains exported and unnarrowed.
- [ ] `docs/todos/004` is untouched — this change is profile-neutral.
