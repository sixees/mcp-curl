# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **cURL protocol restriction** – Added `--proto=http,https` to all requests as defense-in-depth alongside URL
  validation, preventing protocol confusion between Node's URL parser and cURL's parser

- **cURL size abort** – Added `--max-filesize` (10MB) to abort early when `Content-Length` exceeds the limit (cURL exit
  code 63), before data streams into Node. Chunked/streaming responses without Content-Length still rely on the
  Node-level backstop in `command-executor.ts`

- **Minimal error logging** – Server-side `console.error` now logs only `[hostname]` or `[filename]` with error class
  name. Previously could leak auth headers from `-v` mode, URLs with tokens, cURL stderr fragments, file content
  snippets, or system paths. User-facing error messages are unchanged

## [1.1.5] - 2026-01-27

### Added

- **New `jq_query` tool** - Query saved JSON files without making new HTTP requests
    - Restricted to safe directories (temp, output_dir, cwd)
    - 10MB file size limit
    - Same jq_filter syntax as curl_execute

- **Large response handling** – Automatic handling of responses up to 10MB
    - `jq_filter` parameter for extracting specific JSON data
    - Dot notation for arrays (`.results.0` same as `.results[0]`)
    - Multiple paths support (`.name,.email` returns array, max 20 paths)
    - Array slicing (`.users[0:5]`)
    - Auto-save to file when result exceeds `max_result_size` (default 500KB)
    - `save_to_file` parameter for explicit file saving
    - `output_dir` parameter with `MCP_CURL_OUTPUT_DIR` env var fallback

### Security

- **SSRF protection** – Blocks requests to private networks and internal hosts
    - Private IP ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x
    - IPv4-mapped IPv6 addresses
    - IPv6 private ranges (loopback, link-local, unique local)
    - Internal TLDs: .local, .internal, .corp, .lan, .localhost (case-insensitive)
    - Cloud metadata hostnames: `metadata.google.internal`, `instance-data.ec2.internal`, `metadata.azure.com`
    - DNS rebinding services: `*.nip.io`, `*.sslip.io`, `*.xip.io`

- **DNS rebinding prevention** – DNS resolved before validation, cURL pinned to validated IP via `--resolve`

- **Protocol whitelist** - Only `http://` and `https://` allowed; `file://`, `ftp://`, UNC paths blocked

- **Symlink security** – All paths resolved via `realpath()` before validation to prevent symlink escape attacks

- **Path traversal protection** - Explicit `..` blocking in both `output_dir` and `filepath` parameters

- **Authentication** – Optional bearer token via `MCP_AUTH_TOKEN` env var for HTTP transport

- **Rate limiting** – Dual limits prevent abuse
    - Per-hostname: 60 requests/minute
    - Per-client: 300 requests/minute total

- **Resource limits**
    - jq filter parsing timeout: 100ms (prevents ReDoS)
    - Global memory limit: 100MB across concurrent requests
    - Session idle timeout: 1 hour with automatic cleanup

- **Command allowlist** – `executeCommand()` restricted to `"curl"` only via TypeScript literal type and runtime guard

- **Input validation**
    - CRLF injection protection for headers, user-agent, auth values
    - Per-request unique metadata separator prevents response injection
    - Strict jq_filter validation (unclosed quotes/brackets, leading zeros, safe integer bounds)

- **Localhost access** – Blocked by default; `MCP_CURL_ALLOW_LOCALHOST=true` enables with port restrictions

### Changed

- Maximum response size increased to 10MB for processing (inline result limit remains configurable)
- Negative indices are no longer supported in jq_filter for simplicity and security

## [1.0.2] - 2026-01-23

### Changed

- Increased the maximum response size from 1MB to 4MB to support larger API responses

## [1.0.0] - 2025-12-12

### Added

- Initial release
- `curl_execute` tool for structured HTTP requests with typed parameters
- Support for common HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Authentication options (basic auth, bearer token)
- Request customization (headers, body, form data, user agent)
- Response options (follow redirects, include headers, compressed responses)
- Timeout configuration (1-300 seconds)
- SSL verification control
- JSON metadata output option
- Built-in API documentation resource (`curl://docs/api`)
- Prompt templates for API testing and discovery
- Stdio and HTTP transport support
- Session management for HTTP transport