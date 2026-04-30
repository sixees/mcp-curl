# Axon — Brainstorm

**Status:** Greenfield product. Strong Cortex foundation; agent-native synthesis (April 30, 2026) reframes Axon's load-bearing surface from NL-to-SQL toward deterministic OpenAPI→typed-MCP-tool generation plus error translation.
**Layer:** AI Access Layer (MCP).
**Owner:** Platform Engineering.
**One-liner:** Axon is the deterministic Model Context Protocol (MCP) translator between non-deterministic LLM clients (Claude, ChatGPT, internal agents, Optix) and Cortex's strict OpenAPI HTTP surface. Typed tool I/O, principal-scoped, error-as-correction-guidance.

> **Updated April 30, 2026.** Incorporates the Cortex agent-native data lake synthesis (`2026-04-30-cortex-agent-native-data-lake-synthesis.md`) and its eight settled themes. Sections marked ⚠️ are revised vs. the previous brainstorm; sections marked ➕ are new. The single largest change: Axon no longer plans SQL. The synthesis reframes "NL-to-SQL" as "typed tool calls against an OpenAPI-derived contract" — and that contract is deterministic, not novel. **This re-classifies Axon from HIGH-novelty to HIGH-confidence**, and shrinks v1 to roughly 2–3 weeks of focused work once the foundational scaffolding is in place.

---

## 1. Why Axon exists ⚠️

Reviewer feedback flagged **over-reliance on the LLM**: if an AI product is "an LLM with a database attached", the LLM ends up doing retrieval, schema-guessing, joining, and narration — badly. The agent-native synthesis hardens this position into a **three-layer responsibility model** (see §3) and gives Axon a precise job in it.

Axon's job:

- Receive typed tool calls from any MCP-capable client.
- Encode them into Cortex HTTP requests that are guaranteed-valid because they were generated from Cortex's OpenAPI spec.
- Translate Cortex's RFC 7807 error envelopes (with `suggested_value` extensions) into actionable correction guidance the LLM can act on in a single round-trip.
- Return typed responses, with link-graph navigation cues from the response envelope.

The LLM is left with what it's actually good at: orchestration, summarisation, conversation, and tool selection. URL syntax, parameter validation, error parsing — none of those are LLM problems any more.

Axon is also the answer to *"I want to use Claude (or ChatGPT) with my ConfluxIQ data"* — the single most common ask from prospects with existing AI subscriptions. **Engage tier is largely Optix (the dashboard) plus Axon (the AI surface).**

---

## 2. What Axon is not ⚠️

- **Not a chatbot.** Axon has no UI. It is an MCP server — a set of typed tools — that any MCP-capable client can consume. Claude Desktop, Claude in Chrome, ChatGPT with an MCP bridge, Sixees' own internal agents, Optix's AI panel — all are clients.
- **Not a query engine.** Axon does not plan SQL. It does not run NL-to-SQL. It does not expose a SQL surface. It calls Cortex's OpenAPI-described HTTP endpoints. Cortex's deep-key filter syntax (Theme 1) and JSONB analytics endpoint cover the analytical reach Axon needs.
- **Not an LLM.** Axon never calls Bedrock or any other model. The LLM is on the *client* side. Axon is the deterministic tool server between them.
- **Not stateful.** Per-call principal resolution, per-session cache for hot reads (schema bundle, capabilities) — that's it. No conversation state; the client owns that.

---

## 3. Three-layer responsibility model ➕

This is the architectural anchor — settled in the synthesis and central to every design decision below.

| Layer | Owns | Does not own |
|---|---|---|
| **LLM client** (Claude / ChatGPT / Optix AI panel / Sixees agents) | Conversation, intent, summarisation, tool selection, retry decisions on suggested-value corrections. | URL syntax, parameter validation, error parsing, schema discovery directly against HTTP. |
| **Axon (MCP server)** | Typed tool I/O. Parameter encoding from typed inputs to Cortex HTTP requests. Error→correction translation (RFC 7807 `suggested_value` → LLM guidance). Per-session cache (schema bundle, capabilities). Principal token pass-through. The MCP Resources orientation surface. | Conversation state. Storage. Schema authority. SQL planning. Tenant scope enforcement at the data layer (that's Cortex's `AccountEntityScope`). |
| **Cortex** | Storage, schema, ingestion, scope enforcement, OpenAPI contract, RFC 7807 errors, `meta._links` navigation cues, `_capabilities` advertisement, Theme 4 storage primitives. | LLM-friendly error prose. Conversation. Direct LLM consumption of URL syntax. |

