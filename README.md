# cURL MCP Server

An MCP (Model Context Protocol) server that enables LLMs to execute cURL commands for making HTTP requests.

## Features

- **Structured HTTP Requests**: Use `curl_execute` with typed parameters for safe, validated HTTP calls
- **Multiple Auth Methods**: Basic auth, Bearer tokens, and custom headers
- **Response Control**: Follow redirects, include headers, compressed responses
- **Large Response Handling**: Auto-saves responses exceeding size limits to temp files
- **JSON Filtering**: Extract specific data with jq-like path expressions (`jq_filter`)
- **Security**: SSRF protection, rate limiting, CRLF injection prevention
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

## Tools

### `curl_execute`

Execute HTTP requests with structured parameters. This is the only tool available, providing a safe, validated interface
for HTTP requests.

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
| `jq_filter`        | string  | No       | -       | JSON path filter (e.g., `.data[0]`, `.[0:10]`)             |
| `max_result_size`  | number  | No       | 500KB   | Max bytes inline before auto-save (1KB-1MB)                |
| `save_to_file`     | boolean | No       | false   | Force save response to temp file                           |

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

// Get first 10 items from array
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results[0:10]"
}

// Force save large response to file
{
  "url": "https://api.example.com/large-dataset",
  "save_to_file": true
}
```

### Large Response Handling

Responses exceeding `max_result_size` (default: 500KB, max: 1MB) are automatically saved to a temporary file:

- File is saved with secure permissions (owner-only: 0o600)
- Response includes `filepath` pointing to saved file
- Temp files are cleaned up on graceful shutdown

Use `jq_filter` to reduce response size before the limit is checked:

| Syntax | Description | Example |
|--------|-------------|---------|
| `.key` | Object property | `.data` |
| `.[n]` | Array index (negative supported) | `.[0]`, `.[-1]` |
| `.[n:m]` | Array slice | `.[0:10]` |
| `.["key"]` | Bracket notation | `.["special-key"]` |

## MCP Resources

The server exposes documentation as an MCP resource:

- `curl://docs/api` - API documentation with parameter reference and examples

## MCP Prompts

Two prompts are available for common use cases:

- **api-test** - Test an API endpoint and analyze the response
- **api-discovery** - Explore a REST API to discover available endpoints

## Security Considerations

- Only structured `curl_execute` is available (no arbitrary command execution)
- All parameters are validated using Zod schemas
- Commands are executed without shell interpretation to prevent injection
- **SSRF Protection**: Blocks requests to localhost, private IPs (10.x, 172.16-31.x, 192.168.x), link-local, and internal TLDs (.local, .internal, .corp, .lan)
- **Rate Limiting**: 60 requests per minute per target host
- **CRLF Injection Prevention**: Validates headers, user-agent, and auth values for newline characters
- **File Exfiltration Prevention**: Uses `--data-raw` and `--form-string` to prevent `@` file reading
- Maximum response size for processing: 10MB
- Maximum result size for inline return: 1MB (default 500KB)
- Default timeout: 30 seconds
- SSL verification is enabled by default (use `insecure: true` only when necessary)

## License

MIT
