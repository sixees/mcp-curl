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
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, "../dist/index.js");

// Fail fast with an actionable message instead of letting spawn report a less-clear ENOENT.
if (!fs.existsSync(serverEntry)) {
  console.error(`dist entry not found: ${serverEntry}`);
  console.error("Run the build first: npm run build");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

/**
 * Extract the largest top-level JSON object from the tool's formatted output.
 * Uses indexOf/lastIndexOf rather than a greedy regex so unrelated braces in
 * surrounding metadata (headers, separators) don't pull in extra characters.
 */
function extractJsonBlock(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let client;
  try {
    section("mcp-curl Integration Test — Google PageSpeed");

    console.log(`\nSpawning MCP server: ${serverEntry}`);

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverEntry],
    });

    client = new Client(
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
      throw new Error("curl_execute returned isError=true");
    }

    const rawText = callResult.content.map((c) => c.text).join("\n");
    const jsonBlock = extractJsonBlock(rawText);
    if (!jsonBlock) {
      console.error("\nNo JSON block found in tool output:");
      console.error(rawText.slice(0, 1200));
      throw new Error("curl_execute output did not contain a JSON body");
    }

    let data;
    try {
      data = JSON.parse(jsonBlock);
    } catch (err) {
      console.error("\nFailed to parse JSON from tool output:", err.message);
      console.error(rawText.slice(0, 1200));
      throw new Error("curl_execute output JSON could not be parsed");
    }

    const lhr = data.lighthouseResult;
    // PageSpeed returned something parseable but not a Lighthouse report (quota,
    // auth, or other API-level failure). Treat as a hard failure so CI catches it.
    if (!lhr) {
      console.error(`\nNon-Lighthouse PageSpeed response (status: ${data.statusCode ?? "unknown"}):`);
      console.error(JSON.stringify(data, null, 2).slice(0, 800));
      throw new Error("PageSpeed response did not include lighthouseResult");
    }

    console.log(`\n✓ PageSpeed analysis for: ${data.id || targetUrl}`);
    console.log(`  Strategy: ${lhr.configSettings?.emulatedFormFactor ?? "mobile"}`);

    const cats = lhr.categories;
    if (cats?.performance) {
      const score = Math.round(cats.performance.score * 100);
      const bar = "█".repeat(Math.floor(score / 5)) + "░".repeat(20 - Math.floor(score / 5));
      console.log(`\n  Performance score: ${score}/100  [${bar}]`);
    }

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

    section("Done");
    console.log("✓ Integration test passed — MCP server accepted the request and returned a response.\n");
  } finally {
    // Always close the client so the spawned server process is reaped, even on error paths.
    await client?.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exitCode = 1;
});
