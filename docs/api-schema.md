# YAML Schema Reference

This document describes the YAML format for defining API endpoints that generate MCP tools.

## Overview

YAML schema definitions let you declaratively define an API and automatically generate MCP tools for each endpoint. This
is useful for:

- Wrapping existing REST APIs
- Creating domain-specific tools without custom code
- Sharing API definitions across projects

## Basic Structure

```yaml
apiVersion: "1.0"

api:
  name: my-api
  title: My API
  description: Description for LLM context
  version: "1.0.0"
  baseUrl: https://api.example.com

auth:
  bearer:
    envVar: MY_API_TOKEN

defaults:
  timeout: 30
  headers:
    Accept: application/json

endpoints:
  - id: get_users
    path: /users
    method: GET
    title: Get Users
    description: Fetch all users from the API
```

## Schema Reference

### Root Fields

| Field        | Type    | Required | Description                  |
|--------------|---------|----------|------------------------------|
| `apiVersion` | `"1.0"` | Yes      | Schema version               |
| `api`        | object  | Yes      | API metadata                 |
| `auth`       | object  | No       | Authentication configuration |
| `defaults`   | object  | No       | Default settings             |
| `endpoints`  | array   | Yes      | Endpoint definitions         |

### api Object

```yaml
api:
  name: my-api              # Machine-readable name
  title: My API             # Human-readable title
  description: Description  # Description for LLM context
  version: "1.0.0"          # API version
  baseUrl: https://api.example.com
```

| Field         | Type   | Required | Description                 |
|---------------|--------|----------|-----------------------------|
| `name`        | string | Yes      | Machine-readable identifier |
| `title`       | string | Yes      | Human-readable name         |
| `description` | string | Yes      | LLM context description     |
| `version`     | string | Yes      | API version                 |
| `baseUrl`     | string | Yes      | Base URL for all endpoints  |

### auth Object

Supports API key and bearer token authentication.

#### API Key Authentication

```yaml
auth:
  apiKey:
    type: query      # or "header"
    name: api_key    # Parameter/header name
    envVar: API_KEY  # Environment variable
    required: true   # Optional, default: true
```

#### Bearer Token Authentication

```yaml
auth:
  bearer:
    envVar: API_TOKEN
    required: true
```

| Field             | Type                    | Required | Description                  |
|-------------------|-------------------------|----------|------------------------------|
| `apiKey.type`     | `"query"` \| `"header"` | Yes      | Where to place the key       |
| `apiKey.name`     | string                  | Yes      | Parameter or header name     |
| `apiKey.envVar`   | string                  | Yes      | Environment variable name    |
| `apiKey.required` | boolean                 | No       | Require auth (default: true) |
| `bearer.envVar`   | string                  | Yes      | Environment variable name    |
| `bearer.required` | boolean                 | No       | Require auth (default: true) |

### defaults Object

```yaml
defaults:
  timeout: 30
  headers:
    Accept: application/json
    X-Client: my-app
```

| Field     | Type   | Description                   |
|-----------|--------|-------------------------------|
| `timeout` | number | Default timeout in seconds    |
| `headers` | object | Headers added to all requests |

### endpoints Array

Each endpoint generates one MCP tool.

```yaml
endpoints:
  - id: get_user
    path: /users/{id}
    method: GET
    title: Get User
    description: Fetch a user by their ID
    parameters:
      - name: id
        in: path
        type: string
        required: true
        description: User ID
    response:
      jqFilter: ".data"
      filterPresets:
        - name: minimal
          jqFilter: ".data | {id, name}"
```

#### Endpoint Fields

| Field         | Type   | Required | Description                            |
|---------------|--------|----------|----------------------------------------|
| `id`          | string | Yes      | Tool name (lowercase with underscores) |
| `path`        | string | Yes      | URL path with `{param}` placeholders   |
| `method`      | string | Yes      | HTTP method                            |
| `title`       | string | Yes      | Human-readable title                   |
| `description` | string | Yes      | Description for LLM                    |
| `parameters`  | array  | No       | Parameter definitions                  |
| `response`    | object | No       | Response processing config             |

#### Parameter Definition

```yaml
parameters:
  - name: id
    in: path
    type: string
    required: true
    description: Resource identifier
    default: "default-value"
    enum: [ option1, option2 ]
```

| Field         | Type                                                   | Required | Description                     |
|---------------|--------------------------------------------------------|----------|---------------------------------|
| `name`        | string                                                 | Yes      | Parameter name                  |
| `in`          | `"path"` \| `"query"` \| `"header"` \| `"body"`        | Yes      | Where to place                  |
| `type`        | `"string"` \| `"number"` \| `"boolean"` \| `"integer"` | Yes      | Data type                       |
| `required`    | boolean                                                | No       | Required field (default: false) |
| `description` | string                                                 | No       | Description for LLM             |
| `default`     | any                                                    | No       | Default value                   |
| `enum`        | array                                                  | No       | Allowed values                  |

