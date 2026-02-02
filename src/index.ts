#!/usr/bin/env node
// src/index.ts
// Main entry point - thin wrapper that delegates to modular components

import { registerShutdownHandlers } from "./lib/server/lifecycle.js";
import { runStdio } from "./lib/transports/stdio.js";
import { runHTTP } from "./lib/transports/http.js";

// Register shutdown handlers for graceful cleanup
registerShutdownHandlers();

// Select transport based on environment (case-insensitive)
const transport = (process.env.TRANSPORT || "stdio").toLowerCase();
if (transport === "http") {
    runHTTP().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
} else {
    runStdio().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
