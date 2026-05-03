# Custom Tools Guide

This guide explains how to create custom MCP tools using `registerCustomTool()`.

## Overview

Custom tools extend your MCP server with specialized functionality beyond the built-in `curl_execute` and `jq_query`
tools. Use them to:

- Create domain-specific operations
- Wrap complex multi-step workflows
- Provide simplified interfaces to APIs
- Add business logic and validation

## registerCustomTool() API

```typescript
server.registerCustomTool(
    name
:
string,           // Tool name (lowercase with underscores)
    meta
:
CustomToolMeta,   // Tool metadata
    handler
:
ToolCallback   // Handler function
)
```

### CustomToolMeta Interface

```typescript
interface CustomToolMeta {
    title: string;                              // Human-readable title
    description: string;                        // Description for LLM context
    inputSchema: z.ZodObject<z.ZodRawShape>;    // Zod schema for input validation
    annotations?: {
        readOnlyHint?: boolean;         // Tool only reads data
        destructiveHint?: boolean;      // Tool may delete/modify data
        idempotentHint?: boolean;       // Safe to retry
        openWorldHint?: boolean;        // Interacts with external systems
    };
}
```

### Handler Function

```typescript
type ToolCallback = (params: T) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}>;
```

## Basic Example

```typescript
import {McpCurlServer} from "mcp-curl";
import {z} from "zod";

const server = new McpCurlServer();

server.registerCustomTool(
    "greet_user",
    {
        title: "Greet User",
        description: "Generate a personalized greeting",
        inputSchema: z.object({
            name: z.string().describe("User's name"),
            formal: z.boolean().optional().describe("Use formal greeting"),
        }),
    },
    async ({name, formal}) => {
        const greeting = formal
            ? `Good day, ${name}. How may I assist you?`
            : `Hey ${name}! What's up?`;

        return {
            content: [{type: "text", text: greeting}],
        };
    }
);

await server.start("stdio");
```

## Validating External Inputs

Anything you accept *into* a custom tool — tool metadata, schema descriptions,
URL parameters, free-text fields — crosses a trust boundary if it originates
outside your application. Validate and sanitise before the value can influence
schema registration, prompts, or downstream HTTP requests.

| Helper | Use when... | Source |
|--------|-------------|--------|
| `sanitizeDescription(text)` | The string will be shown to the LLM as tool metadata or a schema description. | externally-sourced metadata, user-edited tool catalogues |
| `createHttpOnlyUrlSchema(options?)` | The tool accepts a URL parameter. | any tool that fetches a caller-supplied URL |

### Tool metadata and schema descriptions

`registerCustomTool()` auto-sanitizes `meta.title`, `meta.description`, **and** every `.describe()`
string inside `inputSchema` — at every depth. The deep walk recurses through:

- `z.object()` shape values
- `z.array()` element type
- `z.union()` and `z.discriminatedUnion()` options (the latter `instanceof ZodUnion` in Zod v4)
- `z.tuple()` items and the rest type
- `z.record()` / `z.map()` key + value types
- `z.set()` value type
- `z.intersection()` left and right arms
- `.transform()` / `.pipe()` (`ZodPipe`) source and destination schemas
- `z.lazy()` getter result (recursive lazy schemas are bounded by an internal cycle guard)
- `.optional()` / `.nullable()` / `.default()` / `.readonly()` / `.catch()` / `z.promise()` wrappers
  (descended via `.unwrap()`)

`.refine()` / `.check()` / `.superRefine()` append checks to the existing instance in Zod v4 and do
not produce a wrapper, so descriptions placed before a refinement are sanitised on the underlying
schema by the leaf walk.

The walker mutates `z.globalRegistry` entries on the schema you passed in — **the schema instance
itself is shared**, only the registered descriptions on each node are rewritten to their sanitised
form. Runtime parsing semantics are not touched, so every Zod check survives the walk: `.refine()`
and `.check()` chains, `.strict()` / `.passthrough()` modes, `z.array().min()` / `.max()` / `.length()`
constraints, factory `default(() => ...)` closures, and `ZodDiscriminatedUnion` discriminator
routing all continue to work exactly as before. The walk is idempotent (a clean description is
never rewritten to itself) and depth-bounded against pathological recursion.

If you need to retain the *unsanitised* description text for some downstream use, clone the schema
with `.describe(originalText)` before handing it in — the clone keeps the un-mutated registry
entry on a fresh node.

Other content inside `inputSchema` reaches the LLM verbatim — `z.enum([...])` literals,
`.default(...)` values, field key names. Field-key names and enum literals are part of the public
shape contract, so the helper does not mutate them. Sanitize these explicitly when they originate
from an external source.

`.describe()` strings sourced externally are covered automatically, but a defensive
`sanitizeDescription()` at the call site is harmless and a useful belt-and-braces signal for
reviewers:

```typescript
import { McpCurlServer, sanitizeDescription } from "mcp-curl";
import { z } from "zod";

