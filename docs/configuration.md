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
    allowedHosts?: readonly string[] | "any";
    rateLimit?: {
        readonly max: number;
        readonly windowMs: number;
        readonly syncFromHeaders?: { readonly remaining: string };
    };
    curlExecuteDescriptionAppend?: string;
}
```

## Configuration Options

| Option               | Type                     | Default     | Description                                                              |
|----------------------|--------------------------|-------------|--------------------------------------------------------------------------|
| `baseUrl`            | `string`                 | none        | Base URL that a `/`-path in `curl_execute` is resolved against           |
| `defaultHeaders`     | `Record<string, string>` | none        | Headers added to all `curl_execute` requests                             |
| `allowedHosts`       | `readonly string[] \| "any"` | `baseUrl`'s host, else any | Hosts a request or redirect hop may reach; see [allowedHosts](#allowedhosts) |
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
| `rateLimit`          | `{ max, windowMs, syncFromHeaders? }` | 60/min | Per-host limit as a sliding window; see [rateLimit](#ratelimit) |
| `curlExecuteDescriptionAppend` | `string`       | none        | Text added to the `curl_execute` description; see [curlExecuteDescriptionAppend](#curlexecutedescriptionappend) |

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
- An absolute URL passes through unchanged. With `allowedHosts` unset, it may go
  only to the `baseUrl`'s host; see [allowedHosts](#allowedhosts).
- A relative value must start with a single `/` and contain no control characters
  (any C0 control, such as tab, CR, LF or NUL, or DEL). One starting `//`, `/\` or `\`
  is refused, because a URL parser reads it as a host; a control character is refused
  because the URL parser strips a tab, CR or LF and percent-encodes the rest, so the
  URL the SSRF check validates is not the value cURL is handed. This applies to
  `curl_execute`'s `url` and to
  `executeRequest`'s `url` and `path` alike, and the refusal is an error result that
  states the rule. `executeRequest`'s `path` is the one exception to the leading
  `/`: one is added where it is missing, so `users` reaches `<baseUrl>/users`.
- A relative value must not contain a `.` or `..` path segment, literal or
  `%2e`-encoded: the URL parser and cURL both resolve one, so `/users/..` would
  request the parent of `/users/`. Only whole segments of the path count; a dot in
  `/v1.2/`, `/.well-known/` or the query string is fine. An absolute URL is not
  checked, because it names its own path.
- The joined URL still goes through the SSRF check, like every other request.
- If `baseUrl` is not an absolute http(s) URL and `allowedHosts` is unset, `start()`
  throws, because the default host list cannot be derived from it. With
  `allowedHosts` set, a relative call fails with an error that names the `baseUrl`
  key without echoing its value.

**Setting `baseUrl` also sets the default host list.** With `allowedHosts` unset,
requests and redirect hops may go only to the `baseUrl`'s host. Set
`allowedHosts: "any"` to send absolute URLs elsewhere. The list checks the host
only: an `http://` URL on that host also receives `defaultHeaders`, and a call may
set `insecure: true`. Keep an API key in `defaultHeaders`, never in tool-call
arguments, so it stays out of the transcript. A call that sets `verbose` is the
exception: cURL's trace prints the request headers, `defaultHeaders` included, and
that trace is returned with the response.

### defaultHeaders