#### Response Configuration

```yaml
response:
  jqFilter: ".data"           # Default filter
  filterPresets: # Named presets
    - name: minimal
      jqFilter: ".data | {id}"
    - name: full
      jqFilter: ".data"
```

## Complete Example

```yaml
apiVersion: "1.0"

api:
  name: jsonplaceholder
  title: JSONPlaceholder API
  description: Free fake API for testing and prototyping
  version: "1.0.0"
  baseUrl: https://jsonplaceholder.typicode.com

defaults:
  timeout: 30
  headers:
    Accept: application/json

endpoints:
  - id: list_posts
    path: /posts
    method: GET
    title: List Posts
    description: Get all posts, optionally filtered by user
    parameters:
      - name: userId
        in: query
        type: integer
        required: false
        description: Filter posts by user ID

  - id: get_post
    path: /posts/{id}
    method: GET
    title: Get Post
    description: Get a specific post by ID
    parameters:
      - name: id
        in: path
        type: integer
        required: true
        description: Post ID

  - id: create_post
    path: /posts
    method: POST
    title: Create Post
    description: Create a new post
    parameters:
      - name: title
        in: body
        type: string
        required: true
        description: Post title
      - name: body
        in: body
        type: string
        required: true
        description: Post content
      - name: userId
        in: body
        type: integer
        required: true
        description: Author user ID

  - id: update_post
    path: /posts/{id}
    method: PUT
    title: Update Post
    description: Update an existing post
    parameters:
      - name: id
        in: path
        type: integer
        required: true
        description: Post ID
      - name: title
        in: body
        type: string
        required: false
        description: New title
      - name: body
        in: body
        type: string
        required: false
        description: New content

  - id: delete_post
    path: /posts/{id}
    method: DELETE
    title: Delete Post
    description: Delete a post by ID
    parameters:
      - name: id
        in: path
        type: integer
        required: true
        description: Post ID
```

## Using the Schema

```typescript
import { createApiServer } from "mcp-curl";

// From file
const serverFromFile = await createApiServer({
    definitionPath: "./api.yaml",
});
await serverFromFile.start("stdio");

// From string
const serverFromString = await createApiServer({
    definitionContent: yamlString,
});
await serverFromString.start("stdio");

// Disable default tools (only expose generated ones)
const serverCustomOnly = await createApiServer({
    definitionPath: "./api.yaml",
    disableCurlExecute: true,
    disableJqQuery: true,
});
await serverCustomOnly.start("stdio");
```

## Validation Errors

Common validation errors:

| Error                              | Cause                                              |
|------------------------------------|----------------------------------------------------|
| `Missing required field: api.name` | Schema missing required field                      |
| `Invalid apiVersion`               | Not `"1.0"`                                        |
| `Duplicate endpoint ID: get_user`  | Two endpoints with same `id`                       |
| `Invalid parameter location`       | `in` not one of path/query/header/body             |
| `Path parameter not in path`       | Parameter with `in: path` but not in path template |

## Best Practices

1. **Use descriptive IDs**: `get_user_by_email` not `get1`
2. **Write clear descriptions**: Help the LLM understand when to use each tool
3. **Mark required fields**: Be explicit about what's needed
4. **Use filter presets**: Give LLMs easy options for common use cases
5. **Group related endpoints**: Organize by resource (users, posts, etc.)

## Config Directory Convention

The repository includes a `configs/` directory for application-specific API definitions.

### Directory Structure

```text
configs/
├── .gitkeep                    # Ensures directory exists in fresh clones
├── README.md                   # Usage instructions (tracked)
├── example.yaml.template       # Starting point for new definitions (tracked)
├── my-api.yaml                 # Your API definition (gitignored)
└── my-entry.ts                 # Your custom entry point (gitignored)
```

### Fork Workflow

If you fork this repo to build an API-specific server:

1. Copy the template: `cp configs/example.yaml.template configs/my-api.yaml`
2. Edit the YAML to define your API endpoints
3. Create an entry point that loads your definition
4. Pull upstream changes freely — your configs won't conflict

Files matching `*.yaml`, `*.yml`, `*.ts`, `*.js` in `configs/` are gitignored. The template, README, and
`.gitkeep` are tracked so they appear in fresh clones.

### npm Dependency Workflow

If you prefer a separate project:

```bash
mkdir my-api-server && cd my-api-server
npm init -y
npm install mcp-curl
```

Create your YAML definition and entry point in your own project. Upstream updates come via `npm update mcp-curl`.
See [Getting Started](./getting-started.md) for a step-by-step guide.
