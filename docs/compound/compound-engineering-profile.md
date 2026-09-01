---
title: "Compound Engineering — Project Profile (mcp-curl)"
purpose: instantiates the portable methodology for one project; copy to compound-engineering-profile.md and fill in
reference: compound-engineering-methodology.md
core: compound-engineering-core.md
status: active
last_updated: 2026-09-01
---

# Compound Engineering — Project Profile: mcp-curl

This file instantiates the [Compound Engineering Methodology](compound-engineering-methodology.md) for **mcp-curl** — an MCP server (and embeddable TypeScript library) that lets LLMs execute cURL requests behind an SSRF-hardened, sanitising trust boundary. It supplies the parameters the portable reference deliberately leaves open.

> **How to use.** The reference explains *why*; the core (`compound-engineering-core.md`) is injected per plan/PR; this profile is the *where and what* for this repo. When the core says "roster in profile" or "unit declared in the profile," this is the file it means.

## 1. RC numbering

- **Counter origin:** RC-1. (RCs are sequential, claimed at the time, durable once assigned.)
- **Unit of the trail:** **per project** — one continuous RC sequence across the whole mcp-curl repository. This is a single-purpose library; a per-feature counter would fragment a trail that is more useful read end to end.
- **RCs documented in:** `docs/work/handoff-*.md`, inline beside the work each RC corrected — **and appended to `LESSONS.md` at the repo root**, which is the durable ledger. A handoff is read once by the run that wrote it; `LESSONS.md` is what the next session reads.
- **POST-AUDIT annotations in:** `docs/plans/*.md`, one line at the diverging section, pointing at the RC. Original plan text stays intact.

## 2. Path conventions

| Artifact | Location |
|---|---|
| Plans (master / deep) | `docs/plans/` |
| Per-PR handoffs | `docs/work/handoff-<type>-<slug>.md` |
| Solutions / decision records | `docs/solutions/` |
| Deferred-work todos | `docs/todos/` |
| Contributing guide (records the RC convention) | `CONVENTIONS.md` (this repo has no `CONTRIBUTING.md`; conventions live at the root) |
| This profile | `docs/compound/compound-engineering-profile.md` |
| Shared/reusable code (reuse-scan scope) | `src/lib/utils/`, `src/lib/config/` (incl. `config/security/`), `src/lib/types/`, `src/lib/security/` — a Step 2 reuse audit looks here first, then at the sibling module it is about to duplicate (`src/lib/response/`, `src/lib/execution/`, `src/lib/jq/`, `src/lib/schema/`) |

## 3. Stack

> Drives what **Surface 3** is expected to catch.

- **Languages / frameworks:** TypeScript 5.5 (strict, ESM, `"type": "module"`) on Node 22 types · Model Context Protocol SDK (`@modelcontextprotocol/sdk` ^1.29) · Express 4 for the HTTP transport · Zod 4 for runtime validation · `js-yaml` for the YAML schema system · built with `tsup`, tested with `vitest`
- **Datastores:** none. State is in-process only — session map (HTTP transport), rate-limiter counters, memory tracker, and a managed temp directory on local disk for saved responses.
- **Platform / cloud:** none deployed by this repo. Ships as an npm package (`mcp-curl`) with a `curl-mcp` bin; runs on the operator's machine over stdio, or as an Express HTTP/SSE server the operator hosts.
- **Other surfaces of risk:**
  - **Outbound request surface** — this process makes attacker-influenced HTTP requests. SSRF, DNS rebinding, protocol smuggling, and local-file exfiltration via cURL argument shaping are the top risks.
  - **LLM trust boundary** — every byte returned to the model is attacker-controlled. Prompt injection, Unicode homoglyph/invisible-character attacks, and markup-embedded beacons are in scope.
  - **Subprocess boundary** — `spawn()` without a shell, compile-time and runtime command allowlist; any change here is a command-injection surface.
  - **Local filesystem** — `jq_query` reads saved files; path traversal, symlink escape, and output-directory scope are enforced rather than assumed.
  - **Published API** — this is a library other people import. Type and behaviour changes are wire contracts.
  - No PII, no multi-tenancy, no money handling in this repo itself — but a downstream consumer may route any of the three through it, which is why response-side sanitisation is treated as a hard boundary rather than a convenience.

## 4. Surface 3 — bot-reviewer roster

> The independent bots configured on this repository.

- **Configured reviewers:** CodeRabbit (`.coderabbit.yaml`), GitHub Copilot review (`.github/copilot-instructions.md`), Codex Code Review.
- **Stack-specific things Surface 3 should hunt for:**
  - **TypeScript / Node** — type narrowing that compiles but misbehaves at runtime; unawaited promises and async races (notably around `spawn`, DNS resolution, and stream draining); `any`/assertion escapes that defeat strict mode; ESM vs CJS interop and extension-resolution slips; Zod schema drift where the inferred type and the runtime parse disagree.
  - **Security-critical, this repo specifically** — regex predicates that a crafted input can bypass (SSRF host/IP matching, injection detection, markup stripping); ReDoS in the strip/sanitise loops; sanitisation applied to a copy while the original is what gets returned; new tool-result paths that skip the `post-processor` wrap; error messages that leak a URL, token, or filesystem path.
  - **Cross-stack** — resource-limit enforcement that is checked but not applied; partial-failure handling around the child process; cache/limiter state that leaks between sessions; documented behaviour drifting from actual behaviour (README, `docs/`, and `CLAUDE.md` all describe security guarantees that must stay true).