The deterministic boundary between LLM and Cortex sits at Axon. Everything novel in the agent-native programme is being absorbed by Cortex (the four-pillar themes) and by Axon (this layer); the LLM gets to be a relatively dumb conversation engine on top.

---

## 4. The Cortex foundation — what we have, what's coming ⚠️

Cortex's posture is what makes Axon's job tractable. The foundation has two parts: shipped today, and coming via the four agent-native pillar themes.

### 4.1 Shipped today (Axon can build against this immediately)

- **Schema Discovery family (PR-A/B/C, April 2026).** `GET /api/v2/schema` bundle plus seven sub-endpoints. ETag-cached via `SchemaEtagMiddleware` — 304 short-circuits before the controller. Content-keyed fingerprint via `xxh128`. RFC 6570 templated `_links`. `view=summary` query param. `php artisan types:lint`. **This is the orientation surface Axon's MCP Resources layer wraps. Available now.**
- **Entity hierarchy** — ltree-based; fail-closed at `AccountEntityScope`. Cross-tenant leakage impossible if Axon respects scope (which it does — by passing the principal through, not by re-implementing scope).
- **EntityMetricSnapshot** — windowed statistics, anomaly scores, pre-rendered summary text. Axon gets "what's changed this week for entity E" effectively for free.
- **EntityTransaction** — append-only, monthly-partitioned, JSONB payload with deep-key filtering coming via Theme 1. Operational read endpoint already in production.
- **YAML-driven datasource definitions** — datasources and entity types enumerable without hard-coding.
- **Forward-compat markers** — `empty-grant-paths-not-no-access`, `topology-row-uniqueness`, `allowed-parents-primary-ltree-only`, `datasource-schema-principal-filtered`. Axon's tool generation honours these.

### 4.2 Coming via the agent-native pillar themes (Axon design assumes these)

Axon's load-bearing capabilities sharpen as each Cortex theme lands. The dependency map:

| Cortex theme | What lands | What it unlocks for Axon |
|---|---|---|
| **Theme 1 — Surface harmonisation** (3–4 weeks) | Dual-ID acceptance (numeric or ltree path on reads); deep-key filter syntax (`filter[payload.X.Y]=Z`); ISO 8601 datetime everywhere; field-type annotations as `{type, format?, enum?, values?}`; `meta.conventions` block; POST analytics sibling endpoint. | Generated MCP tools with no per-route quirks. Field-type info drives typed parameter shapes. Datetime convention removes an entire class of LLM construction errors. |
| **Theme 2 — Self-description on operational endpoints** (1.5–2 weeks) | `meta._links` with self/schema + per-resource Tier-2 graph. `meta.filter_applied` and `meta.coverage` on analytics. `_capabilities` empty-array shape on `/schema/access`. | Axon's MCP **Resources surface** (orientation layer) walks the link graph natively; no hand-coded routing knowledge per endpoint. Capability gating is read from a stable shape. |
| **Theme 3 — Error contract via RFC 7807** (2–3 weeks) | `application/problem+json` envelopes. `errors[].suggested_value` for mechanical constraints. 503 statement-timeout with partition-stat suggestions. Dereferenceable `type` URLs. | **Axon's most valuable single capability comes alive.** Multi-round-trip error recoveries collapse to single-round-trip corrections. Per-tool-call Bedrock token cost drops by ~3×. |
| **Theme 5 — OpenAPI as runtime contract** (4–6 weeks rollout) | Spec is enforced at runtime. CI conformance tests. Drift detection. | **Auto-generated MCP tools.** Axon's hand-coded Phase 1 tools become generated Phase 2 tools, with a guarantee that the spec matches runtime. New endpoints pick up tools automatically. |

### 4.3 Theme 4 storage primitives (drive future tools)

When each primitive ships, a new tool surface comes online — but the work for Axon is largely "regenerate tools from the new OpenAPI" once Theme 5 has closed:

- `entity_states` → `list_states`, `set_state`
- `entity_annotations` → `add_annotation`, `list_annotations` (Reflex owns writes)
- `entity_targets` → `list_targets`, `set_target`
- `entity_triggers` + `entity_trigger_evaluations`/`firings` → `list_triggers`, `list_firings`, `acknowledge_firing`
- `entity_relationships` → `list_relationships`, `traverse_relationships`
- `system_config` → operator-only `list_config` (consumer not LLM)

---

## 5. Tool surface (v1) ⚠️

Big change: `ask_structured` (NL-to-SQL) is **removed**. The deep-key filter syntax (Theme 1) plus the analytics endpoint plus generated tools cover the operational reach without Axon planning SQL. Anything genuinely SQL-shaped that survives this analysis is a candidate for the *operator* surface, not the end-user surface, and is reconsidered post-Theme-5.

### 5.1 Phase 1 — hand-coded, against today's surface

Six tools, available immediately. Hand-coded against today's OpenAPI annotations; replaced with auto-generated equivalents when Theme 5 closes.

| Tool | Purpose | Backed by |
|---|---|---|
| `list_entities` | Enumerate entities visible to the caller | Cortex `GET /entities` + scope |
| `get_entity` | Full record + ltree path + key attributes + `_links` | Cortex `GET /entities/{entity}` |
| `list_metrics` | Available metric snapshots for an entity | Cortex `GET /entities/{entity}/metrics` |
| `get_metric_snapshot` | Windowed stats, anomaly score, summary text | `EntityMetricSnapshot` API |
| `list_datasources` | Available datasources, with field-type annotations | Cortex `GET /schema/datasources` |
| `query_analytics` | Filtered/windowed read over `entity_data_points` (operator scope only in Phase 1) | Cortex analytics endpoint |

`query_transactions` was in the previous v1 list. Stays in Phase 1 as a hand-coded tool against `EntityTransaction`'s read endpoint, but moves into a "filtered reads" tool family that's auto-generated once Theme 5 closes.

### 5.2 Phase 2 — auto-generated from OpenAPI (once Theme 5 in flight)

Per-route allowlist progress on Cortex's side directly enables tool generation on Axon's side. As each route enters the runtime-validated set, Axon's generator regenerates that tool with the OpenAPI-as-contract guarantee. Hand-coded tools sunset as their generated equivalents pass parity tests.

### 5.3 Phase 3+ — primitive tools (when Theme 4 sub-themes ship)

See §4.3. No hand-coded work — these come for free if Theme 5 closes first.

### 5.4 Cross-cutting tools (independent of Cortex themes)

- `record_feedback` — writes to Reflex's `POST /reflex/events`. Available once Reflex v1 lands (currently in Cortex's adjacent-work track).
- `search_documents` — backed by Lexis (later phase; Lexis not yet in flight).
- `list_insights` — backed by Logix (later phase; Logix on Starter-tier roadmap).

Every tool takes an implicit `tenant_id` resolved from the caller's Vertex-issued token. Every tool enforces the entity-scope cascade by passing the principal through to Cortex (not by re-implementing scope). Every tool emits an audit event.

---

## 6. Error translation: Axon's load-bearing capability ➕

Replaces the previous "NL-to-SQL, carefully" section. Under the agent-native model, Axon's most valuable capability is **converting Cortex's RFC 7807 errors into actionable correction guidance the LLM can act on in one round-trip.**

### 6.1 The mechanic

Cortex returns:

```json
{
  "type": "https://cortex.gp-ms.com/errors/date-range-too-wide",
  "title": "Date range exceeds maximum",
  "status": 422,
  "detail": "filter[period_start_from] to filter[period_start_to] spans 400 days; maximum is 365",
  "instance": "/entities/42/data-points/analytics?...",
  "errors": [{
    "field": "filter[period_start_to]",
    "constraint": "max_range",
    "max_days": 365,
    "actual_days": 400,
    "suggested_value": "2026-04-22"
  }]
}
```

Axon translates that into a tool-result the LLM understands:

```json
{
  "ok": false,
  "correction": {
    "field": "period_start_to",
    "current": "2026-04-22 (caller sent: open-ended)",
    "suggested": "2026-04-22",
    "rationale": "365-day maximum range; 400 days requested",
    "retry_with": { /* the same tool args, with the corrected field replaced */ }
  },
  "kind": "constraint-violation"
}
```

The LLM reads `retry_with`, calls the tool again with that argument set, and the second call succeeds. Round-trip count: 2 (instead of the typical 4–5 with prose-error guesswork). Bedrock token cost: ~3× lower per recoverable failure.

### 6.2 Translation classes

| RFC 7807 `type` | Translation strategy |
|---|---|
| Range cap (`max_range`, `max_size`) | Surface `suggested_value`; emit `retry_with` with the suggestion applied. |
| Enum / known-key whitelist | Surface allowed values; emit `retry_with` with the first allowed value as default. |
| Required-but-missing | Surface a sensible default (from `suggested_value` or schema); emit `retry_with`. |
| Cross-field dependency (`field_required_when`) | Surface the dependency; emit a `requires` block listing what to add; no `retry_with` (LLM must decide which dependent value to provide). |
| Format validation (no `suggested_value`) | Surface the constraint and the doc URL; ask the LLM to re-author the value. |
| 503 statement-timeout | Surface the suggested narrower bounds with rationale; emit `retry_with`. |
| Auth (`401`, `403`) | Surface as terminal — no retry; client surfaces to user. |

### 6.3 Cache discipline

Axon caches `type` URL → translation strategy mappings per session. The first 422 of a kind costs an envelope parse; subsequent 422s of the same kind hit the cache. Forward-compat: if Cortex adds new constraint classes, Axon falls through to the generic envelope translator (`detail` + `errors[]` surfaced verbatim) and learns the new class on next deploy.

### 6.4 Why this matters

The synthesis's reliability story rests on this. Without it, the LLM sees Laravel-default `{message, errors}` and guesses corrections from prose — the failure mode reviewers flagged. With it, recoverable errors recover deterministically. Axon's value proposition is *"the LLM cannot construct a request shape that Cortex won't accept, and when it does construct a request that fails on a recoverable constraint, the recovery is one round-trip."*

---

## 7. Safety model ⚠️

Five concentric rings, all mandatory. Ring 5 is unchanged from v1.0; Ring 4 sharpens with Theme 2's `_capabilities`.

1. **Authentication** — the MCP call carries a Vertex-issued JWT. Axon rejects anything else.
2. **Tenant isolation** — the token's tenant_id is the *only* tenant Axon will talk to for this call. Cross-tenant tools do not exist at this layer.
3. **Entity scope** — Cortex applies `AccountEntityScope` / `GrantPathCache` at the request level using the principal's token. Axon does not re-implement scope — it forwards the principal and trusts Cortex's enforcement (the simpler, more auditable design).
4. **Capability gating** ⚠️ — once Theme 2 ships `_capabilities`, Axon reads the principal's capabilities from `/schema/access` (cached per session) and refuses to expose tools whose required capability isn't present. Pre-Theme-2: every authenticated principal has the equivalent of `['*']`, so capability gating is a permissive no-op until granular Sanctum abilities land. Forward-compat: Axon already branches on the empty-array shape Theme 2 ships.
5. **Rate limits + cost caps** — per tenant, per user, per tool. An LLM client running a bad loop hits a circuit breaker, not a bill shock. Implemented at Axon (cost-cap is a property of the MCP layer, not of Cortex storage).

---

## 8. Architecture ⚠️

