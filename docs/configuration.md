# Configuration Reference

This document covers all configuration options for `McpCurlServer`.

## McpCurlConfig Interface

```typescript
interface McpCurlConfig {
    baseUrl?: string;
    defaultHeaders?: Record<string, string>;
    defaultTimeout?: number;
    outputDir?: string;
    maxResultSize?: number;
    allowLocalhost?: boolean;
    port?: number;
    host?: string;
    authToken?: string;
    allowedOrigins?: readonly string[];
    defaultUserAgent?: string;
    defaultReferer?: string;
    enableSpotlighting?: boolean;
    rateLimit?: { max: number; windowMs: number };
}
```

## Configuration Options

| Option               | Type                     | Default     | Description                                                              |
|----------------------|--------------------------|-------------|--------------------------------------------------------------------------|
| `baseUrl`            | `string`                 | none        | Base URL that a `/`-path in `curl_execute` is resolved against           |
| `defaultHeaders`     | `Record<string, string>` | none        | Headers added to all `curl_execute` requests                             |
| `defaultTimeout`     | `number`                 | 30          | Default timeout in seconds (1-300)                                       |
| `outputDir`          | `string`                 | system temp | Directory for saved responses                                            |
| `maxResultSize`      | `number`                 | 500000      | Max bytes before auto-saving to file (max 1MB)                           |
| `allowLocalhost`     | `boolean`                | false       | Allow localhost requests (blocked by default)                            |
| `port`               | `number`                 | 3000        | HTTP transport port                                                      |
| `host`               | `string`                 | "127.0.0.1" | HTTP transport bind address                                              |
| `authToken`          | `string`                 | none        | Bearer token for HTTP transport authentication (printable ASCII, ≤ 4096) |
| `allowedOrigins`     | `readonly string[]`      | localhost   | Allowed origins for HTTP Origin header validation                        |
| `defaultUserAgent`   | `string`                 | none        | User-Agent for all requests; empty string disables                       |
| `defaultReferer`     | `string`                 | none        | Referer for all requests; empty string disables                          |
| `enableSpotlighting` | `boolean`                | false       | Wrap response text in per-message sentinel envelopes (defence-in-depth)  |
| `rateLimit`          | `{ max, windowMs }`      | 60/min      | Per-host limit as a sliding window; see [rateLimit](#ratelimit)          |

## Detailed Options

### baseUrl

A `url` starting with a single `/` is resolved against it. Useful for API-specific servers:

```typescript
.
configure({baseUrl: "https://api.example.com/v1"})
```

Then `curl_execute` with `url: "/users"` becomes `https://api.example.com/v1/users`.
`utilities().executeRequest` resolves a `/`-`url` the same way, and also takes `path`.

- On a server with `baseUrl`, the `curl_execute` input schema advertises `url` as an
  absolute http(s) URL **or** a path starting with `/`. Without `baseUrl`, a path is
  rejected at the schema.
- An absolute URL passes through unchanged, to any host.
- A relative value must start with a single `/` and contain no control characters
  (any C0 control, such as tab, CR, LF or NUL, or DEL). One starting `//`, `/\` or `\`
  is refused, because a URL parser reads it as a host; a control character is refused
  because the URL parser strips a tab, CR or LF and percent-encodes the rest, so the
  URL the SSRF check validates is not the value cURL is handed. This applies to
  `curl_execute`'s `url` and to
  `executeRequest`'s `url` and `path` alike, and the refusal is an error result that
  states the rule.
- A relative value must not contain a `.` or `..` path segment, literal or
  `%2e`-encoded: the URL parser and cURL both resolve one, so `/users/..` would
  request the parent of `/users/`. Only whole segments of the path count; a dot in
  `/v1.2/`, `/.well-known/` or the query string is fine. An absolute URL is not
  checked, because it names its own path.
- The joined URL still goes through the SSRF check, like every other request.
- If `baseUrl` is not an absolute http(s) URL, a relative call fails with an error
  that names the `baseUrl` key without echoing its value.

**`baseUrl` is a convenience, not a security boundary.** The model can still send an
absolute URL to another host. Keep an API key in `defaultHeaders`, never in tool-call
arguments, so it stays out of the transcript.

### defaultHeaders

Added to all requests. Merged with request-specific headers (request headers take precedence):

```typescript
.
configure({
    defaultHeaders: {
        "Accept": "application/json",
        "X-Client-Version": "1.0.0",
    }
})
```

### defaultTimeout

Default request timeout in seconds. Can be overridden per-request:

```typescript
.
configure({defaultTimeout: 60})
```

### outputDir

Directory where large responses are saved. Falls back to system temp directory:

```typescript
.
configure({outputDir: "/var/data/mcp-responses"})
```

Can also be set via `MCP_CURL_OUTPUT_DIR` environment variable.

### maxResultSize

Maximum bytes to return inline. Larger responses auto-save to file:

```typescript
.
configure({maxResultSize: 1_000_000}) // 1MB
```

### allowLocalhost

By default, localhost requests are blocked for security. Enable for local development:

```typescript
.
configure({allowLocalhost: true})
```

Can also be set via `MCP_CURL_ALLOW_LOCALHOST=true` environment variable.

**Localhost port restrictions.** Even when localhost is permitted, the SSRF
check restricts which ports the LLM can reach. Allowed ports are:

- `80` / `443` — standard HTTP / HTTPS
- any port `> 1024` — non-privileged ports, covers common dev-server defaults
  (`3000`, `3001`, `4000`, `5000`, `5173`, `5432`, `8000`, `8080`, `9090`, …)

Ports `1–1024` (other than `80` / `443`) are always blocked to prevent the LLM
from reaching privileged services like SSH (22), SMTP (25), DNS (53), etc.,
even when `MCP_CURL_ALLOW_LOCALHOST=true`. The flag is "allow dev work", not
"open every loopback port".

### port

HTTP transport listening port:

```typescript
.
configure({port: 8080})
```

Can also be set via `PORT` environment variable.

### host

HTTP transport bind address:

```typescript
.
configure({host: "0.0.0.0"}) // Listen on all interfaces
```

Default: `"127.0.0.1"` (localhost only). Can also be set via `MCP_CURL_HOST` environment variable.

### authToken

Require bearer token authentication for HTTP transport:

```typescript
.
configure({authToken: process.env.MCP_AUTH_TOKEN})
```

Clients must include the configured token in the `Authorization: Bearer <token>`
header. The scheme is matched case-insensitively per RFC 6750 §2.1; the token
itself is compared with `crypto.timingSafeEqual` to avoid timing-side-channel
leaks.

The token is validated at HTTP transport startup:

- **Length** — rejected if longer than `4096` characters (covers RSA-256 JWTs,
  OIDC ID tokens, and most JWE tokens; above this is almost certainly a paste
  error).
- **Charset** — must be printable ASCII only (`0x20–0x7E`). CRLF, NUL, high-bit
  control bytes, and any non-ASCII codepoints are rejected.

A startup rejection throws synchronously **before** the HTTP server binds, so
the operator sees the error immediately and the bad token never reaches the
auth-middleware closure. The token value is **never** echoed in error messages
or logs — operators see `[length=N]` or `[redacted]` markers instead.

Can also be set via `MCP_AUTH_TOKEN` environment variable.

### allowedOrigins

Override the default Origin header validation for HTTP transport:

```typescript
.
configure({allowedOrigins: ["https://myapp.example.com", "https://admin.example.com"]})
```

By default, only localhost origins are allowed. Setting this replaces the defaults entirely. Can also be set via
`MCP_CURL_ALLOWED_ORIGINS` (comma-separated).

### defaultUserAgent

Override the User-Agent header sent on every `curl_execute` request. An empty
string disables the header entirely.

```typescript
.
configure({defaultUserAgent: "MyApp/1.0 (+https://example.com)"})
```

Can also be set via `MCP_CURL_USER_AGENT` environment variable.

### defaultReferer

Override the Referer header sent on every `curl_execute` request. An empty
string disables the header entirely.

```typescript
.
configure({defaultReferer: "https://example.com/"})
```

Can also be set via `MCP_CURL_REFERER` environment variable.

### enableSpotlighting

Wrap text content parts of every tool response in a per-message sentinel
envelope so the LLM treats the body as untrusted data rather than instructions.
Defaults to `false`.

```typescript
.
configure({enableSpotlighting: true})
```

The envelope uses opaque, UUID-keyed begin/end sentinels generated fresh on
every wrap call (one UUID per response, shared by every text part). Spotlighting
is always combined with the always-on **defence-in-depth wrap** that runs over
every tool result emitted by the server (`curl_execute`, `jq_query`, YAML
endpoints, custom tools, and `beforeRequest` short-circuit returns). The wrap
runs these steps in fixed order on each text part:

1. **Detect** injection patterns against the original text and its sanitised
   form, and emit a throttled `[injection-defense] [host]` log line on a match.
   A part that parses as JSON is also tested on each escaped string token,
   decoded on its own, and is never rewritten.
2. **Defend** every other part with the full `defendText` pipeline: sanitise
   Unicode attack chars and collapse whitespace runs, strip markup comments,
   `<script>`/`<style>` blocks and markdown beacons, then detect again.
3. **Spotlight** the text using a per-message UUID — only when this flag is
   `true` and the result is not an error.

Steps 1 and 2 run regardless of this flag. The wrap is idempotent (same
result wrapped twice is a no-op) and fail-open (an internal exception returns
the original result and logs `[wrap-error] [host]`), so defence-in-depth never
breaks the handler boundary.

### rateLimit

Replace the per-host limit with a sliding window: at most `max` requests to any
one host in any `windowMs` span. Use it when the API you front has a quota the
default (60 requests per host per minute, fixed window) does not fit.

```typescript
configure({rateLimit: {max: 200, windowMs: 3_600_000}}) // 200 per rolling hour
```

- **Per host, every host.** The limit applies to each hostname separately and
  to every host the server calls. The per-client limit (300/min per HTTP
  session, or for the stdio process) is not configurable and still applies.
- **Sliding, not fixed.** A request is admitted when fewer than `max` were made
  to that host in the last `windowMs`. A burst of `max` is allowed; the next
  request waits until the oldest leaves the window. The refusal names `max`,
  the window, and how long until the oldest request leaves it. Without
  `rateLimit` the fixed 60/min window and its message are unchanged.
- **Validated at `configure()`.** Both fields must be positive integers, or
  `configure()` throws. There is no "off" value, so a typo or an unset
  environment variable cannot disable the limiter.
- **Applied by `start()`, process-wide.** It counts `curl_execute`,
  `utilities().executeRequest` and YAML endpoint tools alike. `shutdown()`
  restores the default. Two servers in one process share one setting, and the
  last `start()` wins.

**This is local throttling, not quota accounting.** The counter lives in this
process: a restart, or an HTTP client reconnecting to a restarted server,
starts it from zero while the upstream's window keeps running. It cannot see
requests made by other processes, apps or clients on the same credential. For
a hard upstream quota, set `max` below it and leave headroom for what this
process cannot see (for example, 200 of a 240/hour quota).

## Environment Variables

Configuration can be set via environment variables (config takes precedence):

| Variable                   | Config Equivalent  |
|----------------------------|--------------------|
| `MCP_CURL_OUTPUT_DIR`      | `outputDir`        |
| `MCP_CURL_ALLOW_LOCALHOST` | `allowLocalhost`   |
| `PORT`                     | `port`             |
| `MCP_AUTH_TOKEN`           | `authToken`        |
| `MCP_CURL_HOST`            | `host`             |
| `MCP_CURL_ALLOWED_ORIGINS` | `allowedOrigins`   |
| `MCP_CURL_USER_AGENT`      | `defaultUserAgent` |
| `MCP_CURL_REFERER`         | `defaultReferer`   |

## Configuration Precedence

1. Explicit config passed to `.configure()` (highest priority)
2. Environment variables
3. Built-in defaults (lowest priority)

## Examples

### Minimal Configuration

```typescript
const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"});

await server.start("stdio");
```

### Full Configuration

```typescript
const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.example.com/v1",
        defaultHeaders: {
            "Accept": "application/json",
        },
        defaultUserAgent: "MyApp/1.0",
        defaultReferer: "https://example.com/",
        defaultTimeout: 60,
        outputDir: "./responses",
        maxResultSize: 1_000_000,
        allowLocalhost: false,
        port: 3000,
        host: "127.0.0.1",
        allowedOrigins: ["https://myapp.example.com"],
        authToken: process.env.MCP_AUTH_TOKEN,
        enableSpotlighting: true,
    });

await server.start("http");
```

### Configuration from Environment

```typescript
// Use environment variables for sensitive config
const server = new McpCurlServer()
    .configure({
        baseUrl: process.env.API_BASE_URL,
        authToken: process.env.MCP_AUTH_TOKEN,
        allowLocalhost: process.env.NODE_ENV === "development",
    });

await server.start(process.env.TRANSPORT === "http" ? "http" : "stdio");
```
