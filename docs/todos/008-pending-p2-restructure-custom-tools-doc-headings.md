---
status: pending
priority: p2
issue_id: 008
tags: [code-review, architecture, documentation]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Restructure `docs/custom-tools.md` "Sanitizing External Tool Metadata" before PR-5/PR-7

## Problem Statement

PR-1 added two H3 subsections under `## Sanitizing External Tool Metadata`:

- "Validating URL parameters" (lines 116-138)
- "Replicating the response-side defence" (lines 140-176)

Neither is strictly *metadata* sanitisation — URL validation is input validation; response-side defence is output sanitisation. The H2 heading is misleading. PR-5 (B4) will edit the field-description-sanitisation example; PR-7 will add an HTML/markdown-stripping subsection; PR-8 may reference homoglyph normalisation. By PR-7 this single H2 will hold ≥5 different concerns. Discoverability degrades; commit messages, README anchors, plan documents grow stale.

## Findings

- **File:** `docs/custom-tools.md:88-176`
- **Reviewer (Architecture, A3):** "cheap to do *now* — one H2 split — but expensive to do later."

## Proposed Solutions

Restructure into three H2 sections:

- `## Validating External Inputs` (URLs, schema descriptions on registration; absorbs current "Sanitizing External Tool Metadata" content)
- `## Sanitizing External Outputs` (response text, hook-returned text, custom tool output)
- `## Composing the Full Defence` (canonical `wrapWithDefence` example, once PR-6b lands)

Add a one-line "When to use which helper" table at the top of each section. PR-5/PR-7/PR-8 then add subsection content without re-litigating heading taxonomy.

## Acceptance Criteria

- [ ] H2 headings restructured per the proposal above
- [ ] All existing PR-1 content preserved (URL validation, response-side defence subsections move under appropriate H2)
- [ ] Cross-references updated (the PR-1 description body, plan, README if present)
- [ ] No anchor-link regressions in linked docs

## Resources

- `docs/custom-tools.md`
- Plan items B3, B4, B7 (downstream PRs that extend this doc)
