// src/lib/resources/documentation.ts
// Registers the API documentation resource

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Registers the documentation resource on the MCP server.
 * Provides API documentation and usage examples.
 */
export function registerDocumentationResource(server: McpServer): void {
    server.registerResource(
        "documentation",
        "curl://docs/api",
        {
            title: "cURL MCP Server Documentation",
            description: "API documentation and usage examples for the cURL MCP server",
            mimeType: "text/markdown",
        },
        async () => ({
            contents: [{
                uri: "curl://docs/api",
                mimeType: "text/markdown",
                text: `# cURL MCP Server API

## Tool: curl_execute

Execute HTTP requests with structured, validated parameters.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | Yes | - | The URL to request |
| method | string | No | GET | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| headers | object | No | - | HTTP headers as key-value pairs |
| data | string | No | - | Request body data |
| form | object | No | - | Form data as key-value pairs |
| timeout | number | No | 30 | Request timeout in seconds (1-300) |
| bearer_token | string | No | - | Bearer token for Authorization |
| basic_auth | string | No | - | Basic auth as "username:password" |
| follow_redirects | boolean | No | true | Follow HTTP redirects |
| include_headers | boolean | No | false | Report response headers. Never written into the saved file or the jq_filter input; a separate \`headers\` key under include_metadata, otherwise prefixed to the returned text |
| include_metadata | boolean | No | false | Return JSON with metadata |
| jq_filter | string | No | - | JSON path filter (e.g., ".data.items[0]") |
| max_result_size | number | No | 500KB | Max bytes inline before auto-save (max: 1MB) |
| save_to_file | boolean | No | false | Force save response to temp file |
| output_dir | string | No | - | Custom directory for saved files (overrides MCP_CURL_OUTPUT_DIR) |

### Large Response Handling

Response **bodies** larger than \`max_result_size\` (default: 500KB) are automatically saved to a file.
Files are saved to (in priority order):
1. \`output_dir\` parameter if provided
2. \`MCP_CURL_OUTPUT_DIR\` environment variable if set
3. System temp directory (cleaned up on shutdown)

\`max_result_size\` bounds the body. Header text from \`include_headers\` is surfaced inline even
when the body was saved to a file, and is capped at \`min(64KB, max_result_size)\` — it honours
the caller's inline budget as well as its own ceiling. Three states are reported out of band
under \`include_metadata\`, and as a leading \`[mcp-curl]\` notice otherwise — never as a marker
inside the header text, which a server could simply send verbatim:

- \`headers_truncated\` / \`header_bytes_received\` — the text was cut to fit the ceiling.
- \`headers_undetermined\` — headers were requested and the origin sent no header block.
- \`headers_unsupported\` — this host cannot capture headers at all (macOS only). A fact about
  the host, deliberately distinct from \`headers_undetermined\`, which is a fact about the origin.

An absent \`headers\` key is therefore not evidence the origin sent none — check which of the
three states is set.

### jq_filter Syntax

Extract data from JSON responses:
- \`.key\` - Get object property
- \`.[n]\` or \`.n\` - Get array element at index n (non-negative only)
- \`.[n:m]\` - Array slice from n to m
- \`.["key"]\` - Bracket notation for keys with special chars
- \`.name,.email\` - Multiple comma-separated paths (returns array of values, max 20)

**Validation:**
- Unclosed quotes and unmatched brackets throw clear errors
- Leading zeros in indices are rejected (use \`.0\` not \`.00\`)
- Negative indices are not supported (unlike real \`jq\`)
- Indices must be within JavaScript safe integer range

### Examples

**Simple GET request:**
\`\`\`json
{ "url": "https://api.github.com/users/octocat" }
\`\`\`

**Extract multiple fields:**
\`\`\`json
{
  "url": "https://api.github.com/users/octocat",
  "jq_filter": ".name,.email,.location"
}
\`\`\`

**Using dot notation for arrays:**
\`\`\`json
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results.0.name"
}
\`\`\`

**Save to custom directory:**
\`\`\`json
{
  "url": "https://api.example.com/large",
  "save_to_file": true,
  "output_dir": "/path/to/accessible/dir"
}
\`\`\`

## Tool: jq_query

Query existing JSON files with jq_filter without making new HTTP requests.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filepath | string | Yes | Path to JSON file (must be in allowed directory) |
| jq_filter | string | Yes | JSON path filter expression |
| max_result_size | number | No | Max bytes inline (default: 500KB) |
| save_to_file | boolean | No | Force save result to file |
| output_dir | string | No | Directory for saved result files |

### Security

Files can only be read from:
- Our temp directory (files saved by curl_execute)
- MCP_CURL_OUTPUT_DIR path
- Current working directory and all subdirectories

**Note:** The cwd permission is broad. Ensure the server's working directory doesn't contain sensitive files.

### Example

\`\`\`json
{
  "filepath": "/path/to/saved_response.txt",
  "jq_filter": ".users[0:5].name"
}
\`\`\`

## Security

### Network Protection
- **SSRF Prevention**: Blocks private IPs, IPv4-mapped IPv6, internal TLDs
- **DNS Rebinding Prevention**: DNS resolved before validation, cURL pinned via \`--resolve\`
- **Protocol Whitelist**: Only http:// and https:// allowed
- **Localhost**: Blocked by default (set MCP_CURL_ALLOW_LOCALHOST=true with port restrictions)

### Rate Limits
- Per-hostname: 60 requests/minute
- Per-client: 300 requests/minute total (HTTP: per session; stdio: shared single bucket)

### Resource Limits
- Max response for processing: 10MB
- Max inline result: 1MB (default 500KB)
- Global memory limit: 100MB across concurrent requests
- JQ parsing timeout: 100ms
- Request timeout: 30 seconds (configurable up to 300s)

### File Security
- Symlinks resolved via realpath() before validation
- Path traversal (\`..\`) blocked
- jq_query restricted to temp dir, MCP_CURL_OUTPUT_DIR, and cwd

### Response Sanitisation (text content only)
- Unicode attack chars stripped: bidi overrides, zero-width family, "Sneaky Bits"
  Variation Selector Supplement (U+E0100–U+E01EF), Braille blank, Arabic letter
  mark, Mongolian invisibles, Hangul fillers, Tags block, BOM, and more
- Visual-space-padding runs (50+ tabs / NBSP / em-spaces / IDEOGRAPHIC SPACE)
  collapsed to a single space; newline runs (20+) collapsed to a single newline
- HTML / XHTML / SVG / *+xml: \`<script>\` and \`<style>\` blocks removed
  (ReDoS-hardened, numeric-entity decode, 256 KB cap)
- Markdown: image beacons and external links replaced with \`[image removed]\`
  / \`[link removed]\`; dangerous-scheme URLs (\`javascript:\`, \`vbscript:\`,
  \`file:\`, \`data:\`) blocked in both links and images

## Common Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 6 | Could not resolve host |
| 7 | Failed to connect |
| 28 | Operation timeout |
| 35 | SSL connect error |
| 52 | Empty reply from server |
`,
            }],
        })
    );
}