const toolMeta = await fetchToolMetaFromDb();  // external source

const server = new McpCurlServer();

server.registerCustomTool(
    "search_records",
    {
        title: sanitizeDescription(toolMeta.title),         // optional — also sanitised internally
        description: sanitizeDescription(toolMeta.description), // optional — also sanitised internally
        inputSchema: z.object({
            // Defensive — registerCustomTool() also walks inputSchema and sanitises every .describe() string at every depth.
            query: z.string().describe(sanitizeDescription(toolMeta.queryDescription)),
        }),
    },
    handler
);
```

### URL parameters

Custom tools that accept URL parameters should use the same `createHttpOnlyUrlSchema()`
helper the built-in tools and YAML-driven schemas use internally. It restricts the URL
to `http`/`https` schemes via the WHATWG URL parser, rejecting `javascript:`, `data:`,
`file:`, `ftp:`, and other dangerous schemes that `z.url()` accepts by default.

```typescript
import { McpCurlServer, createHttpOnlyUrlSchema } from "mcp-curl";
import { z } from "zod";

server.registerCustomTool(
    "fetch_logo",
    {
        title: "Fetch a remote logo",
        description: "Downloads an image from a public URL.",
        inputSchema: z.object({
            target: createHttpOnlyUrlSchema({ description: "Target URL (must use http or https)" }),
        }),
    },
    handler
);
```

The schema-layer scheme check is one of three independent defences (schema →
DNS/SSRF → cURL `--proto`); each is sufficient on its own to reject a
non-http(s) request. Don't relax the helper to add custom schemes — if a
different allowlist is genuinely needed, add a separate factory rather than
widening the strict default.

## Sanitizing External Outputs

Anything you return *from* a custom tool that originates outside your
application (HTTP response bodies, file content, third-party API responses)
crosses the same trust boundary the built-in `curl_execute` tool defends. The
library exports response-side helpers so custom tools can replicate the
defence without deep-importing or reimplementing it.

| Helper | Use when... | Notes |
|--------|-------------|-------|
| `sanitizeAndDetect(text, label)` | You want the same defence the built-in tools apply. | Recommended. Locks the sanitize → detect → log ordering. |
| `applySpotlighting(text, requestId)` | You're emitting external content and want the LLM to treat it as data, not instructions. | Idempotent — pre-wrapped content is returned unchanged. Pass `randomUUID()`. |
| `sanitizeResponse(text)` | You need only the Unicode/whitespace strip without the detection signal. | Lower-level — `sanitizeAndDetect` is preferred. |
| `detectInjectionPattern(text)` | You're building a custom logging or telemetry sink. | **Observability only.** See the warning below — never use as a refusal gate. |
| `logInjectionDetected(label)` | You're replacing `sanitizeAndDetect` with your own composer and want consistent stderr log format. | Throttled to once per label per 60s. |

**Recommended:** use `sanitizeAndDetect(text, label)` plus `applySpotlighting`:

```typescript
import { sanitizeAndDetect, applySpotlighting } from "mcp-curl";
import { randomUUID } from "node:crypto";

