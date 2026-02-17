# Basic mcp-curl Example

A minimal MCP server using mcp-curl with basic configuration.

## Setup

```bash
npm install
npm run build
```

> **Note:** When copying this example to your own project, change the dependency in `package.json` from `"file:../.."`
> to `"mcp-curl": "^1.1.5"` (or latest version).

## Running

Start the server (stdio transport):

```bash
npm start
```

The server exposes two tools to the connected LLM:

- `curl_execute` - Make HTTP requests
- `jq_query` - Query saved JSON files

## What This Example Demonstrates

- Creating a `McpCurlServer` instance
- Configuring `baseUrl`, `defaultHeaders`, and `defaultTimeout`
- Starting the server with stdio transport

## Testing

With Claude Desktop, add to your config:

```json
{
  "mcpServers": {
    "basic-example": {
      "command": "node",
      "args": [
        "/path/to/examples/basic/dist/index.js"
      ]
    }
  }
}
```

Then ask Claude to make requests to the JSONPlaceholder API:

- "Get the list of users"
- "Fetch post #1"
- "Create a new post with title 'Test'"

## Code

```typescript
import {McpCurlServer} from "mcp-curl";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://jsonplaceholder.typicode.com",
        defaultHeaders: {"Accept": "application/json"},
        defaultTimeout: 30,
    });

await server.start("stdio");
```
