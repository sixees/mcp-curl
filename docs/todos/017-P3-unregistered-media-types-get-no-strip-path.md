---
id: 017
title: "An unregistered media type gets no strip path, and the predicate's doc-block claims it does"
status: open
severity: P3
tags: [code-review, security, pre-existing, published-contract]
class-id: fail-open-default
source: /sixees-workflow:review of PR #37 (Surface 2, round 5, security-sentinel + typescript-reviewer)
reviewers: [security-sentinel, typescript-reviewer]
created: 2026-09-07
---

# An unregistered media type gets no strip path

## Problem

`utils/content-type.ts::isSniffableContentType` falls through to
`isBinaryContentType` for any media type in neither its exact sets nor its prefix
list. For `application/yaml`, `foo/bar` or any unregistered `application/*` that
answers `false`, so `needsStripPath` is `false` in `defendText` and **only Step 2
runs**. The absence of a matching arm resolves to no defence rather than to the
strictest one.

**The doc-block claims the opposite**, naming the very type it excludes:

> Deliberately broad — covers any CT where mis-labelled markup is plausible
> (`text/csv`, `text/javascript`, `application/yaml`, …), so mislabelling the
> response cannot bypass the markup-strip path.

`processor.test.ts` has a case titled *"strips `<script>` served as
application/yaml"* which asserts the **opposite of its own title** and documents
the behaviour as deliberate. Two reviewers found this independently in the same
round.

## Findings

Measured on the published `defendText` at HEAD, one body, `contentTypeUndetermined: false`:

| declared type | `<script>` | `<!-- -->` |
|---|---|---|
| `text/plain` | stripped | stripped |
| `text/csv` | stripped | stripped |
| `application/yaml` | **LEAKED** | **LEAKED** |
| `foo/bar` | **LEAKED** | **LEAKED** |
| `application/x-custom` | **LEAKED** | **LEAKED** |

Identical at `5adb7d3` and `f8f1d76` — **byte-identical at base, so PR #37
neither created nor worsened it.**

- `src/lib/utils/content-type.ts::isSniffableContentType` — the fall-through, and
  the doc-block naming a type it excludes — confirmed
- `src/lib/response/processor.ts::defendText` — the consumer with no arm for the
  case — confirmed
- `src/lib/response/processor.test.ts` — the case asserting the opposite of its
  title — confirmed

## Why it is P3 and not higher

**Via this repository's own tools there is no reachable source.** The
post-processor wrap's `defendForInline` is unconditionally strict, and end to end
through the shipped binary `application/yaml` and `foo/bar` came back stripped at
all three refs, 0 `wrap-error` lines. The persisted artefact keeps origin grammar
by design.

The only reachable source is the **published library boundary** — `defendText`
has been exported since 3.4.0, so `ARCHITECTURE.md` invariant 11 makes it a
public contract, and a consumer handing it a remote-supplied `application/yaml`
gets markup back.

## Why this was filed rather than declined

The round's instruction was to decline an out-of-scope P3, and this is out of
scope: `content-type.ts` is not in PR #37's diff and the behaviour is
byte-identical at base. **Filed anyway, and the departure is deliberate**: it is a
fail-open on a published contract, which `.claude/rules/04-no-instance-literals.md`
treats as a safety property rather than a preference, and the doc-block actively
asserts coverage it does not have — so the next reader who trusts it is misled.
A decline recorded only in a review report expires; this does not.

What PR #37 *did* do is close two of the three absences and document the
disjunction as **the** fix for "no usable declared grammar", which makes the
remaining one read as covered.

## Proposed solutions

1. **Invert the final arm** so an unrecognised media type is sniffable rather than
   not — the same fail-closed reasoning `defendText`'s destructuring default
   already applies to `contentTypeUndetermined`. One edit at the layer every
   consumer routes through. Cost: bodies with exotic-but-legitimate types get the
   sniffer, which is a cost only where the sniffer's shape test fires.
2. **Correct the doc-block only**, and record the residual. Cheapest; leaves the
   published contract fail-open.
3. **Enumerate the closed set both directions** per
   `04-no-instance-literals.md` — a member with no handler and a handler with no
   member each a named failure. Largest change, and the only one that stops the
   next type drifting out of coverage.

## Acceptance criteria

- [ ] `isSniffableContentType("application/x-unregistered")` is `true`.
- [ ] `defendText` with an unregistered type and `contentTypeUndetermined: false`
      strips `<script>` and `<!-- -->`.
- [ ] The `application/yaml` test's title and its assertion agree.
- [ ] The doc-block's claimed coverage matches the code's actual coverage.
- [ ] Teeth probed: restoring the current fall-through fails both new cases.

## Work log

- 2026-09-07 — filed from PR #37 review round 5. Out of scope for that branch;
  filed rather than declined for the reason stated above.

## Resources

- `ARCHITECTURE.md` invariant 1a (the attacker-controllable-gate failure shape),
  invariant 11 (published entry points).
- `LESSONS.md` RC-1 rule 2 — *"'undetermined' and 'absent' must not resolve the
  permissive way."*