const sanitized = sanitizeAndDetect(externalContent, hostname);
const wrapped = config.enableSpotlighting
    ? applySpotlighting(sanitized, randomUUID())
    : sanitized;
```

`applySpotlighting` is idempotent — if the framework re-wraps content that
your custom tool already wrapped, the outer call is a no-op.

> **⚠️ Do not use `detectInjectionPattern` to refuse, redact, or alter
> responses.** Pattern detection is unreliable as an enforcement boundary:
> it has false positives, is trivially bypassed (paraphrase, encoding, novel
> jailbreak phrasing), and gating on it leaks the rule-set to whoever can
> probe the behaviour. The defence layer is `sanitizeResponse` (which always
> runs) plus `applySpotlighting` (the trust-boundary sentinel). Detection is
> a logging signal, never a gate. If you find yourself reaching for the
> primitive to make a refusal decision, prefer `sanitizeAndDetect` instead
> — it is the safe alternative because it cannot be misused this way (it
> always returns the sanitized text).

The library uses these same helpers internally on `curl_execute` and
YAML-tool output. Calling them from a custom tool keeps the trust boundary
symmetric.

## Composing the Full Defence

The two sections above describe the input and output halves of the trust
boundary. **For tools registered via `server.registerCustomTool()`, the
output half is already applied for you** — every value the handler returns is
routed through the same internal post-processor wrap that defends
`curl_execute`, `jq_query`, and YAML-driven endpoints. The wrap runs
**detect → sanitise → optional spotlight** on each text content part:

1. `sanitizeAndDetect()` runs on the **original** text, emits the throttled
   `[injection-defense] [host]` log on a match, and returns the sanitised text.
2. If `config.enableSpotlighting === true` and the result is not an error, the
   sanitised text is wrapped in a per-message UUID-keyed sentinel envelope.

Idempotence is enforced via a module-private symbol tag, so a handler that
pre-sanitises (or pre-spotlights via `applySpotlighting`) won't double-process.
The wrap is fail-open: an internal exception returns the original result and
emits a throttled `[wrap-error] [host]` log.

If you're building a **non-MCP** pipeline (e.g. a plain HTTP service backed by
the same library) and need to replicate the defence outside the MCP handler
boundary, compose the public primitives directly per the snippets above —
`sanitizeAndDetect(text, label)` is the recommended composer (it locks the
detect-on-original ordering); pair it with `applySpotlighting(sanitised,
randomUUID())` if your protocol has the equivalent of a per-message trust
boundary. The internal `createWrapper` factory is **not** exported on purpose:
its `CallToolResult` shape is coupled to the MCP SDK and would be a stability
hazard for callers building their own response shapes.

## Using Instance Utilities

Access config-aware utilities for making HTTP requests within custom tools:

```typescript
const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"});

