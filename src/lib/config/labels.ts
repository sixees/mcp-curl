// src/lib/config/labels.ts
// Centralised hostname-style labels used for log throttling and observability.
//
// The defence-in-depth wrap and the injection-detection logger both key per-host
// throttle maps on a label string. For built-in tools whose result source is a
// real HTTP request, that label is the URL hostname. For tools without a
// meaningful hostname (jq_query reads a local file; user-supplied custom tools
// may not call out at all), a stable sentinel is used so the throttle stays
// bounded and operators can grep for tool-class events.
//
// Centralising these constants prevents drift across modules and tests — every
// caller treats jq_query events as `JQ_QUERY_HOSTNAME_LABEL` and custom-tool
// events as `CUSTOM_TOOL_HOSTNAME_LABEL`, keeping log lines and grep patterns
// consistent.

/**
 * Label for jq_query log events. The tool reads from a local file path, so no
 * real hostname applies; the sentinel makes file-source events distinct from
 * real-host events in `[injection-defense] [n/a]` log lines.
 */
export const JQ_QUERY_HOSTNAME_LABEL = "n/a";

/**
 * Label for the per-call wrap on user-supplied custom tools.
 *
 * User custom tools may reach out to anywhere (or nowhere — they may
 * synthesise text from local state); the registration adapter has no way to
 * know the request hostname at call time. The label keeps the per-host
 * injection-detection throttle bounded and lets ops grep for custom-tool
 * events specifically. YAML-driven tools, by contrast, wrap inside
 * `createToolHandler` (see `schema/generator.ts`) where the request URL is
 * known, and tag the result so the outer wrap at registration is a no-op for
 * them.
 */
export const CUSTOM_TOOL_HOSTNAME_LABEL = "custom";
