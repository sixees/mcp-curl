# mcp-curl from YAML Example

An MCP server generated from a YAML API definition file.

## Setup

```bash
npm install
npm run build
```

> **Note:** When copying this example to your own project, change the dependency in `package.json` from `"file:../.."`
> to
`"mcp-curl": "^1.1.5"` (or latest version).

## Running

```bash
npm start
```

## What This Example Demonstrates

### YAML API Definition

The `api-definition.yaml` file declaratively defines the JSONPlaceholder API:

- API metadata (name, version, baseUrl)
- Default settings (timeout, headers)
- Endpoints that become MCP tools

### Generated Tools

From the YAML, these tools are automatically generated:

| Tool                | Description             |
|---------------------|-------------------------|
| `list_posts`        | Get all posts           |
| `get_post`          | Get a post by ID        |
| `create_post`       | Create a new post       |
| `update_post`       | Update a post           |
| `delete_post`       | Delete a post           |
| `list_users`        | Get all users           |
| `get_user`          | Get a user by ID        |
| `list_comments`     | Get all comments        |
| `get_post_comments` | Get comments for a post |
| `list_todos`        | Get all todos           |

Plus the built-in `curl_execute` and `jq_query` tools.

### createApiServer() Function

```typescript
import {createApiServer} from "mcp-curl";

const server = await createApiServer({
    // Load from file
    definitionPath: "./api-definition.yaml",

    // Or from string
    // definitionContent: yamlString,

    // Or from pre-loaded schema
    // schema: loadedSchema,

    // Disable built-in tools
    // disableCurlExecute: true,
    // disableJqQuery: true,

    // Additional config
    config: {
        maxResultSize: 1_000_000,
    },
});

await server.start("stdio");
```

## YAML Structure

```yaml
apiVersion: "1.0"

api:
  name: jsonplaceholder
  title: JSONPlaceholder API
  description: Free fake API for testing
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
    description: Get all posts
    parameters:
      - name: userId
        in: query
        type: integer
        required: false
        description: Filter by user ID
```

## Testing

With Claude Desktop, add to your config:

```json
{
  "mcpServers": {
    "jsonplaceholder": {
      "command": "node",
      "args": [
        "/path/to/examples/from-yaml/dist/index.js"
      ]
    }
  }
}
```

Then ask Claude:

- "List all posts by user 1"
- "Get the details of post 5"
- "Create a new post with title 'Test'"
- "Show all todos that are completed"

## Customization

### Disable Built-in Tools

To only expose the generated tools:

```typescript
const server = await createApiServer({
    definitionPath: "./api-definition.yaml",
    disableCurlExecute: true,
    disableJqQuery: true,
});
```

### Add Hooks

`createApiServer()` returns a fully configured server — hooks cannot be added after creation.
To use hooks with YAML schemas, build the server manually with `McpCurlServer`, `loadApiSchema`, and
`generateToolDefinitions`:

```typescript
import {McpCurlServer} from "mcp-curl";
import {loadApiSchema, generateToolDefinitions, getMethodAnnotations} from "mcp-curl/schema";

const schema = await loadApiSchema("./api-definition.yaml");
const server = new McpCurlServer()
    .configure({baseUrl: schema.api.baseUrl})
    .beforeRequest((ctx) => {
        console.log(`Hook triggered for tool: ${ctx.tool}`);
    });

// Generate tool definitions from the schema (with defaults from YAML)
const toolDefs = generateToolDefinitions(schema, {
    defaultHeaders: schema.defaults?.headers,
    timeout: schema.defaults?.timeout,
});
for (const toolDef of toolDefs) {
    server.registerCustomTool(
        toolDef.id,
        {
            title: toolDef.title,
            description: toolDef.description,
            inputSchema: toolDef.inputSchema,
            annotations: getMethodAnnotations(toolDef.method),
        },
        toolDef.handler
    );
}

await server.start("stdio");
```
