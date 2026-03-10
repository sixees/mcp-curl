---
title: "feat: PageSpeed Insights API fork configuration"
type: feat
status: completed
date: 2026-03-10
brainstorm: docs/brainstorms/2026-03-10-pagespeed-api-fork-brainstorm.md
---

# feat: PageSpeed Insights API Fork Configuration

## Overview

Configure mcp-curl as a fork-specific MCP server for Google PageSpeed Insights API v5. This tests the fork workflow by creating a real API integration using the `configs/` directory convention. A single `analyze_pagespeed` tool returns category scores and Core Web Vitals for any URL.

## Problem Statement / Motivation

The mcp-curl fork workflow (`configs/` directory + YAML schema + TypeScript entry point) exists but has never been tested with a real API integration. PageSpeed Insights is ideal: single endpoint, API key auth, large JSON responses requiring filtering, and repeated query parameters that stress-test the schema system's limitations.

## Proposed Solution

**Branch:** `pagespeed` (off `main`)

**Two files in `configs/`:**

1. **`configs/pagespeed.yaml`** — API definition with metadata, auth, defaults, and one endpoint. Loaded at runtime for configuration values and input schema generation via `generateInputSchema()`.

2. **`configs/pagespeed.ts`** — TypeScript entry point that loads the YAML, creates `McpCurlServer`, and registers `analyze_pagespeed` as a custom tool with a handler that:
   - Builds the API URL with all 4 category params (YAML schema can't repeat query params)
   - Calls `server.utilities().executeRequest()` with `save_to_file: true`
   - Reads the saved JSON file and extracts scores/metrics in TypeScript
   - Returns labeled, formatted results based on `filter_preset`

### Architecture: Why Custom Handler Instead of YAML-Generated Tool

The brainstorm originally proposed using `beforeRequest` hooks to inject repeated `&category=X` params. **This won't work** — hooks only run on built-in `curl_execute`/`jq_query` tools, not on custom tools. YAML-generated tools ARE custom tools (registered via `registerCustomTool()`), so they bypass the hook pipeline entirely.

Additionally, the built-in jq engine cannot do object construction or arithmetic (no `{key: .value}`, no `. * 100`). Category scores are 0-1 floats that need multiplication by 100 and labeling. TypeScript post-processing in the handler is the only way to produce clean output.

**The YAML file still serves a purpose:**
- `loadApiSchema()` validates the API definition
- `generateInputSchema(endpoint)` produces the Zod input schema (url, strategy, filter_preset params)
- `api`, `auth`, `defaults` sections configure the server
- Documents the API structure for future maintainers

## Technical Considerations

### Multi-Category Query Parameters

The PageSpeed API requires `&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO`. The YAML schema's `buildUrl()` uses `Record<string, string>` — one value per key. The custom handler uses `URLSearchParams.append()` to produce repeated params.

### Response Size

PageSpeed responses are 500KB-2MB. The handler uses `save_to_file: true` to write the full response to a temp file, then reads and parses the file to extract only the fields needed. This avoids inline size limits.

### jq_query Kept Enabled

`jq_query` remains enabled so the LLM can re-query saved response files with different filters without re-hitting the API. Only `curl_execute` is disabled (replaced by the custom tool).

### Timeout

Set to 60s. PageSpeed analysis takes 15-45s for complex pages. Default 30s would cause failures.

### Authentication

API key via `PAGESPEED_API_KEY` env var, `required: false`. The API works without a key at lower rate limits (~25 queries/100s vs. 25,000/day with key).

### Git Tracking on Branch

Add `.gitignore` negation patterns on the `pagespeed` branch so config files are committed:
```gitignore
!configs/pagespeed.yaml
!configs/pagespeed.ts
```

## Acceptance Criteria

- [x] `pagespeed` branch exists off `main`
- [x] `configs/pagespeed.yaml` — valid API schema with metadata, auth, defaults, one endpoint
- [x] `configs/pagespeed.ts` — entry point that starts an MCP server with `analyze_pagespeed` tool
- [x] Tool accepts `url` (required), `strategy` (MOBILE/DESKTOP, default MOBILE), `filter_preset` (scores/metrics/summary, default summary)
- [x] Tool sends all 4 category params to the PageSpeed API
- [x] `scores` preset returns labeled percentages: `{ performance: 95, accessibility: 88, ... }`
- [x] `metrics` preset returns Core Web Vitals: `{ lcp: { value: 2500, display: "2.5 s" }, ... }`
- [x] `summary` preset returns both scores and metrics combined
- [x] API key is optional — tool works without `PAGESPEED_API_KEY` set
- [x] `curl_execute` disabled, `jq_query` enabled
- [x] `.gitignore` has negation patterns for the pagespeed config files
- [x] Server starts with `npx tsx configs/pagespeed.ts`
- [x] Google API errors (400/403/429/500) return actionable error messages

## MVP

### configs/pagespeed.yaml

```yaml
apiVersion: "1.0"

api:
  name: pagespeed-insights
  title: Google PageSpeed Insights
  description: >
    Analyze web page performance using Google PageSpeed Insights API v5.
    Returns category scores (Performance, Accessibility, Best Practices, SEO)
    and Core Web Vitals (LCP, FCP, CLS, TBT, TTI).
    Analysis typically takes 15-45 seconds.
  version: "5.0.0"
  baseUrl: https://pagespeedonline.googleapis.com

auth:
  apiKey:
    type: query
    name: key
    envVar: PAGESPEED_API_KEY
    required: false

defaults:
  timeout: 60
  headers:
    Accept: application/json

endpoints:
  - id: analyze_pagespeed
    path: /pagespeedonline/v5/runPagespeed
    method: GET
    title: Analyze PageSpeed
    description: >
      Run PageSpeed Insights analysis on a URL. Returns category scores
      and Core Web Vitals. Analysis takes 15-45 seconds.
      Without PAGESPEED_API_KEY, rate-limited to ~25 queries/100s.
    parameters:
      - name: url
        in: query
        type: string
        required: true
        description: The URL to analyze (must be publicly accessible)
      - name: strategy
        in: query
        type: string
        required: false
        description: Analysis strategy
        default: MOBILE
        enum:
          - MOBILE
          - DESKTOP
    response:
      # jqFilter values below are NOT used at runtime (custom handler does
      # TypeScript post-processing). They exist so generateInputSchema()
      # produces a filter_preset enum parameter from the preset names.
      jqFilter: ".lighthouseResult"
      filterPresets:
        - name: scores
          jqFilter: ".lighthouseResult.categories"
        - name: metrics
          jqFilter: ".lighthouseResult.audits"
        - name: summary
          jqFilter: ".lighthouseResult"
```

### configs/pagespeed.ts

```typescript
#!/usr/bin/env node
// PageSpeed Insights MCP Server
// Fork-specific configuration for Google PageSpeed Insights API v5

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "fs/promises";
import {
  McpCurlServer,
  loadApiSchema,
  generateInputSchema,
  type ApiSchema,
} from "mcp-curl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CATEGORIES = ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"];

// Preset extraction logic — TypeScript post-processing (jq engine can't
// do object construction or arithmetic)
function extractScores(lighthouse: Record<string, any>) {
  const cats = lighthouse.categories ?? {};
  return {
    performance: Math.round((cats.performance?.score ?? 0) * 100),
    accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
    best_practices: Math.round((cats["best-practices"]?.score ?? 0) * 100),
    seo: Math.round((cats.seo?.score ?? 0) * 100),
  };
}

function extractMetrics(lighthouse: Record<string, any>) {
  const audits = lighthouse.audits ?? {};
  const get = (id: string) => ({
    value: audits[id]?.numericValue ?? null,
    display: audits[id]?.displayValue ?? "N/A",
  });
  return {
    lcp: get("largest-contentful-paint"),
    fcp: get("first-contentful-paint"),
    cls: get("cumulative-layout-shift"),
    tbt: get("total-blocking-time"),
    tti: get("interactive"),
  };
}

try {
  // Load YAML schema for config values and input schema generation
  const schemaPath = join(__dirname, "pagespeed.yaml");
  const schema: ApiSchema = await loadApiSchema(schemaPath);
  const endpoint = schema.endpoints[0];

  // Generate Zod input schema from YAML endpoint definition
  const inputSchema = generateInputSchema(endpoint);

  // Create and configure server from schema
  const server = new McpCurlServer()
    .configure({
      serverName: schema.api.name,
      serverVersion: schema.api.version,
      baseUrl: schema.api.baseUrl,
      defaultTimeout: schema.defaults?.timeout,
      defaultHeaders: schema.defaults?.headers,
    })
    .disableCurlExecute(); // replaced by custom tool; jq_query stays enabled

  // Register custom tool with YAML-derived metadata + custom handler
  server.registerCustomTool(
    endpoint.id,
    {
      title: endpoint.title,
      description: endpoint.description,
      inputSchema,
    },
    async (args) => {
      const { url, strategy, filter_preset } = args as {
        url: string;
        strategy?: string;
        filter_preset?: string;
      };

      // Build API URL with all 4 categories (YAML schema can't repeat params)
      const apiUrl = new URL(
        `${schema.api.baseUrl}${endpoint.path}`
      );
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("strategy", strategy ?? "MOBILE");
      CATEGORIES.forEach((cat) =>
        apiUrl.searchParams.append("category", cat)
      );

      // Add API key if available
      const apiKey = process.env.PAGESPEED_API_KEY;
      if (apiKey) {
        apiUrl.searchParams.set("key", apiKey);
      }

      // Execute request via utilities (applies config defaults, SSRF checks)
      const utils = server.utilities();
      const result = await utils.executeRequest({
        url: apiUrl.toString(),
        method: "GET",
        timeout: schema.defaults?.timeout ?? 60,
        save_to_file: true,
      });

      if (result.isError) {
        return result; // pass through error
      }

      // Get raw JSON — either inline or from saved file
      const resultText = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      let raw: string;
      const fileMatch = resultText.match(/saved to:\s*(.+)/i);
      if (fileMatch?.[1]) {
        raw = await readFile(fileMatch[1].trim(), "utf-8");
      } else {
        raw = resultText;
      }

      // Parse and extract
      let data: Record<string, any>;
      try {
        data = JSON.parse(raw);
      } catch {
        return result; // not JSON, return as-is
      }

      const lighthouse = data.lighthouseResult;
      if (!lighthouse) {
        return {
          content: [
            {
              type: "text",
              text: `Error: No lighthouseResult in response. API may have returned an error:\n${raw.slice(0, 1000)}`,
            },
          ],
          isError: true,
        };
      }

      const preset = filter_preset ?? "summary";
      const output =
        preset === "scores"
          ? extractScores(lighthouse)
          : preset === "metrics"
            ? extractMetrics(lighthouse)
            : {
                scores: extractScores(lighthouse),
                metrics: extractMetrics(lighthouse),
                analyzed_url: data.id,
                strategy: lighthouse.configSettings?.formFactor,
              };

      return {
        content: [
          { type: "text", text: JSON.stringify(output, null, 2) },
        ],
      };
    }
  );

  await server.start("stdio");
} catch (error) {
  console.error("Failed to start PageSpeed MCP server:", error);
  process.exitCode = 1;
}
```

## Implementation Steps

### 1. Create `pagespeed` branch

```bash
git checkout -b pagespeed
```

### 2. Create `configs/pagespeed.yaml`

API definition as shown in MVP above.

### 3. Create `configs/pagespeed.ts`

Entry point as shown in MVP above.

### 4. Update `.gitignore`

Add negation patterns so these files are tracked on this branch:

```gitignore
!configs/pagespeed.yaml
!configs/pagespeed.ts
```

### 5. Verify

```bash
# Build the project first (entry point imports from mcp-curl)
npm run build

# Test the server starts
npx tsx configs/pagespeed.ts
```

### 6. MCP Client Configuration

Example for Claude Desktop or similar MCP clients:

```json
{
  "mcpServers": {
    "pagespeed": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-curl/configs/pagespeed.ts"],
      "env": {
        "PAGESPEED_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Dependencies & Risks

- **Google API availability** — PageSpeed API has intermittent backend issues. 500/503 responses are normal.
- **Rate limits** — Without API key: ~25 queries/100s. With key: 25,000/day. Tool description mentions this.
- **Response format changes** — Google may change audit IDs or category structure in future Lighthouse versions.
- **`tsx` dependency** — Not in project dependencies. Available via `npx`. Could add as devDependency if needed.
- **Timeout edge cases** — Some very complex pages may exceed 60s. The tool description warns about this.

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-03-10-pagespeed-api-fork-brainstorm.md`
- Fork workflow: `docs/plans/2026-02-23-feat-configs-directory-fork-workflow-plan.md`
- YAML schema docs: `docs/api-schema.md`
- McpCurlServer: `src/lib/extensible/mcp-curl-server.ts`
- Instance utilities: `src/lib/extensible/instance-utilities.ts`
- Schema generator: `src/lib/schema/generator.ts`
- Hook executor: `src/lib/extensible/hook-executor.ts` (confirms hooks skip custom tools)
- Example YAML server: `examples/from-yaml/`

### External References

- PageSpeed API docs: https://developers.google.com/speed/docs/insights/v5/get-started
- API reference: https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed
