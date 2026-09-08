---
id: 019
title: "The JSON arm still sanitises the payload, and the over-cap notice tells the agent to filter on disk rather than ask the API for less"
status: open
severity: P2
tags: [director-decision, middleware-contract, follow-up-to-018]
class-id: broken-contract
source: Director scope call on PR #39, recorded as LESSONS.md RC-49
reviewers: []
created: 2026-09-08
pr: ""
---

# The JSON arm still sanitises, and the over-cap notice misdirects

> **TRIGGER: open this only after PR #39 lands.** The director's instruction on
> 2026-09-08 was follow-up as its own PR, after #39 merges — not folded into it.
> #39 is six commits of narrowing claims with one bot having reviewed the newest
> text; opening an invariant edit inside it is how a fourth review round happens.

## Problem

`LESSONS.md` RC-49 settles what this server is: **middleware.** It exposes cURL to
an agent with buffering and size scaffolding around it. The agent calling a
specific API knows what that API returns and how to handle it, so the payload is
not this server's to sanitise, redact or rewrite in any form. The server owes the
agent three things and no more:

1. confirm the body is JSON;
2. say so plainly when it is not;
3. when the body is too large, **tell the agent to ask the API for less data.**

Two gaps remain against that contract.

### 1. The JSON arm still rewrites the payload

`src/lib/response/processor.ts::defendForInline` routes a JSON document to
`sanitizeAndDetect`, which detects (good — the log is the signal) and then runs
`sanitizeResponse` over it, stripping attack-class codepoints and collapsing
padding runs. So a JSON payload is **not** returned as the origin wrote it, and
`processResponse` has to carry `originBytesExact` and `body_decode_lossy` to keep
the tool's own prose honest about that.

Under RC-49 the sanitise is the part that should go; the **detection must stay**,
because the per-host `[injection-defense]` log is an operator signal rather than a
payload rewrite, and ARCHITECTURE.md invariant 7 is what forbids suppressing it.

Removing it collapses the conditional prose #39 spent two rounds qualifying: the
route sentence's two arms become one, and the contract becomes "we parsed it, it
is JSON, these are the origin's bytes."

### 2. The over-cap notice sends the agent to disk, not back to the API

`savedMessage` currently emits, for a body over the inline cap:

> `…it exceeds the 500000-byte inline limit once the inline defence pass is applied, so no body is returned here.` `Use the jq_query tool on that path to extract fields.`

That is requirement 3 inverted. It tells the agent to filter bytes that already
crossed the wire and hit the disk, instead of narrowing the request — fewer
fields, a `?limit=`, pagination. **And "once the inline defence pass is applied"
names a pass that does not run on a JSON body**, which is a claim about our own
behaviour that is already wrong and gets wronger once item 1 lands.

## Acceptance criteria

- [ ] **The `processResponse` body path** detects without rewriting what it
      returns, so the returned bytes are the origin's decode. The sanitise there
      is `sanitizeAndDetect` at the top of the body path, **above** the
      `classifyBody` fork and assigned straight to `content` — not
      `defendForInline`, which is the post-processor wrap's arm and never sees
      this path. Any normalised value stays internal, for `classifyBody` alone:
      the BOM case in that function's comment is why classification cannot read
      the raw decode.
- [ ] `[injection-defense]` still fires on a JSON body carrying an injection
      phrase — invariant 7 is not weakened by item 1. A regression test pins it.
- [ ] `originBytesExact` and its two-armed route sentence collapse to a single
      claim, or are shown to still be needed and why.
- [ ] `decodeWasLossy` / `body_decode_lossy` **stays.** A lossy UTF-8 decode is
      not a defence pass and item 1 does not touch it.
- [ ] The over-cap notice tells the agent to request less data from the API, and
      stops citing an inline defence pass on the JSON arm.
- [ ] ARCHITECTURE.md invariants 1a and 7 updated to match, since item 1 changes
      what the server claims to be.
- [ ] `docs/custom-tools.md` and `src/lib/types/public.ts` re-checked: they
      describe the published `defendText`, whose pipeline is **unchanged** — only
      the inline JSON arm moves.

## Out of scope

- `defendText`'s non-JSON pipeline. Other consumers of the published API keep it.
- The header channel. It takes every strip stage and that is invariant 1a.
- The non-JSON artefact. RC-47 settled that it takes no strip stage. Note the
  bytes it holds are conditional, not absolute: the save path writes
  `responseBytes` only where `sanitiseWasNoOp`, and the sanitised text otherwise
  — which is exactly what item 1 changes, so the two interact.
- Markdown beacons on the JSON arm. **RC-49 closed that with no trigger** — a
  finding proposing a beacon pass, a trusted-origin gate or mandatory
  spotlighting is answered by citing RC-49, per `.claude/rules/03-divergence.md`.
