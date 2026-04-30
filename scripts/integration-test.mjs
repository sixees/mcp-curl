/**
 * Integration test: connects to mcp-curl as an AI agent would (via stdio MCP protocol),
 * lists available tools, then calls curl_execute to hit the Google PageSpeed API.
 *
 * Run with: node scripts/integration-test.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, "../dist/index.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function printJson(label, data) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  section("mcp-curl Integration Test — Google PageSpeed");

  console.log(`\nSpawning MCP server: ${serverEntry}`);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
  });

  const client = new Client(
    { name: "integration-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✓ Connected to MCP server via stdio");

  // ── Step 1: List tools ───────────────────────────────────────────────────
  section("Step 1 — List available tools");
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((t) => t.name);
  console.log("Tools:", toolNames);

  const curlTool = toolsResult.tools.find((t) => t.name === "curl_execute");
  if (!curlTool) throw new Error("curl_execute tool not found!");
  console.log("\n✓ curl_execute tool is registered");
  console.log("  Description:", curlTool.description);

  // ── Step 2: Call curl_execute → Google PageSpeed API ────────────────────
  section("Step 2 — Call curl_execute (Google PageSpeed API)");

  const targetUrl = "https://example.com";
  const pagespeedUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile&category=performance`;

  console.log(`\nCalling PageSpeed API for: ${targetUrl}`);
  console.log(`Endpoint: ${pagespeedUrl}`);

  const callResult = await client.callTool({
    name: "curl_execute",
    arguments: {
      url: pagespeedUrl,
      method: "GET",
      headers: { Accept: "application/json" },
      timeout: 30,
    },
  });

  // ── Step 3: Parse and display results ────────────────────────────────────
  section("Step 3 — Results");

  // callTool returns { content: [{type, text}], isError? }
  if (callResult.isError) {
    console.error("Tool returned an error:");
    for (const item of callResult.content) {
      console.error(item.text);
    }
    process.exit(1);
  }

  const rawText = callResult.content.map((c) => c.text).join("\n");

  // Try to extract key PageSpeed metrics from the JSON response
  try {
    // The response body is embedded in the tool's formatted output.
    // Find the JSON portion (starts after "Response Body:" section).
    const jsonMatch = rawText.match(/\{[\s\S]+\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const lhr = data.lighthouseResult;
      if (lhr) {
        console.log(`\n✓ PageSpeed analysis for: ${data.id || targetUrl}`);
        console.log(`  Strategy: ${lhr.configSettings?.emulatedFormFactor ?? "mobile"}`);

        const cats = lhr.categories;
        if (cats?.performance) {
          const score = Math.round(cats.performance.score * 100);
          const bar = "█".repeat(Math.floor(score / 5)) + "░".repeat(20 - Math.floor(score / 5));
          console.log(`\n  Performance score: ${score}/100  [${bar}]`);
        }

        // Key metrics
        const audits = lhr.audits;
        const metrics = [
          ["First Contentful Paint", "first-contentful-paint"],
          ["Largest Contentful Paint", "largest-contentful-paint"],
          ["Total Blocking Time", "total-blocking-time"],
          ["Speed Index", "speed-index"],
          ["Cumulative Layout Shift", "cumulative-layout-shift"],
        ];
        console.log("\n  Core Web Vitals:");
        for (const [label, key] of metrics) {
          const audit = audits?.[key];
          if (audit) {
            const rating = audit.score >= 0.9 ? "✓" : audit.score >= 0.5 ? "~" : "✗";
            console.log(`  ${rating}  ${label.padEnd(30)} ${audit.displayValue ?? "—"}`);
          }
        }
      } else {
        // Not a Lighthouse response — show status + truncated body
        console.log(`\nHTTP status: ${data.statusCode ?? "unknown"}`);
        console.log(JSON.stringify(data, null, 2).slice(0, 800));
      }
    } else {
      // Show raw tool output (non-JSON or small response)
      console.log("\nRaw tool output:");
      console.log(rawText.slice(0, 1200));
    }
  } catch {
    console.log("\nRaw tool output:");
    console.log(rawText.slice(0, 1200));
  }

  section("Done");
  console.log("✓ Integration test passed — MCP server accepted the request and returned a response.\n");

  await client.close();
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