server.registerCustomTool(
    "get_user_profile",
    {
        title: "Get User Profile",
        description: "Fetch user profile with formatted output",
        inputSchema: z.object({
            userId: z.string().describe("User ID"),
        }),
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    async ({userId}) => {
        const utils = server.utilities();

        // Make request using instance utilities (applies config)
        const result = await utils.executeRequest({
            url: `/users/${encodeURIComponent(userId)}`,  // Encode to prevent path traversal
            headers: {"Accept": "application/json"},
        });

        if (result.isError) {
            return {
                content: [{type: "text", text: result.content[0]?.text ?? "Request failed"}],
                isError: true,
            };
        }

        // Format the response
        try {
            const user = JSON.parse(result.content[0].text);
            const formatted = `
User Profile:
  Name: ${user.name}
  Email: ${user.email}
  Role: ${user.role}
`.trim();

            return {
                content: [{type: "text", text: formatted}],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true,
            };
        }
    }
);
```

## Input Schema Patterns

### Required and Optional Fields

```typescript
z.object({
    required: z.string(),                    // Required
    optional: z.string().optional(),         // Optional
    withDefault: z.string().default("foo"),  // Has default
})
```

### Type Validation

```typescript
z.object({
    text: z.string(),
    count: z.number().int().positive(),
    flag: z.boolean(),
    choice: z.enum(["a", "b", "c"]),
    items: z.array(z.string()),
    data: z.record(z.string()),  // { [key]: string }
})
```

### Complex Validation

```typescript
z.object({
    email: z.string().email(),
    url: z.string().url(),
    age: z.number().min(0).max(150),
    code: z.string().regex(/^[A-Z]{3}-\d{4}$/),
})
```

### Descriptions

Always add descriptions for LLM context:

```typescript
z.object({
    query: z.string()
        .describe("Search query to find users"),
    limit: z.number()
        .optional()
        .describe("Max results to return (default: 10)"),
})
```

## MCP Annotations

Annotations help clients understand tool behavior:

```typescript
annotations: {
    readOnlyHint: true,       // Only reads, doesn't modify
        destructiveHint
:
    false,   // Doesn't delete data
        idempotentHint
:
    true,     // Safe to call multiple times
        openWorldHint
:
    true,      // Makes external requests
}
```

### When to Use Each

| Annotation              | Use When                                   |
|-------------------------|--------------------------------------------|
| `readOnlyHint: true`    | Tool only fetches/reads data               |
| `destructiveHint: true` | Tool deletes or irreversibly modifies data |
| `idempotentHint: true`  | Calling twice has same effect as once      |
| `openWorldHint: true`   | Tool interacts with external systems       |

## Complete Example: Weather API Tool

```typescript
import {McpCurlServer} from "mcp-curl";
import {z} from "zod";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.weatherapi.com/v1",
    });

server.registerCustomTool(
    "get_weather",
    {
        title: "Get Weather",
        description: "Get current weather for a location",
        inputSchema: z.object({
            location: z.string()
                .describe("City name, zip code, or coordinates (lat,lon)"),
            units: z.enum(["metric", "imperial"])
                .optional()
                .describe("Temperature units (default: metric)"),
        }),
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    async ({location, units = "metric"}) => {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) {
            return {
                content: [{type: "text", text: "WEATHER_API_KEY not set"}],
                isError: true,
            };
        }

        const utils = server.utilities();

        const result = await utils.executeRequest({
            url: `/current.json?key=${apiKey}&q=${encodeURIComponent(location)}`,
        });

        if (result.isError) {
            return {
                content: [{type: "text", text: `Weather API error: ${result.content[0]?.text ?? "Unknown"}`}],
                isError: true,
            };
        }

        try {
            const data = JSON.parse(result.content[0].text);
            const temp = units === "imperial"
                ? `${data.current.temp_f}°F`
                : `${data.current.temp_c}°C`;

            const weather = `
Weather for ${data.location.name}, ${data.location.country}:
  Condition: ${data.current.condition.text}
  Temperature: ${temp}
  Humidity: ${data.current.humidity}%
  Wind: ${data.current.wind_kph} km/h ${data.current.wind_dir}
`.trim();

            return {
                content: [{type: "text", text: weather}],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to parse weather response: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true,
            };
        }
    }
);

await server.start("stdio");
```

## Error Handling

Return errors with `isError: true`:

```typescript
async (params) => {
    try {
        // ... operation
        return {content: [{type: "text", text: result}]};
    } catch (error) {
        return {
            content: [{type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}`}],
            isError: true,
        };
    }
}
```

## Best Practices

1. **Validate early**: Use Zod schemas to catch bad input
2. **Write clear descriptions**: Help the LLM understand tool purpose
3. **Use annotations**: Signal tool behavior to clients
4. **Handle errors gracefully**: Return helpful error messages
5. **Keep tools focused**: One tool = one job
6. **Use utilities**: Leverage `server.utilities()` for requests
