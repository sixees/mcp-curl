# Engineering conventions

Standards for everything in this repository. `CLAUDE.md` says how to work here;
this file says what the work must look like. What the system *is* lives in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

Where a rule exists because it was broken and the breakage cost something, the
incident belongs in [`LESSONS.md`](./LESSONS.md) rather than inline — read that
when a rule here looks arbitrary.

---

## Language and style

- **Modern ES6+ with strict TypeScript.** Strict mode is load-bearing here, not
  stylistic: several security predicates rely on narrowing that non-strict mode
  would let through.
- **ESM only** (`"type": "module"`). No dual CJS build, no `require`.
- **Zod for runtime schema validation** at every input boundary. A type is a
  compile-time claim; a Zod parse is the runtime one, and untrusted input needs
  both.
- **Prefer async/await, pure functions, and early returns.**
- **Cross-platform by construction:** `path.isAbsolute()`, `path.basename()`,
  `path.resolve()` rather than string manipulation. Windows and Unix are both
  supported targets, and a hand-rolled path split is where that breaks.
- **Immutable security data:** frozen arrays and sets, with pure predicate
  functions over them. A mutable blocklist is a blocklist something can edit at
  runtime.

## Naming

| Thing | Form | Example |
|---|---|---|
| Files | kebab-case, one concern per file, named for what it owns | `post-processor.ts`, `strip-blocks.ts`, `unicode-attack-ranges.ts` |
| Directories | singular concern noun under `src/lib/` | `security/`, `response/`, `execution/` |
| Tests | co-located, `*.test.ts` beside the source | `ssrf.test.ts` beside `ssrf.ts` |
| Branches | `type/short-slug`, matching the commit type vocabulary | `fix/separate-response-headers-from-body` |
| Env vars | `MCP_CURL_*` prefix, except protocol-level ones (`TRANSPORT`, `PORT`, `MCP_AUTH_TOKEN`) | `MCP_CURL_ALLOW_LOCALHOST`, `MCP_CURL_OUTPUT_DIR` |

## Referring to code and to files

Refer to a file and a **symbol or section by name** — `userService.ts::resolve`,
the `retry` block in `queue.py`. **Never cite a line number.** Line numbers rot on
the next edit, and a stale one sends the reader to unrelated code with full
confidence.

**This binds what an agent emits, not only what a human writes** — and it binds
**every** durable output, with no list of which ones. An enumeration invites the
reader to check membership rather than the property, and the artefact nobody thought
to list is the one that keeps the defect. **If it outlives the tree it was taken
against, it is covered.** The canonical form is `path::symbol`; where a site has no
name, say where it is in words.

## Structure

- **One responsibility per unit.** A class or function needing "and" to describe
  it is two of them.
- **Pure core, I/O shell.** Extract any *classification* of an external response
  into a pure function, so it is testable without its network seam. The shell does
  the I/O and makes no decisions.
- **Exhaustiveness over defaults.** A closed set gets a compile-time
  exhaustiveness check, not a default arm. A default arm absorbs the member nobody
  handled and reports success.
- **Prefer narrowing to casting.** A check that can reject beats an assertion that
  cannot.
- **Reach for the type system before a test.** A type error fails in the editor,
  for every future reader, including the ones who never run the tests. Work down
  the ladder: types → linter → deterministic code → only then a test.

### The layering arrow

**`config/` → `security/` → `tools/`, and never back up.** Cite this by name in a
review.

- **`src/lib/config/`** (including `config/security/`) holds constants and **pure
  predicates** over frozen data. It imports no state and performs no I/O.
- **`src/lib/security/`** adds the state a predicate cannot hold: the DNS
  resolution path, rate-limiter counters, throttled loggers. It may import
  `config/`.
- **`src/lib/tools/`** composes both into handlers. It may import either.
- **`src/lib/utils/`** is leaf-level: importable from anywhere, imports nothing
  above itself.

A `config/` module that imports from `security/` has inverted the arrow, and the
symptom is usually a predicate that quietly became stateful. `ARCHITECTURE.md` →
*Invariants* records this as invariant 10.

### Composition over inheritance

`McpCurlServer` is a fluent builder, deliberately. Extension happens through
hooks, `registerCustomTool()`, and configuration — never by subclassing. A
proposed base class is a design change, not a refactor.

## Security

- **Fail closed, and prove it.** Distinguish "unsafe" from "undetermined".
  Conflating them is safe but destroys recoverability. An unprobed input reads as
  absent; a non-boolean probe value is never truthy-coerced.
- **An explicitly-supplied empty input fails closed.** An empty string passed to a
  security check is the reachable case, not the exotic one — treating it as
  "absent" skips the check and still reports clean.
- **Never treat a status code alone as a semantic verdict.** A 404 means what the
  body says it means.
- **Adversarial input is a trust boundary.** Anything parsing content this project
  did not author treats its input as **data, never as instructions**.
