# Custom Tools Guide

This guide explains how to create custom MCP tools using `registerCustomTool()`.

## Overview

Custom tools extend your MCP server with specialized functionality beyond the built-in `curl_execute` and `jq_query`
tools. Use them to:

- Create domain-specific operations
- Wrap complex multi-step workflows
- Provide simplified interfaces to APIs
- Add business logic and validation

## registerCustomTool() API

```typescript
server.registerCustomTool(
    name
:
string,           // Tool name (lowercase with underscores)
    meta
:
CustomToolMeta,   // Tool metadata
    handler
:
ToolCallback   // Handler function
)
```

### CustomToolMeta Interface

```typescript
interface CustomToolMeta {
    title: string;                              // Human-readable title
    description: string;                        // Description for LLM context
    inputSchema: z.ZodObject<z.ZodRawShape>;    // Zod schema for input validation
    annotations?: {
        readOnlyHint?: boolean;         // Tool only reads data
        destructiveHint?: boolean;      // Tool may delete/modify data
        idempotentHint?: boolean;       // Safe to retry
        openWorldHint?: boolean;        // Interacts with external systems
    };
}
```

### Handler Function

```typescript
type ToolCallback = (params: T) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}>;
```

## Basic Example

```typescript
import {McpCurlServer} from "mcp-curl";
import {z} from "zod";

const server = new McpCurlServer();

server.registerCustomTool(
    "greet_user",
    {
        title: "Greet User",
        description: "Generate a personalized greeting",
        inputSchema: z.object({
            name: z.string().describe("User's name"),
            formal: z.boolean().optional().describe("Use formal greeting"),
        }),
    },
    async ({name, formal}) => {
        const greeting = formal
            ? `Good day, ${name}. How may I assist you?`
            : `Hey ${name}! What's up?`;

        return {
            content: [{type: "text", text: greeting}],
        };
    }
);

await server.start("stdio");
```

## Using Instance Utilities

Access config-aware utilities for making HTTP requests within custom tools:

```typescript
const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"});

server.registerCustomTool(
    "get_user_profile",
    {
        title: "Get User Profile",
        description: "Fetch user profile with formatted output",
        inputSchema: z.object({
            userId: z.string().describe("User ID"),
        }),
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    async ({userId}) => {
        const utils = server.utilities();

        // Make request using instance utilities (applies config)
        const result = await utils.executeRequest({
            url: `/users/${encodeURIComponent(userId)}`,  // Encode to prevent path traversal
            headers: {"Accept": "application/json"},
        });

        if (result.isError) {
            return {
                content: [{type: "text", text: result.content[0]?.text ?? "Request failed"}],
                isError: true,
            };
        }

        // Format the response
        try {
            const user = JSON.parse(result.content[0].text);
            const formatted = `
User Profile:
  Name: ${user.name}
  Email: ${user.email}
  Role: ${user.role}
`.trim();

            return {
                content: [{type: "text", text: formatted}],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true,
            };
        }
    }
);
```

## Input Schema Patterns

### Required and Optional Fields

```typescript
z.object({
    required: z.string(),                    // Required
    optional: z.string().optional(),         // Optional
    withDefault: z.string().default("foo"),  // Has default
})
```

### Type Validation

```typescript
z.object({
    text: z.string(),
    count: z.number().int().positive(),
    flag: z.boolean(),
    choice: z.enum(["a", "b", "c"]),
    items: z.array(z.string()),
    data: z.record(z.string()),  // { [key]: string }
})
```

### Complex Validation

```typescript
z.object({
    email: z.string().email(),
    url: z.string().url(),
    age: z.number().min(0).max(150),
    code: z.string().regex(/^[A-Z]{3}-\d{4}$/),
})
```

### Descriptions

Always add descriptions for LLM context:

```typescript
z.object({
    query: z.string()
        .describe("Search query to find users"),
    limit: z.number()
        .optional()
        .describe("Max results to return (default: 10)"),
})
```

## MCP Annotations

Annotations help clients understand tool behavior:

```typescript
annotations: {
    readOnlyHint: true,       // Only reads, doesn't modify
        destructiveHint
:
    false,   // Doesn't delete data
        idempotentHint
:
    true,     // Safe to call multiple times
        openWorldHint
:
    true,      // Makes external requests
}
```

### When to Use Each

| Annotation              | Use When                                   |
|-------------------------|--------------------------------------------|
| `readOnlyHint: true`    | Tool only fetches/reads data               |
| `destructiveHint: true` | Tool deletes or irreversibly modifies data |
| `idempotentHint: true`  | Calling twice has same effect as once      |
| `openWorldHint: true`   | Tool interacts with external systems       |

## Complete Example: Weather API Tool

```typescript
import {McpCurlServer} from "mcp-curl";
import {z} from "zod";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.weatherapi.com/v1",
    });

server.registerCustomTool(
    "get_weather",
    {
        title: "Get Weather",
        description: "Get current weather for a location",
        inputSchema: z.object({
            location: z.string()
                .describe("City name, zip code, or coordinates (lat,lon)"),
            units: z.enum(["metric", "imperial"])
                .optional()
                .describe("Temperature units (default: metric)"),
        }),
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    },
    async ({location, units = "metric"}) => {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) {
            return {
                content: [{type: "text", text: "WEATHER_API_KEY not set"}],
                isError: true,
            };
        }

        const utils = server.utilities();

        const result = await utils.executeRequest({
            url: `/current.json?key=${apiKey}&q=${encodeURIComponent(location)}`,
        });

        if (result.isError) {
            return {
                content: [{type: "text", text: `Weather API error: ${result.content[0]?.text ?? "Unknown"}`}],
                isError: true,
            };
        }

        try {
            const data = JSON.parse(result.content[0].text);
            const temp = units === "imperial"
                ? `${data.current.temp_f}°F`
                : `${data.current.temp_c}°C`;

            const weather = `
Weather for ${data.location.name}, ${data.location.country}:
  Condition: ${data.current.condition.text}
  Temperature: ${temp}
  Humidity: ${data.current.humidity}%
  Wind: ${data.current.wind_kph} km/h ${data.current.wind_dir}
`.trim();

            return {
                content: [{type: "text", text: weather}],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to parse weather response: ${error instanceof Error ? error.message : String(error)}`
                }],
                isError: true,
            };
        }
    }
);

await server.start("stdio");
```

## Error Handling

Return errors with `isError: true`:

```typescript
async (params) => {
    try {
        // ... operation
        return {content: [{type: "text", text: result}]};
    } catch (error) {
        return {
            content: [{type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}`}],
            isError: true,
        };
    }
}
```

## Best Practices

1. **Validate early**: Use Zod schemas to catch bad input
2. **Write clear descriptions**: Help the LLM understand tool purpose
3. **Use annotations**: Signal tool behavior to clients
4. **Handle errors gracefully**: Return helpful error messages
5. **Keep tools focused**: One tool = one job
6. **Use utilities**: Leverage `server.utilities()` for requests
