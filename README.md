# cURL MCP Server

An MCP (Model Context Protocol) server that enables LLMs to execute cURL commands for making HTTP requests.

## Features

- **Structured HTTP Requests**: Use `curl_execute` with typed parameters for safe, validated HTTP calls
- **Multiple Auth Methods**: Basic auth, Bearer tokens, and custom headers
- **Response Control**: Follow redirects, include headers, compressed responses
- **Large Response Handling**: Auto-saves responses exceeding size limits to configurable output directory
- **JSON Filtering**: Extract specific data with jq-like path expressions (`jq_filter`)
    - Dot notation for arrays: `.results.0.name` or `.results[0].name`
    - Multiple paths: `.name,.email,.id` returns array of values
- **JSON File Querying**: Use `jq_query` to re-query saved files without new HTTP requests
- **Security**: SSRF protection, rate limiting, CRLF injection prevention, file access restrictions
- **Error Handling**: Clear error messages with exit codes and metadata
- **Built-in Documentation**: MCP resources and prompts for discoverability
- **Dual Transport**: Supports both stdio (for Claude Desktop/Code) and HTTP transports

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Code

The easiest way is to install directly from GitHub using npx:

```json
{
  "mcpServers": {
    "curl": {
      "command": "npx",
      "args": [
        "-y",
        "github:sixees/mcp-curl"
      ]
    }
  }
}
```

Or with a local clone:

```json
{
  "mcpServers": {
    "curl": {
      "command": "node",
      "args": [
        "/path/to/mcp-curl/dist/index.js"
      ]
    }
  }
}
```

### With Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "curl": {
      "command": "npx",
      "args": [
        "-y",
        "github:sixees/mcp-curl"
      ]
    }
  }
}
```

### Standalone Usage

**Stdio Transport (Default):**

```bash
npm start
# or
node dist/index.js
```

**HTTP Transport:**

```bash
TRANSPORT=http PORT=3000 npm start
```

**HTTP Transport with Authentication:**

When running in HTTP mode, you can require bearer token authentication to prevent unauthorized access:

```bash
TRANSPORT=http PORT=3000 MCP_AUTH_TOKEN=your-secret-token npm start
```

Clients must include the token in the Authorization header:

```
Authorization: Bearer your-secret-token
```

## Tools

### `curl_execute`

Execute HTTP requests with structured parameters. Provides a safe, validated interface for HTTP requests.

**Parameters:**

| Parameter          | Type    | Required | Default | Description                                                |
|--------------------|---------|----------|---------|------------------------------------------------------------|
| `url`              | string  | Yes      | -       | The URL to request                                         |
| `method`           | string  | No       | GET     | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| `headers`          | object  | No       | -       | HTTP headers as key-value pairs                            |
| `data`             | string  | No       | -       | Request body data                                          |
| `form`             | object  | No       | -       | Form data as key-value pairs                               |
| `follow_redirects` | boolean | No       | true    | Follow HTTP redirects                                      |
| `max_redirects`    | number  | No       | -       | Maximum redirects to follow (0-50)                         |
| `insecure`         | boolean | No       | false   | Skip SSL certificate verification                          |
| `timeout`          | number  | No       | 30      | Request timeout in seconds (1-300)                         |
| `user_agent`       | string  | No       | -       | Custom User-Agent header                                   |
| `basic_auth`       | string  | No       | -       | Basic auth as "username:password"                          |
| `bearer_token`     | string  | No       | -       | Bearer token for Authorization                             |
| `verbose`          | boolean | No       | false   | Include verbose output                                     |
| `include_headers`  | boolean | No       | false   | Include response headers                                   |
| `compressed`       | boolean | No       | true    | Request compressed response                                |
| `include_metadata` | boolean | No       | false   | Wrap response in JSON metadata                             |
| `jq_filter`        | string  | No       | -       | JSON path filter (e.g., `.data[0]`, `.name,.email`)        |
| `max_result_size`  | number  | No       | 500KB   | Max bytes inline before auto-save (1KB-1MB)                |
| `save_to_file`     | boolean | No       | false   | Force save response to file                                |
| `output_dir`       | string  | No       | -       | Custom directory for saved files (overrides env var)       |

**Examples:**

```json
// Simple GET request
{
  "url": "https://api.github.com/users/octocat"
}

// POST with JSON body
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "data": "{\"name\": \"John Doe\", \"email\": \"john@example.com\"}"
}

// With Bearer token authentication
{
  "url": "https://api.example.com/protected",
  "bearer_token": "your-access-token"
}

// Form submission
{
  "url": "https://example.com/upload",
  "method": "POST",
  "form": {
    "field1": "value1",
    "field2": "value2"
  }
}

// Extract specific field with jq_filter
{
  "url": "https://api.github.com/repos/octocat/hello-world",
  "jq_filter": ".name"
}

// Extract multiple fields (returns array)
{
  "url": "https://api.github.com/users/octocat",
  "jq_filter": ".name,.email,.location"
}

// Dot notation for array access
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results.0.name"
}

// Get first 10 items from array
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results[0:10]"
}

