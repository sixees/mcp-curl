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

**`CONVENTIONS.md` → *Where work products go* owns this table**, including which
paths are committed and which are gitignored. It is not restated here: two copies
of a path table produce a correction applied to one of them.

The one path this file must state, because it is the file: this profile lives at
`docs/compound/compound-engineering-profile.md`, and it is the sole tracked
exception inside an otherwise-ignored `docs/compound/`.

Handoffs follow `handoff-<type>-<slug>.md`; the reuse-scan scope for a Step 2
audit is `src/lib/utils/`, `src/lib/config/` (incl. `config/security/`),
`src/lib/types/` and `src/lib/security/`, then the sibling module the change is
about to duplicate.

## 3. Stack

> Drives what **Surface 3** is expected to catch.

**The stack table lives in `docs/architecture/architecture.md` → *Stack &
Distribution*, and the numbered invariants in `ARCHITECTURE.md`.** Neither is
restated here. What this section adds is the part those documents do not carry —
what the risk surface means *for review*:

- **Outbound request surface.** This process makes attacker-influenced HTTP
  requests. SSRF, DNS rebinding, protocol smuggling and local-file exfiltration
  via cURL argument shaping are the top risks.
- **LLM trust boundary.** Every byte returned to the model is attacker-controlled.
  Prompt injection, Unicode homoglyph and invisible-character attacks, and
  markup-embedded beacons are in scope. **Any new text channel is a new instance
  of this surface** — see invariant 1a, which exists because one was added.
- **Subprocess boundary.** `spawn()` without a shell, allowlisted command. Any
  change here is a command-injection surface.
- **Published API.** Four npm entry points that consumers pin to. Type and
  behaviour changes are wire contracts.
- No PII, no multi-tenancy and no money handling in this repo — but a downstream
  consumer may route any of the three through it, which is why response-side
  defence is treated as a hard boundary rather than a convenience.

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
- **Branch protection / required checks:** work happens on feature branches off `main`; PRs go to `main`, which **is** protected. Verified against the API on 2026-09-01 rather than assumed:
  - **1 approving review required**, and `require_code_owner_reviews` is on — though there is no `CODEOWNERS` file, so that clause is currently vacuous.
  - **Signed commits required** (`required_signatures`), and they verify.
  - **Pushes restricted** to `jpdippenaar` and the `fe-admin` team; `main` cannot be deleted.
  - `enforce_admins` is **off**, so an admin can bypass all of the above. That is the escape hatch to watch: a string of admin overrides is how a required-review rule becomes decorative. Use of `--admin` is a recorded decision, not a routine step.
  - Checks configured on PRs: CodeQL, `Analyze (javascript-typescript)`, CodeRabbit.

  > **This section previously stated that no branch protection was configured. That was wrong**, and it was written from assumption rather than from the API. It also made this tracked file assert a weaker security posture than the repository actually has — the kind of claim an attacker reads and a maintainer trusts. Check the API when this is next reviewed.
- **Accepted merge gate:** GitHub requires **one approving review**, so a separate human approver *is* required in practice — the earlier claim that it was not was based on the mistaken branch-protection reading above. Bot review (Surface 3) plus explicit human authorisation is the intended posture; the approving review is how GitHub enforces it. If a PR carries an unresolved Surface 3 finding on a high-surface trigger from §7, that is the moment to reconsider it for that PR specifically.
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
