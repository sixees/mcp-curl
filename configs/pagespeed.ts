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
import {
  McpCurlServer,
  loadApiSchema,
  generateInputSchema,
  getAuthConfig,
  type ApiSchema,
} from "mcp-curl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CATEGORIES = ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"];

// Preset extraction logic — TypeScript post-processing because the built-in
// jq engine can't do object construction ({ key: .value }) or arithmetic (* 100)

function extractScores(lighthouse: Record<string, any>) {
  const cats = lighthouse.categories ?? {};
  const toScore = (v: number | null | undefined) =>
    Math.round((v ?? 0) * 100);
  return {
    performance: toScore(cats.performance?.score),
    accessibility: toScore(cats.accessibility?.score),
    best_practices: toScore(cats["best-practices"]?.score),
    seo: toScore(cats.seo?.score),
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
      baseUrl: schema.api.baseUrl,
      defaultTimeout: schema.defaults?.timeout,
      defaultHeaders: schema.defaults?.headers,
      maxResultSize: 2_000_000,
    })
    .disableCurlExecute(); // replaced by custom tool; jq_query stays enabled

  const utils = server.utilities();

  // Build description with filter_preset documentation (buildToolDescription
  // does this for YAML-generated tools, but we bypass that with a custom handler)
  const description = [
    endpoint.description,
    "",
    "Available filter_preset values:",
    "  - scores: category scores as 0-100 integers (performance, accessibility, best_practices, seo)",
    "  - metrics: Core Web Vitals as value/display pairs (lcp, fcp, cls, tbt, tti)",
    "  - summary (default): both scores and metrics plus analyzed_url and strategy",
  ].join("\n");

  // Register custom tool with YAML-derived metadata + custom handler
  server.registerCustomTool(
    endpoint.id,
    {
      title: endpoint.title,
      description,
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

      // Validate URL locally before making a 15-45s API call
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Only http and https URLs are supported.",
              },
            ],
            isError: true,
          };
        }
      } catch {
        return {
          content: [
            { type: "text" as const, text: "Error: Invalid URL provided." },
          ],
          isError: true,
        };
      }

      // Build API URL with all 4 categories (YAML schema can't repeat params)
      const apiUrl = new URL(`${schema.api.baseUrl}${endpoint.path}`);
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("strategy", strategy ?? "MOBILE");
      for (const cat of CATEGORIES) {
        apiUrl.searchParams.append("category", cat);
      }

      // API key is sent as ?key=... per Google's documented method.
      // The key will be visible in proxy/access logs — use a restricted key.
      const { queryParams } = getAuthConfig(schema.auth);
      for (const [key, value] of Object.entries(queryParams)) {
        apiUrl.searchParams.set(key, value);
      }

      // Execute request via utilities (applies config defaults, SSRF checks)
      // maxResultSize=2MB configured on server; response returned inline for parsing
      const result = await utils.executeRequest({
        url: apiUrl.toString(),
        method: "GET",
        timeout: schema.defaults?.timeout ?? 60,
      });

      if (result.isError) {
        return result;
      }

      // Extract inline response text (maxResultSize=2MB keeps it inline)
      const resultText = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      // Parse JSON response
      let data: Record<string, any>;
      try {
        data = JSON.parse(resultText);
      } catch {
        return result; // not JSON (or auto-saved to file), return as-is
      }

      const lighthouse = data.lighthouseResult;
      if (!lighthouse) {
        console.error("pagespeed: no lighthouseResult in API response");
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: PageSpeed API did not return lighthouse results. The URL may be unreachable or the API may be experiencing issues.",
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
