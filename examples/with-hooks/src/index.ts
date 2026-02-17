#!/usr/bin/env node
// mcp-curl server with hooks example
//
// Demonstrates:
// - beforeRequest: Add authentication headers
// - afterResponse: Log request/response metrics
// - onError: Error tracking and reporting

import { McpCurlServer } from "mcp-curl";

// Simple metrics tracking
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalLatencyMs: 0,
};

// Track request start times
// Note: In production, add periodic cleanup (e.g., TTL-based eviction) to prevent
// unbounded growth if requests fail before afterResponse/onError cleans up entries.
const requestStartTimes = new Map<string, number>();

// Generate a simple request ID
function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Create the server with hooks
const server = new McpCurlServer()
  .configure({
    baseUrl: "https://jsonplaceholder.typicode.com",
    defaultHeaders: {
      "Accept": "application/json",
    },
    defaultTimeout: 30,
  })

  // beforeRequest: Add authentication and track request start
  .beforeRequest((ctx) => {
    // Only process curl_execute requests (not jq_query)
    if (ctx.tool !== "curl_execute") return;

    const requestId = generateRequestId();
    requestStartTimes.set(requestId, Date.now());
    metrics.totalRequests++;

    // Get token from environment (if available)
    const token = process.env.API_TOKEN;

    // Log the request (redact query params to avoid exposing tokens)
    const params = ctx.params as { url: string; headers?: Record<string, string> };
    const safeUrl = params.url.split(/[?#]/)[0];
    console.error(`[${requestId}] ${ctx.tool}: ${safeUrl}`);

    // Build new headers with request ID and optional auth
    const newHeaders: Record<string, string> = {
      ...(params.headers ?? {}),
      "X-Request-ID": requestId,
    };

    if (token) {
      newHeaders["Authorization"] = `Bearer ${token}`;
    }

    return {
      params: {
        ...params,
        headers: newHeaders,
      },
    };
  })

  // afterResponse: Log success and collect metrics
  .afterResponse((ctx) => {
    // Get request ID from curl_execute headers
    if (ctx.tool === "curl_execute") {
      const params = ctx.params as { headers?: Record<string, string> };
      const requestId = params.headers?.["X-Request-ID"];

      if (requestId) {
        const startTime = requestStartTimes.get(requestId);
        if (startTime) {
          const latency = Date.now() - startTime;
          metrics.totalLatencyMs += latency;
          requestStartTimes.delete(requestId);

          if (ctx.isError) {
            metrics.failedRequests++;
            console.error(`[${requestId}] Failed (${latency}ms)`);
          } else {
            metrics.successfulRequests++;
            console.error(`[${requestId}] Success (${latency}ms) - ${ctx.response.length} bytes`);
          }
        }
      }
    }

    // Log overall metrics periodically
    if (metrics.totalRequests > 0 && metrics.totalRequests % 10 === 0) {
      const avgLatency = Math.round(metrics.totalLatencyMs / metrics.totalRequests);
      console.error(`[Metrics] Requests: ${metrics.totalRequests}, Success: ${metrics.successfulRequests}, Failed: ${metrics.failedRequests}, Avg Latency: ${avgLatency}ms`);
    }
  })

  // onError: Log and track errors
  .onError((ctx) => {
    let requestId = "unknown";

    if (ctx.tool === "curl_execute") {
      const params = ctx.params as { headers?: Record<string, string> };
      requestId = params.headers?.["X-Request-ID"] ?? "unknown";
      // Clean up the start time entry to prevent memory leak
      requestStartTimes.delete(requestId);
    }

    // Note: Don't increment metrics.failedRequests here - it's already counted
    // in afterResponse when ctx.isError is true. This hook handles errors
    // that occur during hook execution or tool processing.
    console.error(`[${requestId}] Error in ${ctx.tool}: ${ctx.error.message}`);

    // In a real application, you might send this to an error tracking service
    // await errorTracker.report({
    //   tool: ctx.tool,
    //   error: ctx.error,
    //   params: ctx.params,
    //   sessionId: ctx.sessionId,
    // });
  });

// Handle graceful shutdown (SIGINT and SIGTERM for container environments)
const shutdownHandler = async () => {
  console.error("\n[Shutdown] Final metrics:");
  console.error(`  Total requests: ${metrics.totalRequests}`);
  console.error(`  Successful: ${metrics.successfulRequests}`);
  console.error(`  Failed: ${metrics.failedRequests}`);
  if (metrics.totalRequests > 0) {
    console.error(`  Avg latency: ${Math.round(metrics.totalLatencyMs / metrics.totalRequests)}ms`);
  }
  await server.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdownHandler);
process.on("SIGTERM", shutdownHandler);

// Start the server
await server.start("stdio");