- **Runtime:** thin sidecar to Cortex, deployable independently. Same VPC, separate task definition. Sidecar choice (vs. embedded package) is now firm — the synthesis's three-layer model implies independent scale and lifecycle.
- **Transport:** MCP over stdio for Claude Desktop; MCP over HTTP+SSE for Claude in Chrome and ChatGPT. Both delegate to the same internal tool implementations.
- **State:** stateless principal resolution per call. Per-session cache for hot reads:
  - Schema bundle (TTL = ETag-driven; Cortex's content-keyed fingerprint already gives Axon perfect cache invalidation).
  - `_capabilities` (TTL = principal session).
  - Error `type` URL → translation-strategy map (TTL = process lifetime).
- **Tool generation:** in Phase 1, tools are PHP-or-TS classes wrapping HTTP calls. In Phase 2 (post-Theme-5), tools are generated from `/docs/api-docs.json` at build time. Both forms produce the same MCP manifest shape — clients can't tell which path produced any given tool.
- **Audit:** every call writes a structured log with tenant, user, tool, arguments (redacted per a deny-list), latency, outcome, error class if any. Hooks into Reflex once Reflex v1 ships.

---

## 9. Foundational work we can start now ➕

The user's specific question: what work proceeds without waiting for Cortex's Themes 1, 2, 3, 5? Quite a lot, in fact. The synthesis settles enough of Cortex's contract for us to build the apparatus today, then ride the contract improvements as each theme lands.

### 9.1 Start immediately (Cortex-independent)

| # | Item | Why now | Notes |
|---|---|---|---|
| F1 | **MCP transport scaffolding** — stdio + HTTP+SSE, JWT auth via Vertex, principal resolution, audit logging, rate-limit + cost-cap middleware. | Pure plumbing. Doesn't depend on Cortex contract details. | Sidecar repo. Standard MCP libraries (e.g., `@anthropic/mcp-sdk` or PHP equivalent). |
| F2 | **Schema-bundle cache layer** — fetches `/api/v2/schema`, respects ETags, caches per session, exposes the bundle to tool implementations. | Schema discovery family is shipped (PR-A/B/C). Build the cache today. | Must respect content-keyed fingerprint — deploy-only mtime bumps don't invalidate. |
| F3 | **MCP Resources orientation surface** — exposes Cortex's `/schema/*` endpoints as MCP Resources (the orientation pattern from progressive discovery). | Schema family already gives the right shape; agents read this for orientation. | When Theme 2's `meta._links` lands, the Resources surface walks the link graph natively. Pre-Theme-2: hand-coded routing. |
| F4 | **OpenAPI → tool generator scaffolding** — read `/docs/api-docs.json`, emit MCP tool stubs (typed inputs, typed outputs, descriptions). | Theme 5's OpenAPI runtime contract is the eventual authority, but Axon can scaffold the generator against today's annotations. As Theme 5 closes per route, swap stubs for generated implementations. | Generator output is checked-in for v1 (deterministic, auditable). Auto-regenerate on spec change becomes a CI step in Phase 2. |
| F5 | **Error envelope handler — dual-mode** — handles BOTH today's Laravel `{message, errors}` shape AND tomorrow's RFC 7807 envelope (Theme 3). | Translation strategy works for both. When Theme 3 closes, the Laravel branch is removed. | This is the load-bearing layer (§6); building it now means the day Theme 3 ships, Axon's reliability story is real. |
| F6 | **Hand-coded Phase 1 tool catalogue** (the six tools in §5.1) | Provides immediate value to Sixees internal agents while the generator scaffolding matures. | Each tool follows the same template — request encoding, response decoding, error translation, audit log. |
| F7 | **Reflex `record_feedback` tool** | Co-located with Cortex; spec'd; can be built against the documented `POST /reflex/events` shape even before Reflex v1 ships, using a stub server in dev. | Wires up the learning loop the moment Reflex lands. |
| F8 | **Red-team test harness** — every tool exercised with valid + invalid + cross-tenant + scope-violation + rate-limit-burst inputs; assertions on auth/scope/audit per the safety model. | Independent of any Cortex theme. The single test artifact that proves Axon is safe. | This is Definition-of-v1-Done #4. |
| F9 | **Audit + telemetry pipeline** — structured logging, OpenTelemetry traces, per-tool metrics. | Independent of any Cortex theme. Foundational for cost-cap and rate-limit policies. | |
| F10 | **Multi-tenant deployment harness for Sixees** — sidecar deployed to dev/staging, tenant token issuance flow exercised end-to-end. | Independent of Cortex theme work. | |

### 9.2 Gated by Cortex themes — but design in parallel

Design work, plan work, even some test scaffolding can proceed for these. Implementation lands when the corresponding Cortex theme is in flight.

| Item | Gated on | Pre-flight work that can proceed now |
|---|---|---|
| Auto-generated tool catalogue (§5.2) | Theme 5 per-route allowlist progress | Generator scaffolding (F4); golden-file tests for stub output; routing logic for stub-vs-generated tool selection. |
| Capability-based gating (§7 Ring 4) | Theme 2 `_capabilities` ship | Read the synthesis vocabulary; build the gating logic against the empty-array shape; integration test coverage. |
| RFC 7807 translation classes (§6.2) | Theme 3 `application/problem+json` ship | Translation strategies coded against the documented envelope (synthesis §4.3); kept dormant behind a feature flag until Cortex returns the new shape. |
| Theme 4 primitive tools (§4.3) | Each Theme 4 sub-theme | Watch Cortex's `/schema/datasources` for the new endpoints appearing in the spec; auto-pickup via the generator. |
| `_links`-driven Resources surface (F3 advanced form) | Theme 2 `meta._links` ship | Today's hand-coded orientation routing is the fallback; the link-graph walker is a follow-up enhancement. |

### 9.3 What this means for sequencing

If the planning agent runs the foundational work F1–F10 in parallel with Cortex's Themes 1, 2, 3, 5, Axon v1 can be in production internally **at the same time Theme 5 closes**, not weeks behind it. The capacity warning in the Cortex deferred-features doc (Themes 1+2+3+5 ≈ 10–15 weeks of focused work) means Axon's foundational track has roughly that runway to fill — and F1–F10 is the right shape and size for that runway.

---

## 10. Phase plan ⚠️

Reframed against Cortex's theme progress. Indicative dates assume Cortex Themes 1+2+3+5 complete on the 10–15 week schedule.

- **Phase 0 (now → ~6 weeks):** Foundational work F1–F10. Sidecar lives, stdio + HTTP+SSE both work, six hand-coded tools in §5.1 deployed for Sixees internal agents. **Deliverable:** internal agents query Cortex through Axon, never directly. Red-team suite passes.
- **Phase 1 (Cortex Theme 1 + 2 in flight, ~6–10 weeks):** Tool surface absorbs harmonised IDs and `meta._links`. Resources orientation surface walks the link graph. Hand-coded tools updated to use deep-key filter syntax. **Deliverable:** an Engage tenant can connect Claude Desktop and ask "what's changed this week in my inventory" and get a real answer sourced from `EntityMetricSnapshot`, with link-graph navigation cues in tool outputs.
- **Phase 2 (Cortex Theme 3 in flight, ~10–14 weeks):** Error envelope switches to RFC 7807. Translation strategies for the major constraint classes go live. Bedrock token cost per recoverable failure measurable, ~3× lower than Phase 1. **Deliverable:** the agent reliability story is bankable.
- **Phase 3 (Cortex Theme 5 rolling out, ~14–22 weeks):** Per-route auto-generated tools come online as Cortex's allowlist fills. Hand-coded Phase 0 tools are sunset as their generated equivalents pass parity tests. **Deliverable:** Axon's tool catalogue is generated, not authored. New Cortex endpoints get tools automatically.
- **Phase 4 (Theme 4 sub-themes shipping, ~16+ weeks):** Primitive tools (states, annotations, targets, triggers, relationships) join the catalogue automatically — generated from new spec entries. Reflex `record_feedback` and Lexis `search_documents` come online when those products are live. Logix `list_insights` joins when Logix is live.
- **Phase 5:** Fine-grained per-tool cost budgets per tenant and per user. Benchmark context tools ("show me vs. vertical median") powered by Vertex.

---

## 11. Open questions ⚠️

1. **Tool description authoring vs. generation.** MCP lets us write long descriptions per tool; descriptions are critical for LLM tool-selection quality. When Phase 3 begins generating tools from OpenAPI, tool descriptions need to come from the OpenAPI annotations — but those annotations historically optimise for human-OpenAPI-readers, not for LLM-tool-selectors. Proposal: add an `x-axon-description` extension field in Cortex's PHP annotations, written for LLM-tool-selection clarity; generator prefers it over the human-doc summary. **Open: who edits these — Cortex devs or Axon devs?**

2. **Multi-turn context.** Should Axon maintain a per-session context (recent entities, recent metrics) so follow-up calls are cheaper? Original brainstorm said "no, keep stateless". The synthesis pushes a small concession — per-session schema-bundle and `_capabilities` cache (§8). Does that grow into a per-session entity-and-metric cache? Proposal: stay stateless for business data; per-session cache is for *contract* (schema, capabilities, error mappings) not *content*. Revisit if measured Bedrock cost suggests otherwise.

3. **Writes.** Original brainstorm: yes for Reflex, no for business data. Synthesis sharpens this — business writes go through Synaps, never through Axon. State-transition writes (Theme 4 `entity_states`) and target writes (Theme 4 `entity_targets`) are open: are these "business writes" (Synaps) or "operational writes" (Axon)? Proposal: operational writes via Axon when the input is structured and constraint-validated; business writes (e.g., creating an entity from natural language description) remain Synaps's territory.

4. **Tool generator language.** PHP (matching Cortex) or TypeScript (better MCP-SDK ecosystem)? The sidecar stance argues for either being fine. Proposal: TypeScript for the MCP server, with PHP only if a strong reason emerges to share code with Cortex (which the synthesis's three-layer model argues against).

5. **Phase 0 tool catalogue precision.** Six hand-coded tools is a starting target; the actual count depends on how `query_analytics` decomposes (single tool with rich filter input vs. multiple tools per common pattern). Proposal: single rich-filter tool; let the LLM compose the filter from the field-type metadata once Theme 1.7 ships.

6. **Error translation cache invalidation across deploys.** If a Cortex deploy changes an error envelope (or adds a new `type` slug), Axon's cached translation map can serve stale guidance. Proposal: the schema bundle's `config_version` / fingerprint extends to error catalogue; Axon refreshes both on fingerprint change.

7. **Pre-Theme-3 backward-compat shim.** Cortex will ship the legacy `{message, errors}` shape alongside RFC 7807 for one release cycle (Open Question #22 in the deferred-features doc). Axon's dual-mode handler (F5) handles both. **Open: should Axon proactively send `Accept: application/problem+json` to opt into the new shape from day one of Theme 3, or wait for Cortex to default to it?** Proposal: opt in — Axon is a known consumer; we control the rollout coordination.

8. **Token budget telemetry.** If error translation is the load-bearing reliability claim, we need to *measure* it. Per-tool, per-tenant token-cost telemetry, with a Phase 0 baseline (Laravel-default errors) and a Phase 2 measurement (RFC 7807 + suggested_value). Proposal: build this into F9 from day one so the Phase 2 measurement is real, not anecdotal.

---

## 12. Definition of v1 Done ⚠️

Axon v1 is "done" when **all** of the following hold:

1. **Internal use** — Sixees internal agents query Cortex only through Axon, never directly. No code path in Sixees agents talks to Cortex's HTTP surface other than via Axon's MCP transport.
2. **External tenant** — an Engage tenant can, on day one, connect Claude Desktop or Claude in Chrome and ask "what's changed this week in my inventory" and get a real answer sourced from `EntityMetricSnapshot`. Tool descriptions are clear enough that the LLM picks the right tools without prompting; responses include `_links` navigation cues that the LLM follows for drill-down.
3. **Audit** — every Axon call is audited with tenant, user, tool, arguments (redacted per deny-list), latency, and outcome. Audit logs are queryable per tenant, per user, per tool.
4. **Safety** — Axon rejects any call whose token is unknown to Vertex, or whose scope disallows the target entity, in every single test case in the red-team suite. No cross-tenant leakage path exists, including via `_links` URLs (which are scoped by Cortex on the principal token).
5. **Reliability** — recoverable errors (range cap, enum, known-key whitelist, required-field) recover in one round-trip via RFC 7807 `suggested_value` translation. Measured Bedrock token cost per recoverable failure is at least 2.5× lower than the Laravel-default-error baseline established in Phase 0.
6. **Tool generation** — at least 50% of the v1 tool catalogue is auto-generated from Cortex's OpenAPI spec (the Theme-5 ratio at v1 close). Hand-coded tools have parity tests against generated equivalents where both exist.
7. **Cost discipline** — per-tenant rate-limit and cost-cap policies are enforced; circuit breakers fire before bill shock; admin can revoke a tool for a tenant via config without code change.