## 5. Surface 2 — specialist-agent roster

> The local specialist agents available pre-push, and how they're invoked.

- **Available specialists:** `architecture-strategist`, `code-simplicity-reviewer`, `data-integrity-guardian`, `pattern-recognition-specialist`, `performance-oracle`, `security-sentinel`, `typescript-reviewer`.
- **Invocation:** `/sixees-workflow:review` runs the roster in parallel against the diff vs `main` before push; `/sixees-workflow:work` runs its auto-review over the same diff. The per-clone roster actually dispatched lives in `sixees-workflow.local.md` (gitignored), which this profile does not read and is not read from.
- **Standing instruction:** always include an adversarial enumeration pass ("show me every site that uses this pattern") — the PR's framing is not the audit boundary. For this repo that means, in particular: every path that returns bytes to the LLM, and every path that builds cURL arguments.

## 6. Surface 1 — implementation-time norms

- **In-implementation specialists to invoke on specific commit types:**
  - `security-sentinel` on any commit touching `src/lib/security/`, `src/lib/config/security/`, `src/lib/execution/`, or the transports' auth path.
  - `typescript-reviewer` on any commit that changes an exported type or a Zod schema.
  - `architecture-strategist` on any commit that adds a module under `src/lib/` or changes what `src/lib.ts` exports.
  - `performance-oracle` on any change to the strip/sanitise fixed-point loops or the jq engine, where a bounded loop is the ReDoS defence.

## 7. High-surface-area triggers (always use all three surfaces)

> The change categories that, for THIS project, always warrant the full three-surface review.

- **SSRF and network-boundary code** — `src/lib/security/` (DNS resolution, SSRF validation, rate limiter), `src/lib/config/security/` (blocked IP/hostname sets, URL-scheme allowlist), and anything altering the `--resolve` IP pinning.
- **Sanitisation and injection defence** — `src/lib/response/post-processor.ts`, `strip-blocks.ts`, `src/lib/utils/sanitize`, and any new code path that produces a tool result. The wrap is the trust boundary; a path that bypasses it is a vulnerability regardless of intent.
- **cURL execution and argument building** — `src/lib/execution/` — the command allowlist, the args builder, and anything that shapes the spawned process.
- **Public API / contract changes** — exports from `src/lib.ts`, the `McpCurlServer` builder surface, the YAML schema shape, and tool input schemas. Downstream consumers pin to these.

Low-surface-area work (single-file refactor with no contract change, docs-only, one-line fix) may compress to one or two surfaces.

## 8. Authorisation gates / merge policy

> The control points where the human director authorises irreversible transitions.

- **Transitions requiring explicit human authorisation:** **push and merge**. The agent may commit freely on a feature branch, but stops before pushing and again before merging, and waits. Committing locally is reversible; publishing to the remote and merging to `main` are not.
- **Branch protection / required checks:** work happens on feature branches off `main` (current: `fix/separate-response-headers-from-body`); PRs go to `main`. No required-status-check or required-review rule is configured on the repository — the gate is procedural, recorded here, rather than enforced by GitHub. If branch protection is added later, record it in this section rather than relying on memory of the change.
- **Accepted merge gate:** bot review (Surface 3) **plus explicit human authorisation IS the accepted gate — no separate human approving reviewer is required.** This is a deliberate decision for a small team on a library with strong automated coverage, not an accumulated habit. If a PR carries an unresolved Surface 3 finding on a high-surface trigger from §7, that is the moment to reconsider it for that PR specifically.
- **Findings-before-merge:** Surface 3 findings are brought back to the director with a disposition for each (fixed / declined-with-evidence / deferred-with-trigger) before merge is authorised. Never merge-on-green. No project-specific exceptions.

## 9. Case-study appendix

> Starts **empty**. As handoffs accrue, promote generalisable findings here — each a short, named lesson grounded in a specific PR. These are this project's evidence; the portable reference holds none. A finding observed independently in more than one project becomes a candidate for promotion into the shared reference's failure-mode taxonomy. Promote only genuinely generalisable lessons: a near-miss the process caught pre-merge is the discipline working, not automatically a case study. Reserve entries for findings that taught something new, so the appendix stays a teaching record rather than a catalogue of every routine catch.

_(none yet)_

<!--
Template for an entry:

**CS-N — <one-line lesson>.** <PR/handoff reference.> What happened, which
surface caught it (or should have), and the generalisable principle. Keep it
short; the full disposition lives in the handoff.
-->