Added to every request the host list lets through: with `allowedHosts` unset on a
`baseUrl` server, that is the `baseUrl`'s host alone, but with `allowedHosts: "any"`
or a longer list, every host on it gets them. A redirect to another origin forwards
only `Accept`, `Accept-Language`, `Accept-Encoding`, `User-Agent` and, while the
body is kept, its body headers (see [allowedHosts](#allowedhosts)), so a key here is not sent to a host a redirect
names unless it sits in one of those headers. Keep credentials out of them. Merged with request-specific headers (request headers take precedence):

```typescript
.
configure({
    defaultHeaders: {
        "Accept": "application/json",
        "X-Client-Version": "1.0.0",
    }
})
```

### allowedHosts

The hosts a request may go to. Set it to a list of host names, to `"any"`, or leave
it unset:

```typescript
configure({
    baseUrl: "https://api.example.com/v1",
    allowedHosts: ["api.example.com", "uploads.example.com"],
})
```

- **Unset.** A server with a `baseUrl` may reach only the `baseUrl`'s host. A
  server without one may reach any host.
- **`"any"`** allows every host. **`[]`** refuses every request.
- **Matching.** Exact, case-insensitive, trailing dots ignored. An entry is a bare
  host name or an IP literal, with IPv6 in brackets: no scheme, port, path,
  userinfo or wildcard, or `configure()` throws.
- **Checked before DNS.** A refused host is never resolved or contacted. The
  refusal is `LOCAL_HOST_NOT_ALLOWED`; see [Local refusals](#local-refusals). The
  SSRF check still applies to every allowed host.
- **Every redirect hop is checked too.** mcp-curl follows 301, 302, 303, 307 and
  308 itself, one hop at a time, and each hop passes the host list, the SSRF check
  with its own `--resolve` pin, and the rate limit. A refused hop returns
  `LOCAL_REDIRECT_REFUSED`, which says how many requests were sent. A chain longer
  than `max_redirects` (default 10) is refused the same way.
- **Cross-origin hops drop credentials.** A hop to an origin other than the first
  request's keeps only `Accept`, `Accept-Language`, `Accept-Encoding` and
  `User-Agent`, plus the body headers while the body is kept; every other header,
  `basic_auth` and `bearer_token` are dropped, and stay dropped if the chain comes
  back. 303 turns every method but `HEAD` into a body-less `GET`, and 301/302 do
  the same to `POST`; 307 and 308 keep the method and body, so a secret in `data`
  or `form` reaches the new origin, including a change of scheme or port on the
  same host. Set `follow_redirects: false` on calls whose body carries one.
- **YAML servers.** `createApiServer()` derives the default list from the schema's
  `baseUrl`, and its YAML tools use the server's list. An embedder that overrides
  `generatorConfig.baseUrl` with a URL on another host sets `allowedHosts`
  explicitly, or every call to that host is refused.
- **The shipped binary has no `allowedHosts` setting.** It sets no `baseUrl` either,
  so it may reach any host the SSRF check allows.

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
  request is refused, not queued, until the oldest leaves the window. The refusal is
  `LOCAL_RATE_LIMITED` and ends with how long to wait: `Retry in N s.` Without
  `rateLimit` the fixed 60/min window applies, and its refusal takes the same
  shape.
- **Validated at `configure()`.** Both fields must be positive integers, and an
  unknown key (a misspelt `syncFromHeaders`, say) is refused, or `configure()`
  throws. There is no "off" value, so a typo or an unset
  environment variable cannot disable the limiter. `configure()` keeps its own
  copy, so changing your object afterwards changes nothing.
- **Applied by `start()`, process-wide.** It counts `curl_execute`,
  `utilities().executeRequest` and YAML endpoint tools alike — including those
  of any other server in the same process. That server's `shutdown()`, or a
  `start()` of its that fails, leaves your limit in place: only the server that
  set it restores the default, at its own `shutdown()` or failed `start()`.
- **One server sets it at a time.** While one server holds a `rateLimit`, a
  second server's `start()` with a `rateLimit` of its own throws, even an equal
  one, rather than replacing the first. Shut the first down to change it.
- **The count survives an in-process restart.** `shutdown()` keeps the
  requests already counted, so a server that starts again — or another that
  takes over — with the same `windowMs` does not get a fresh quota inside the
  window. A different `windowMs` starts the count from zero.
- **One host, one count.** `api.example.com.` (with a trailing dot) counts
  against the same budget as `api.example.com`.
- **Header sync.** `syncFromHeaders: { remaining: "<header name>" }` names a
  response header carrying the requests the upstream will still admit in its
  window. After each response, including each redirect hop, the host that
  answered is counted as having used at least `max − remaining`. It only ever
  tightens the count, and an absent, empty or malformed value changes nothing.
  The name must be an HTTP field name without `%`, and `remaining` is the only
  key; anything else makes `configure()` throw. Reading the header needs cURL
  7.84 or later, and mcp-curl does not check the version: on an older cURL the
  response's metadata cannot be read, which fails safe as undetermined.

  ```typescript
  configure({rateLimit: {max: 200, windowMs: 3_600_000, syncFromHeaders: {remaining: "X-RateLimit-Remaining"}}})
  ```

**This is local throttling, not quota accounting.** The counter lives in this
process: a process restart, or an HTTP client reconnecting to a restarted process,
starts it from zero while the upstream's window keeps running. It cannot see
requests made by other processes, apps or clients on the same credential. For
a hard upstream quota, use `syncFromHeaders` where the upstream reports its
remaining count: the first response after a restart, or after another client
spent quota, corrects the local count. That is best-effort: requests sent before
that response, and quota spent elsewhere after the last one, are still unseen.
The correction also expires after `windowMs`, not at the upstream's reset, so set
`windowMs` to the upstream's window. Set `max` below the quota either way, and leave headroom for what this process
cannot see (for example, 200 of a 240/hour quota).

### curlExecuteDescriptionAppend

Add what the model needs to know about the API this server fronts to the end of
the `curl_execute` description, where it reads it before every call.

```typescript
configure({
    baseUrl: "https://api.example.com",
    curlExecuteDescriptionAppend: `Example API v2. Paths start with /v2.
GET /v2/me returns the user; project endpoints are /v2/projects/{id}/...
Lists page with ?page=N; a 429 means the hourly quota is spent: stop and tell the user.`,
})
```

- **Keep it short.** The description is sent on every turn of every session
  that connects this server, so every byte here is paid for again and again.
  Put tool-shaped knowledge in it — path prefixes, self-scoped endpoints, body
  shapes, pagination, which status means quota — which typically fits in
  2–4 KB. Domain knowledge belongs in the host project, not here.
- **Capped, never truncated.** `configure()` replaces each run of Unicode attack
  codepoints (bidi overrides, zero-width characters and the like) with a space and
  trims the ends, as `sanitizeDescription` does for custom tools, then throws if
  the result is longer than `MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH` (8000
  characters), naming the length and the cap. The cap is a ceiling against runaway
  prompt cost, not a target.
- **Trusted config.** The text is yours, not the remote's, so it does not take
  the response-side defence pipeline. Do not build it from API responses.
- **Appended, not replacing.** The built-in description is unchanged; your text
  follows its last line, after a blank line.
- **Only where it can be used.** With `disableCurlExecute()` the tool is still
  listed, but without your append, and `start()` warns that the append is set
  but never shown.

**The version line.** The built-in description carries a line
`mcp-curl v<version>`, matching `^mcp-curl v\d+\.\d+\.\d+$`, so a model or
an embedder can read the version from inside a session; line 1 stays the tool's
summary. Find it by searching for a line matching that pattern, not by taking the
last line: with an append it is not the last line. The token is the npm package name, which is what you pin. The MCP
`serverInfo.name` the server reports at initialisation is `curl-mcp-server`, a
different string. Because the version is in the description, the description's
bytes change with every release.

## Local refusals

A request refused for one of the reasons below returns an error result that
begins `Refused locally: no request was sent (CODE).`, or for
`LOCAL_REDIRECT_REFUSED` the line its row gives, followed by the reason. A
refusal whose reason is the rate limit then ends `Retry in N s.`
The text never names a host, URL or header value. An SSRF or DNS refusal of the
first request is not one of these: it keeps its own message.

| Code | When |
|---|---|
| `LOCAL_HOST_NOT_ALLOWED` | The target host is not in `allowedHosts` |
| `LOCAL_RATE_LIMITED` | The per-host or per-client limit is exhausted |
| `LOCAL_REFUSED_PATH` | A relative `url` or a YAML path parameter would leave its path (`//`, `\`, a control character, a `.` or `..` segment) |
| `LOCAL_REDIRECT_REFUSED` | A redirect hop was refused, for its host, its address, the rate limit, an unusable target or `max_redirects`. Its first line is `Redirect refused locally: N request(s) were sent; hop N+1 was not (LOCAL_REDIRECT_REFUSED).`, because the earlier hops did reach the network |

When `curl_execute` refuses a host, a rate limit or a redirect hop, its stderr
line, `curl_execute error: [host] LocalRefusalError CODE`, carries the code and
never the message. A refused relative path is returned before that point and
logs nothing.

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