// Save to custom directory (accessible by AI clients)
{
  "url": "https://api.example.com/large-dataset",
  "save_to_file": true,
  "output_dir": "/path/to/accessible/directory"
}
```

### Large Response Handling

Responses exceeding `max_result_size` (default: 500KB, max: 1MB) are automatically saved to a file.

**Output Directory Priority:**

1. `output_dir` parameter (if provided)
2. `MCP_CURL_OUTPUT_DIR` environment variable (if set)
3. System temp directory (cleaned up on shutdown)

**File Properties:**

- Saved with secure permissions (owner-only: 0o600)
- Response includes `filepath` pointing to saved file
- Files in custom `output_dir` are NOT auto-cleaned (user-managed)

Use `jq_filter` to reduce response size before the limit is checked:

| Syntax         | Description                     | Example            |
|----------------|---------------------------------|--------------------|
| `.key`         | Object property                 | `.data`            |
| `.[n]` or `.n` | Array index (non-negative only) | `.[0]`, `.0`       |
| `.[n:m]`       | Array slice                     | `.[0:10]`          |
| `.["key"]`     | Bracket notation                | `.["special-key"]` |
| `.a,.b,.c`     | Multiple paths (returns array)  | `.name,.email`     |

**Filter Validation:**

- Maximum 20 comma-separated paths
- Unclosed quotes and unmatched brackets throw clear errors
- Leading zeros in indices are rejected (use `.0` not `.00`)
- Negative indices are not supported (unlike real `jq`, `[-1]` will error)
- Indices must be within JavaScript safe integer range

### jq_query Tool

Query existing JSON files without making new HTTP requests. Useful for extracting different fields from saved responses.

**Parameters:**

| Parameter         | Type    | Required | Description                                      |
|-------------------|---------|----------|--------------------------------------------------|
| `filepath`        | string  | Yes      | Path to JSON file (must be in allowed directory) |
| `jq_filter`       | string  | Yes      | JSON path filter expression                      |
| `max_result_size` | number  | No       | Max bytes inline (default: 500KB)                |
| `save_to_file`    | boolean | No       | Force save result to file                        |
| `output_dir`      | string  | No       | Directory for saved result files                 |

**Security:** Only files in these directories can be read:

- Temp directory (files saved by curl_execute)
- `MCP_CURL_OUTPUT_DIR` path
- Current working directory and all subdirectories

> **Warning**: The cwd permission is broad. Ensure the server's working directory doesn't contain sensitive files you
> don't want accessible via `jq_query`.

**Example:**

```json
{
  "filepath": "/path/to/saved_response.txt",
  "jq_filter": ".users[0:5]"
}
```

## MCP Resources

The server exposes documentation as an MCP resource:

- `curl://docs/api` - API documentation with parameter reference and examples

## MCP Prompts

Two prompts are available for common use cases:

- **api-test** - Test an API endpoint and analyze the response
- **api-discovery** - Explore a REST API to discover available endpoints

## Security Considerations

### Network Security

- **SSRF Protection**: Blocks requests to private networks and internal hosts:
    - **Protocol whitelist**: Only `http://` and `https://` allowed; `file://`, `ftp://`, etc. blocked
    - **Windows UNC paths**: `\\server\share` patterns blocked to prevent internal network share access
    - **DNS Rebinding Prevention**: DNS is resolved before validation, and cURL is pinned to the validated
      IP using `--resolve`. This prevents attacks where DNS returns a public IP during validation but a
      private IP when cURL connects.
    - Private IPs: 10.x, 172.16-31.x, 192.168.x, 169.254.x (link-local)
    - IPv4-mapped IPv6: `::ffff:` prefixed versions of all blocked IPv4 ranges
    - IPv6 private: loopback (::1), link-local (fe80::), unique local (fc00::, fd00::)
    - Internal TLDs (case-insensitive): .local, .internal, .corp, .lan, .localhost
    - **Localhost**: Blocked by default. Set `MCP_CURL_ALLOW_LOCALHOST=true` to enable for local
      development/testing. When enabled, only ports 80, 443, and >1024 are allowed (privileged
      service ports like 22, 25, 3306 remain blocked)

### Rate Limiting

- **Dual limits** prevent abuse:
    - Per-hostname: 60 requests/minute to any single host (protects target servers)
    - Per-client: 300 requests/minute total (prevents bypassing host limits via many hostnames)

### Input Validation

- Only structured `curl_execute` and `jq_query` tools available (no arbitrary command execution)
- All parameters are validated using Zod schemas
- Commands are executed without shell interpretation to prevent injection
- **CRLF Injection Prevention**: Validates headers, user-agent, and auth values for newline characters
- **File Exfiltration Prevention**: Uses `--data-raw` and `--form-string` to prevent `@` file reading
- **Response Injection Prevention**: Uses unique per-request separators for metadata to prevent crafted responses from
  injecting fake metadata

### File Access Security

- **File Access Restrictions**: `jq_query` can only read from temp directory, `MCP_CURL_OUTPUT_DIR`, or cwd (including
  all subdirectories - ensure cwd doesn't contain sensitive files)
- **Symlink Escape Prevention**: All file paths and output directories are resolved via `realpath()` before
  validation. This prevents attacks where a symlink in an allowed directory points outside it:
  ```
  # Example attack that is blocked:
  # Attacker creates: /allowed/dir/data.json -> /etc/passwd
  # Without realpath: "/allowed/dir/data.json" passes check, reads /etc/passwd
  # With realpath: Resolves to "/etc/passwd", blocked as outside allowed dirs
  ```
- **Path Traversal Prevention**: `output_dir` and `filepath` reject paths containing `..`

### Resource Limits

- Maximum response/file size for processing: 10MB
- Maximum result size for inline return: 1MB (default 500KB)
- **Global memory limit**: 100MB across all concurrent requests (prevents memory exhaustion)
- Maximum jq_filter paths: 20 comma-separated expressions
- **JQ parsing timeout**: 100ms (prevents ReDoS attacks via crafted filters)
- Default request timeout: 30 seconds
- SSL verification is enabled by default (use `insecure: true` only when necessary)

### HTTP Transport Security

- **Authentication**: Set `MCP_AUTH_TOKEN` environment variable to require bearer token authentication
- **Session Management**: Maximum 100 concurrent sessions
- **Session Timeout**: Idle sessions are cleaned up after 1 hour (cleanup runs every 5 minutes)

## License

MIT
