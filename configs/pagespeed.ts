#!/usr/bin/env node
// PageSpeed Insights MCP Server
// Fork-specific configuration for Google PageSpeed Insights API v5
//
// Usage:
//   npx tsx configs/pagespeed.ts
//
// Environment:
//   PAGESPEED_API_KEY — Optional Google API key (higher rate limits)

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

// Preset extraction logic — TypeScript post-processing because the built-in
// jq engine can't do object construction ({ key: .value }) or arithmetic (* 100)

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

function buildOutput(
  data: Record<string, any>,
  lighthouse: Record<string, any>,
  preset: string,
) {
  if (preset === "scores") return extractScores(lighthouse);
  if (preset === "metrics") return extractMetrics(lighthouse);
  return {
    scores: extractScores(lighthouse),
    metrics: extractMetrics(lighthouse),
    analyzed_url: data.id,
    strategy: lighthouse.configSettings?.formFactor,
  };
}

try {
  // Load YAML schema for config values and input schema generation
  const schemaPath = join(__dirname, "pagespeed.yaml");
  const schema: ApiSchema = await loadApiSchema(schemaPath);
  const endpoint = schema.endpoints[0];

  // Generate Zod input schema from YAML endpoint definition
  // (includes url, strategy, and filter_preset enum from filterPresets)
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
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { url, strategy, filter_preset } = args as {
        url: string;
        strategy?: string;
        filter_preset?: string;
      };

      // Build API URL with all 4 categories (YAML schema can't repeat params)
      const apiUrl = new URL(`${schema.api.baseUrl}${endpoint.path}`);
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("strategy", strategy ?? "MOBILE");
      for (const cat of CATEGORIES) {
        apiUrl.searchParams.append("category", cat);
      }

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
        return result;
      }

      // Get raw JSON — either from saved file or inline
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
              type: "text" as const,
              text: `Error: No lighthouseResult in response. API may have returned an error:\n${raw.slice(0, 1000)}`,
            },
          ],
          isError: true,
        };
      }

      const preset = filter_preset ?? "summary";
      const output = buildOutput(data, lighthouse, preset);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    },
  );

  await server.start("stdio");
} catch (error) {
  console.error("Failed to start PageSpeed MCP server:", error);
  process.exitCode = 1;
}