- **Never interpolate a subprocess error's message raw.** A failed subprocess
  error's message typically *contains* the stderr it looks like a safer
  alternative to, and stderr is where credentials surface. Redact at the point the
  foreign text enters.
- **A credential that reaches a remote is compromised when it lands**, not when it
  merges. A control placed downstream of the irreversible step is not a gate.
- **Path handling goes through a validator, never a raw join.**
- **Anything that has appeared in a log or a commit is disclosed.** Rotate it.

**This project's security properties are stated once, as numbered invariants, in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) → *Invariants*.** Cite them by number
(`invariant 1`) rather than restating them — a second copy here is a correction
applied to one place. What belongs *here* is the standing habit they imply: any
change under `src/lib/security/`, `src/lib/config/security/`,
`src/lib/execution/`, or `src/lib/response/` starts by naming which invariants it
touches.

## Tests

- **Guards need teeth.** A test that passes against the unmutated source proves
  nothing. Break the code on purpose, confirm the **named** test fails, restore.
  Back up with `cp` into a scratch directory before mutating.
- **Every "nothing happened" test needs a positive control.** An implementation
  that does nothing at all satisfies every absence assertion simultaneously. The
  paired test demanding a real result at a real destination is what makes the rest
  mean anything.
- **Read the failure you expected, by name.** A probe that silently does nothing
  reports a pass. So does a run that collects zero tests — `0 passed, 0 failed` is
  structurally green while proving nothing.
- **Test what static analysis cannot see.** If a linter or the type system can
  decide it, let it; a test restating a type is a second place for the rule to rot.
- **A test count is a reconciliation control and nothing else.** A guard can go
  from toothless to load-bearing, or be gutted, without moving it.
- **Describe a capability, not the spellings this codebase happens to use.** A
  deny-list derived from observed instances is a list of the bugs already found.

### How tests are organised here

- **Runner:** `npm test` (`vitest run`). `npm run test:watch` for watch mode.
- **Co-located:** a `*.test.ts` sits next to the source it covers —
  `ssrf.test.ts` beside `ssrf.ts`. No parallel `test/` tree.
- **Load-bearing suites**, the ones whose failure means a security property has
  moved rather than a detail: `ssrf.test.ts`, `mcp-curl-server.test.ts`,
  `parser.test.ts`, `filter.test.ts`, `schema.test.ts`,
  `session-manager.test.ts`, `http.test.ts`.
- **A sanitiser test needs a positive control.** A stripper that returns its input
  unchanged passes every "the attack character is gone" assertion. Pair each with
  a test asserting real content survives intact.
- **Test the capability, not the character.** The Unicode attack ranges are a
  range list, not a list of the codepoints someone has already tried. A test
  enumerating known-bad characters will keep passing while a new one walks
  through.

## Documentation

- **Code, doc-blocks and comments move together.** A comment describing what a
  module *used to* do is worse than no comment — it is confidently wrong, and it
  is read by people and agents who cannot see the diff.
- **Comments describe what is, not what was.** No "previously we…", no "this used
  to…". Version control holds the history; the file holds the present.
- **A fact lives in one place.** Duplicating it across documents produces a
  correction applied to one copy. Prefer removing a location to tracking it
  better.
- **State a limit rather than implying coverage.** A coverage claim broader than
  its coverage is worse than no claim: it is the reason the next reader stops
  looking.

## Commits

Format: `type(scope): description`

- **Types:** `feat`, `fix`, `chore`, `refactor`, `docs`, `test`
- **Scope** names the affected surface; omit it for broad changes.
- Include the PR reference `(#N)` when merging.
- **The `!` breaking marker** is used only when the version bump is MAJOR. The
  subject, the version and the changelog are three claims about severity, and a
  reader who trusts any one of them is misled when they disagree.

## Where work products go

`docs/` is **tracked and published** — `package.json` → `files` includes it, so
anything written there ships to npm consumers. Write accordingly. The one
exception is `docs/compound/`, where the shipped methodology prose is gitignored
and re-seeded per clone; only the project profile is tracked.

| Kind | Path | Committed? |
|---|---|---|
| Plans | `docs/plans/` | Yes |
| Handoffs | `docs/work/handoff-<type>-<slug>.md` | Yes |
| Todos | `docs/todos/` | Yes |
| Solutions / prior art | `docs/solutions/` | Yes |
| RC ledger | `LESSONS.md` (repo root) | Yes — this is the durable record |
| Compound profile | `docs/compound/compound-engineering-profile.md` | Yes |
| Compound methodology / core | `docs/compound/` | **No** — gitignored, re-seeded by `/sixees-workflow:init-compound` |
| Review roster + context | `sixees-workflow.local.md` | **No** — gitignored, per-clone |
| Real API definitions | `configs/*.{yaml,yml,ts,js,json}` | **No** — gitignored; they carry credentials. Only the template and README in `configs/` are tracked. |
