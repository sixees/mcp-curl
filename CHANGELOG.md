# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-01-23

### Changed

- Increased maximum response size from 1MB to 2MB to support larger API responses

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