---
status: pending
effort: s
tags: [code-review, security, documentation, defaultHeaders, baseUrl, changelog, getting-started]
dependencies: []
---

# Credential guidance places a key in a header sent to every host, and does not say so

## Problem Statement

The 5.1.0 CHANGELOG *Notes* say "`baseUrl` … is a convenience, not a security boundary … Keep a credential in `defaultHeaders`, never in tool-call arguments." It drops the reason `docs/configuration.md` gives ("so it stays out of the transcript"). The advice then reads as the remedy for the cross-host risk in the sentence before it. It is not: `defaultHeaders` is merged into every request whatever its host. The new getting-started example also puts a bearer token in `defaultHeaders` with no caveat. If a remote response injects the model, the model can send `curl_execute` to an attacker host, and the key goes with it.

**Settled, not reopened:** the plan declined pinning absolute URLs to the `baseUrl` origin (plan → *Declined and deferred*, operator Q1). This todo is about the docs saying accurately where the header goes, not about changing that behaviour.

## Findings

- class: security guidance recommends a credential placement that is added to every outbound request, whatever the destination, without saying so, while the request target stays model-chosen.
- instances:
  - `CHANGELOG.md::[5.1.0] Notes`: in this diff; it drops the transcript reason. **confirmed**
  - `docs/getting-started.md::Reporting a configuration error`: in this diff; bearer token in `defaultHeaders`, no caveat. **confirmed**
  - `docs/configuration.md::baseUrl`: same advice, pre-existing (#46). **confirmed, out of scope sibling**
  - `README.md::Library usage example`: pre-existing. **confirmed, out of scope sibling**
  - `src/lib/extensible/instance-utilities.ts::executeRequest`: the same any-host merge on the `utilities()` path, which runs no hooks. **confirmed, out of scope sibling (code)**
- sweep: `rg -n defaultHeaders src/lib docs README.md` → 9 non-test candidates. 2 are code merge sites (both any-host), 4 are doc sites that recommend credentials (2 in this diff), and the rest are type or schema declarations.
- root: the documentation. The any-host merge in `src/lib/extensible/tool-wrapper.ts::applyConfigTransformsCurl` is existing, settled behaviour.
- Found by: security-sentinel (`leaked-secret`, P2, CWE-522/CWE-201), Surface 2 review, 2026-10-26.

## Proposed Solutions

### Option 1: One owner for the statement (reviewer's fix)
State in `docs/configuration.md` → *defaultHeaders* that the headers go to every host the model names. To scope a credential to the base origin, add it in a `beforeRequest` hook only when the final URL's origin equals the `baseUrl` origin; `utilities()` callers scope at the call site. The CHANGELOG note and getting-started cite that, and the CHANGELOG restores "so it stays out of the transcript".
- Pros: accurate; one spelling of the fact.
- Cons: touches a third doc.

### Option 2: Minimal wording fix in this diff only
Restore the transcript reason in the CHANGELOG note and add one line to the getting-started example.
- Pros: smallest.
- Cons: leaves `docs/configuration.md` and `README.md` silent on where the header goes.

## Recommended Action

_Operator to choose._ Population: internal team embedders whose sessions read untrusted remote content, which is the inbound threat `.sixees/ARCHITECTURE.md` defends against. A per-origin credential option in code would be a separate design decision.

## Acceptance Criteria

- [ ] The CHANGELOG 5.1.0 note no longer presents `defaultHeaders` as a host-scoping control; it states the transcript reason.
- [ ] Wherever the docs recommend `defaultHeaders` for a credential, they say once (with one owner) that it is sent to every host.

## Work Log

### 2026-10-26 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** Filed from `/sixees-workflow:review` inside `/sixees-workflow:work` PR-4 (`docs/release-5.1.0`). Cross-checked against the plan's declined origin-pin entry so the settled decision is not reopened.
**Learnings:** Compressing a "do X, so Y" rule into a release note dropped its reason, and changed what the rule appears to claim (K-22).
