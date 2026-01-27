#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join, resolve, relative, isAbsolute, basename } from "path";
import { readFile, writeFile, mkdtemp, rm, chmod, readdir, stat, access, realpath, constants as fsConstants } from "fs/promises";
import { lookup } from "dns/promises";
// Constants
const MAX_RESPONSE_SIZE = 10_000_000; // 10MB max response for processing (jq_filter can reduce before output)
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const SERVER_NAME = "curl-mcp-server";
const SERVER_VERSION = "1.1.5";
const DEFAULT_MAX_RESULT_SIZE = 500_000; // 500KB default for AI agent responses
const TEMP_DIR_PREFIX = "mcp-curl-";
const ORPHAN_DIR_MIN_AGE_MS = 3600000; // 1 hour - only cleanup temp dirs older than this to avoid racing with other instances
// Generate unique separator per request to prevent response injection attacks
// An attacker could craft a response containing our separator to inject fake metadata
function generateMetadataSeparator() {
    return `\n---MCP-CURL-${randomUUID()}---\n`;
}
const ERROR_PREVIEW_LENGTH = 200; // Characters to show in error previews
const FILENAME_MAX_LENGTH = 50; // Max length for generated filenames
const sessions = new Map();
const MAX_SESSIONS = 100; // Limit concurrent sessions to prevent memory exhaustion
const SESSION_IDLE_TIMEOUT_MS = 3600000; // 1 hour idle timeout
const SESSION_CLEANUP_INTERVAL_MS = 300000; // Check every 5 minutes
// Periodically clean up idle sessions to prevent resource exhaustion
const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
            try {
                session.transport.close();
            }
            catch {
                // Ignore errors during cleanup
            }
            sessions.delete(id);
        }
    }
}, SESSION_CLEANUP_INTERVAL_MS);
// Prevent interval from keeping process alive during shutdown
sessionCleanupInterval.unref();
/**
 * Rate limiting with fixed time windows and periodic cleanup.
 *
 * Two separate limits are enforced:
 * 1. Per-hostname: Protects individual target servers from being hammered
 * 2. Per-client: Prevents a single client from making too many requests overall
 *
 * Without per-client limits, an attacker could bypass per-hostname limits by
 * spreading requests across many different hostnames.
 */
const MAX_REQUESTS_PER_HOST_PER_MINUTE = 60;
const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 300; // Higher limit across all hosts
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10000; // Sweep every 10 seconds
// Default client ID for stdio transport (single client)
const STDIO_CLIENT_ID = "__stdio_client__";
// Separate maps for hostname and client rate limiting
const hostRateLimitMap = new Map();
const clientRateLimitMap = new Map();
function checkRateLimitInternal(map, key, maxRequests, errorPrefix) {
    const now = Date.now();
    const entry = map.get(key);
    // Start new window if none exists or current window expired
    if (!entry || (now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
        map.set(key, { count: 1, windowStart: now });
        return;
    }
    if (entry.count >= maxRequests) {
        throw new Error(`${errorPrefix}. Maximum ${maxRequests} requests per minute.`);
    }
    entry.count++;
}
/**
 * Check both per-hostname and per-client rate limits.
 *
 * @param hostname - Target hostname (for per-host limit)
 * @param clientId - Client identifier (session ID for HTTP, default for stdio)
 */
function checkRateLimits(hostname, clientId = STDIO_CLIENT_ID) {
    // Check per-hostname limit first (protects target servers)
    checkRateLimitInternal(hostRateLimitMap, hostname, MAX_REQUESTS_PER_HOST_PER_MINUTE, `Rate limit exceeded for host "${hostname}"`);
    // Check per-client limit (prevents overall abuse)
    checkRateLimitInternal(clientRateLimitMap, clientId, MAX_REQUESTS_PER_CLIENT_PER_MINUTE, "Client rate limit exceeded");
}
// Single cleanup interval instead of O(n) per-request timers
const rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hostRateLimitMap) {
        if ((now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
            hostRateLimitMap.delete(key);
        }
    }
    for (const [key, entry] of clientRateLimitMap) {
        if ((now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
            clientRateLimitMap.delete(key);
        }
    }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
// Prevent an interval from keeping process alive during shutdown
rateLimitCleanupInterval.unref();
// Shared temp directory for saved responses (lazily initialized, cleaned up on shutdown)
let sharedTempDir = null;
let tempDirPromise = null;
async function getOrCreateTempDir() {
    // Return cached promise to prevent race condition with concurrent requests
    if (tempDirPromise) {
        return tempDirPromise;
    }
    tempDirPromise = (async () => {
        const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
        await chmod(dir, 0o700); // Owner-only access
        sharedTempDir = dir;
        return dir;
    })();
    return tempDirPromise;
}
// Clean up orphaned temp directories from previous runs (handles crashes)
// Uses age-based cleanup to avoid racing with other live instances
async function cleanupOrphanedTempDirs() {
    try {
        const tempBase = tmpdir();
        const entries = await readdir(tempBase);
        const now = Date.now();
        for (const entry of entries) {
            if (entry.startsWith(TEMP_DIR_PREFIX)) {
                const dirPath = join(tempBase, entry);
                // Skip our current session's directory
                if (dirPath === sharedTempDir)
                    continue;
                try {
                    // Only delete directories older than threshold to avoid racing with other instances
                    const stats = await stat(dirPath);
                    const ageMs = now - stats.mtimeMs;
                    if (ageMs < ORPHAN_DIR_MIN_AGE_MS) {
                        continue; // Too recent, might belong to another live instance
                    }
                    await rm(dirPath, { recursive: true, force: true });
                }
                catch (error) {
                    // Log but don't fail - dir may have been deleted by another instance
                    console.error("Error cleaning up orphaned temp dir:", dirPath, error);
                }
            }
        }
    }
    catch (error) {
        // Log but don't crash - cleanup is best-effort
        console.error("Error during orphaned temp dir cleanup:", error);
    }
}
// Environment variable for a custom output directory
const OUTPUT_DIR_ENV_VAR = "MCP_CURL_OUTPUT_DIR";
// Resolve the output directory with priority: 1) parameter, 2) env var, 3) null (use temp)
function resolveOutputDir(paramDir) {
    if (paramDir !== undefined) {
        const trimmedParam = paramDir.trim();
        if (!trimmedParam) {
            throw new Error(`Invalid output_dir: value is empty or whitespace-only. ` +
                `Remove it to use the environment variable or temp directory, or provide a valid path.`);
        }
        return trimmedParam;
    }
    const rawEnvDir = process.env[OUTPUT_DIR_ENV_VAR];
    if (rawEnvDir !== undefined) {
        const envDir = rawEnvDir.trim();
        if (!envDir) {
            throw new Error(`Environment variable ${OUTPUT_DIR_ENV_VAR} is set but empty or whitespace-only. ` +
                `Unset it or provide a valid directory path.`);
        }
        return envDir;
    }
    return null;
}
/**
 * Validate output directory is safe to use. Returns the real path (symlinks resolved).
 *
 * Security: We use realpath() to resolve symlinks before validation. This prevents
 * symlink-based attacks where an attacker creates a symlink pointing outside the
 * intended directory (e.g., /safe/output -> /etc). Without realpath(), we would
 * validate "/safe/output" but actually write to "/etc".
 */
async function validateOutputDir(dir) {
    // Block path traversal in input string
    if (dir.includes("..")) {
        throw new Error(`Invalid output_dir: path traversal detected. ` +
            `Please provide a direct path without ".." components.`);
    }
    // Resolve to absolute path (does NOT follow symlinks)
    const absolutePath = resolve(dir);
    // Check directory exists first
    try {
        const stats = await stat(absolutePath);
        if (!stats.isDirectory()) {
            throw new Error(`Invalid output_dir "${dir}": path exists but is not a directory`);
        }
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`Invalid output_dir "${dir}": directory does not exist. ` +
                `Please create it first or use a different path.`);
        }
        throw error;
    }
    // Resolve symlinks to get the real filesystem path
    // This ensures we validate and use the actual destination, not just the symlink
    const realPath = await realpath(absolutePath);
    // Check directory is writable using the real path
    try {
        await access(realPath, fsConstants.W_OK);
    }
    catch (error) {
        throw new Error(`Invalid output_dir "${dir}": directory is not writable`);
    }
    return realPath;
}
// Maximum file size for jq_query tool (same as curl response limit)
const MAX_JQ_QUERY_FILE_SIZE = MAX_RESPONSE_SIZE; // 10MB
/**
 * Validate a file path for jq_query tool (security: restrict to allowed directories).
 *
 * Security: We use realpath() to resolve symlinks before checking directory containment.
 * This prevents symlink escape attacks where an attacker creates a symlink in an allowed
 * directory that points outside it. For example:
 *   - Allowed directory: /home/user/project (cwd)
 *   - Attacker creates: /home/user/project/data.json -> /etc/passwd
 *   - Without realpath(): "/home/user/project/data.json" passes containment check
 *   - With realpath(): Resolves to "/etc/passwd", which fails containment check
 *
 * We also resolve allowed directories via realpath() for consistency, in case cwd or
 * MCP_CURL_OUTPUT_DIR are themselves symlinks.
 */
async function validateFilePath(filepath) {
    // Block path traversal in input string (defense-in-depth, matches validateOutputDir)
    if (filepath.includes("..")) {
        throw new Error(`Invalid filepath: path traversal detected. ` +
            `Please provide a direct path without ".." components.`);
    }
    // First, resolve to absolute path (does NOT follow symlinks)
    const absolutePath = resolve(filepath);
    // Check file exists and get its real path (follows symlinks)
    let realFilePath;
    try {
        // realpath() resolves symlinks and will fail if file doesn't exist
        realFilePath = await realpath(absolutePath);
        const stats = await stat(realFilePath);
        if (!stats.isFile()) {
            throw new Error(`Invalid filepath "${filepath}": path exists but is not a file`);
        }
        // Check file size
        if (stats.size > MAX_JQ_QUERY_FILE_SIZE) {
            throw new Error(`File "${filepath}" is too large (${stats.size} bytes). ` +
                `Maximum file size for jq_query is ${MAX_JQ_QUERY_FILE_SIZE / 1_000_000}MB.`);
        }
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`File "${filepath}" does not exist`);
        }
        throw error;
    }
    // Check file is readable
    try {
        await access(realFilePath, fsConstants.R_OK);
    }
    catch (error) {
        throw new Error(`File "${filepath}" is not readable`);
    }
    // Build list of allowed directories (using real paths to handle symlinks consistently)
    const allowedDirs = [];
    // 1. Our temp directory
    if (sharedTempDir) {
        allowedDirs.push(sharedTempDir);
    }
    // 2. Configured output directory from env var
    const envOutputDir = process.env[OUTPUT_DIR_ENV_VAR];
    if (envOutputDir) {
        try {
            // Use realpath to get actual directory path
            const realEnvDir = await realpath(resolve(envOutputDir));
            const envDirStats = await stat(realEnvDir);
            if (!envDirStats.isDirectory()) {
                throw new Error(`Invalid ${OUTPUT_DIR_ENV_VAR} value "${envOutputDir}": path exists but is not a directory`);
            }
            await access(realEnvDir, fsConstants.W_OK);
            allowedDirs.push(realEnvDir);
        }
        catch (error) {
            const err = error;
            if (err.code === "ENOENT") {
                throw new Error(`Invalid ${OUTPUT_DIR_ENV_VAR} value "${envOutputDir}": directory does not exist`);
            }
            if (err.code === "EACCES") {
                throw new Error(`Invalid ${OUTPUT_DIR_ENV_VAR} value "${envOutputDir}": directory is not writable`);
            }
            throw error;
        }
    }
    // 3. Current working directory (use realpath in case cwd itself is a symlink)
    try {
        allowedDirs.push(await realpath(process.cwd()));
    }
    catch {
        // If cwd can't be resolved (unlikely), use it as-is
        allowedDirs.push(process.cwd());
    }
    // Check if REAL file path is within any allowed directory
    // This prevents symlink escapes: a symlink in cwd pointing to /etc would be blocked
    const isInAllowedDir = allowedDirs.some((dir) => {
        const rel = relative(dir, realFilePath);
        // File is in allowed dir if relative path doesn't start with .. and isn't absolute
        // (absolute check handles Windows cross-drive paths like "D:\other")
        return !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!isInAllowedDir) {
        throw new Error(`Access denied: file "${filepath}" is not in an allowed directory. ` +
            `Allowed directories: temp directory, MCP_CURL_OUTPUT_DIR, and current working directory.`);
    }
}
// Check if the content-type indicates JSON
function isJsonContentType(contentType) {
    if (!contentType)
        return false;
    const ct = contentType.toLowerCase();
    return ct.includes("application/json") || ct.includes("+json");
}
// Maximum distance from end where we expect to find the metadata separator
// Content-type headers are typically short, so 200 chars is plenty
const MAX_METADATA_TAIL_LENGTH = 200;
// Parse curl response to extract body and content-type
// The separator must be the same unique value used in the -w format string
function parseResponseWithMetadata(rawResponse, separator) {
    // Only search for separator near the end as a defense-in-depth measure
    // The unique per-request separator is the primary protection against injection
    const searchStart = Math.max(0, rawResponse.length - MAX_METADATA_TAIL_LENGTH);
    const tailSection = rawResponse.slice(searchStart);
    const separatorIndexInTail = tailSection.lastIndexOf(separator);
    if (separatorIndexInTail === -1) {
        return { body: rawResponse };
    }
    const separatorIndex = searchStart + separatorIndexInTail;
    const body = rawResponse.slice(0, separatorIndex);
    const contentType = rawResponse.slice(separatorIndex + separator.length).trim();
    return { body, contentType: contentType || undefined };
}
// Sanitize error messages to prevent information disclosure
function sanitizeErrorMessage(message, includeDetails) {
    if (includeDetails) {
        return message;
    }
    // Remove response previews (could contain sensitive API data)
    let sanitized = message.replace(/\nPreview:[\s\S]*$/, "");
    // Remove file paths (could leak system information)
    sanitized = sanitized.replace(/\/[^\s:]+/g, "[PATH]");
    // Add hint about getting more details
    if (sanitized !== message) {
        sanitized += " (use include_metadata: true for details)";
    }
    return sanitized;
}
// Create a new MCP server instance
function createServer() {
    return new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });
}
/**
 * Global memory tracking for concurrent response handling.
 *
 * While each request is limited to MAX_RESPONSE_SIZE (10MB), multiple concurrent
 * requests could exhaust memory. This tracks total memory across all active
 * requests and rejects new data when the limit is reached.
 */
const MAX_TOTAL_RESPONSE_MEMORY = 100_000_000; // 100MB total across all requests
let totalResponseMemory = 0;
// Helper function to execute a command
async function executeCommand(command, args, timeout = DEFAULT_TIMEOUT) {
    // Track this request's memory usage for cleanup
    let requestMemoryUsage = 0;
    return new Promise((resolve, reject) => {
        // Use AbortController for process-level timeout (spawn ignores timeout option)
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);
        const childProcess = spawn(command, args, {
            signal: abortController.signal,
        });
        let stdout = "";
        let stderr = "";
        let killed = false;
        // Cleanup function to release memory tracking
        const releaseMemory = () => {
            totalResponseMemory -= requestMemoryUsage;
            requestMemoryUsage = 0;
        };
        childProcess.stdout?.on("data", (data) => {
            const dataSize = Buffer.byteLength(data, "utf8");
            // Check global memory limit
            if (totalResponseMemory + dataSize > MAX_TOTAL_RESPONSE_MEMORY && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseMemory();
                childProcess.kill();
                reject(new Error("Server memory limit reached due to concurrent requests. Please try again later."));
                return;
            }
            stdout += data.toString();
            requestMemoryUsage += dataSize;
            totalResponseMemory += dataSize;
            // Check per-request limit
            if (Buffer.byteLength(stdout, "utf8") > MAX_RESPONSE_SIZE && !killed) {
                killed = true;
                clearTimeout(timeoutId);
                releaseMemory();
                childProcess.kill();
                reject(new Error(`Response exceeded maximum processing size of ${MAX_RESPONSE_SIZE / 1_000_000}MB. ` +
                    `Consider using a more specific API endpoint or adding query parameters to reduce response size.`));
            }
        });
        childProcess.stderr?.on("data", (data) => {
            const stderrBytes = Buffer.byteLength(stderr, "utf8");
            if (stderrBytes < MAX_RESPONSE_SIZE) {
                stderr += data.toString();
                if (Buffer.byteLength(stderr, "utf8") > MAX_RESPONSE_SIZE) {
                    // Truncate efficiently using Buffer slice
                    const truncateMsg = "\n[stderr truncated]";
                    const maxBytes = MAX_RESPONSE_SIZE - Buffer.byteLength(truncateMsg, "utf8");
                    const buf = Buffer.from(stderr, "utf8").subarray(0, maxBytes);
                    stderr = buf.toString("utf8") + truncateMsg;
                }
            }
        });
        childProcess.on("close", (code) => {
            clearTimeout(timeoutId);
            releaseMemory(); // Release memory tracking on completion
            if (!killed) {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            }
        });
        childProcess.on("error", (error) => {
            clearTimeout(timeoutId);
            releaseMemory(); // Release memory tracking on error
            // AbortError means our timeout triggered
            if (error.name === "AbortError") {
                reject(new Error(`Request timed out after ${timeout / 1000} seconds. ` +
                    `The server may be slow or unresponsive.`));
            }
            else {
                reject(error);
            }
        });
    });
}
// Validate session ID format (UUID v4) to prevent malformed session IDs as Map keys
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidSessionId(sessionId) {
    return sessionId !== undefined && UUID_REGEX.test(sessionId);
}
// Validate that a string doesn't contain CRLF characters (prevents header injection/smuggling)
function validateNoCRLF(value, fieldName) {
    if (value.includes("\r") || value.includes("\n")) {
        throw new Error(`Invalid ${fieldName}: contains newline characters. ` +
            `This could enable header injection attacks.`);
    }
}
/**
 * SSRF protection: block requests to private/internal networks.
 *
 * This includes IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) which could otherwise
 * bypass IPv4-only blocklists. For example, ::ffff:127.0.0.1 maps to 127.0.0.1.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
    // IPv4 loopback and mapped IPv6
    /^127\.\d+\.\d+\.\d+$/,
    /^\[?::ffff:127\.\d+\.\d+\.\d+\]?$/i,
    // Private Class A (10.x.x.x) and mapped IPv6
    /^10\.\d+\.\d+\.\d+$/,
    /^\[?::ffff:10\.\d+\.\d+\.\d+\]?$/i,
    // Private Class B (172.16-31.x.x) and mapped IPv6
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^\[?::ffff:172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\]?$/i,
    // Private Class C (192.168.x.x) and mapped IPv6
    /^192\.168\.\d+\.\d+$/,
    /^\[?::ffff:192\.168\.\d+\.\d+\]?$/i,
    // Link-local (169.254.x.x) and mapped IPv6
    /^169\.254\.\d+\.\d+$/,
    /^\[?::ffff:169\.254\.\d+\.\d+\]?$/i,
    // All interfaces
    /^0\.0\.0\.0$/,
    /^\[?::ffff:0\.0\.0\.0\]?$/i,
    // IPv6 loopback
    /^\[?::1\]?$/,
    // IPv6 link-local
    /^\[?fe80:/i,
    // IPv6 unique local (fc00::/7)
    /^\[?fc00:/i,
    /^\[?fd[0-9a-f]{2}:/i,
    // Internal TLDs
    /\.local$/i,
    /\.internal$/i,
    /\.corp$/i,
    /\.lan$/i,
    /\.localhost$/i,
    // Windows UNC paths (\\server\share) - could access internal network shares
    /^\\\\[^\\]+/,
];
// Localhost hostname patterns - separate so they can be conditionally allowed
const LOCALHOST_HOSTNAME_PATTERNS = [
    /^localhost$/i,
];
// Patterns for validating resolved IP addresses (after DNS resolution)
// These catch DNS rebinding attacks where hostname passes but resolves to blocked IP
const BLOCKED_IP_PATTERNS = [
    // IPv4 loopback
    /^127\.\d+\.\d+\.\d+$/,
    // Private Class A
    /^10\.\d+\.\d+\.\d+$/,
    // Private Class B
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    // Private Class C
    /^192\.168\.\d+\.\d+$/,
    // Link-local
    /^169\.254\.\d+\.\d+$/,
    // All interfaces
    /^0\.0\.0\.0$/,
    // IPv6 loopback
    /^::1$/,
    // IPv6 link-local
    /^fe80:/i,
    // IPv6 unique local
    /^fc00:/i,
    /^fd[0-9a-f]{2}:/i,
    // IPv4-mapped IPv6 (these resolve to the IPv4 form, but check anyway)
    /^::ffff:127\./i,
    /^::ffff:10\./i,
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:169\.254\./i,
    /^::ffff:0\.0\.0\.0$/i,
];
// Localhost IP patterns
const LOCALHOST_IP_PATTERNS = [
    /^127\.\d+\.\d+\.\d+$/,
    /^::1$/,
    /^::ffff:127\./i,
];
// Environment variable to allow localhost access (for local development/testing)
const ALLOW_LOCALHOST_ENV_VAR = "MCP_CURL_ALLOW_LOCALHOST";
// Allowed ports when localhost is enabled: 80, 443, and unprivileged ports (>1024)
// This prevents access to privileged services like SSH (22), SMTP (25), databases, etc.
const ALLOWED_LOCALHOST_PORTS = new Set([80, 443]);
const MIN_UNPRIVILEGED_PORT = 1024;
function isLocalhostAllowed() {
    const value = process.env[ALLOW_LOCALHOST_ENV_VAR]?.toLowerCase();
    return value === "true" || value === "1" || value === "yes";
}
function isAllowedLocalhostPort(port) {
    return ALLOWED_LOCALHOST_PORTS.has(port) || port > MIN_UNPRIVILEGED_PORT;
}
function isLocalhostIp(ip) {
    return LOCALHOST_IP_PATTERNS.some(pattern => pattern.test(ip));
}
function isBlockedIp(ip) {
    return BLOCKED_IP_PATTERNS.some(pattern => pattern.test(ip));
}
/**
 * Resolve DNS for a hostname and return the IP address.
 * This is used to pin DNS resolution and prevent DNS rebinding attacks.
 */
async function resolveDns(hostname) {
    try {
        const result = await lookup(hostname);
        return result.address;
    }
    catch (error) {
        throw new Error(`DNS resolution failed for "${hostname}": ${error.message}`);
    }
}
/**
 * Validate URL is not internal and resolve DNS to prevent rebinding attacks.
 *
 * DNS Rebinding Prevention: We resolve DNS ourselves and validate the IP BEFORE
 * passing to cURL. We then use --resolve to pin cURL to our validated IP.
 * This prevents attacks where:
 *   1. Attacker's DNS returns public IP (passes hostname check)
 *   2. DNS TTL expires or attacker rebinds
 *   3. cURL re-resolves and gets private IP (127.0.0.1)
 *   4. cURL connects to internal service
 *
 * By resolving once and pinning with --resolve, cURL uses our validated IP.
 */
async function validateUrlAndResolveDns(url) {
    // Block file:// protocol which could read local files
    if (url.toLowerCase().startsWith("file://")) {
        throw new Error("file:// URLs are not allowed - they could be used to read local files");
    }
    // Block Windows UNC paths in raw URL (\\server\share)
    if (url.startsWith("\\\\")) {
        throw new Error("UNC paths are not allowed - they could access internal network shares");
    }
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "https:" ? 443 : 80);
    // Only allow http:// and https:// protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Protocol "${parsed.protocol}" is not allowed - only http:// and https:// are supported`);
    }
    // Check hostname against blocked patterns (TLDs, UNC paths, etc.)
    for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error(`Requests to internal/private networks are not allowed: ${hostname}`);
        }
    }
    // Check if hostname is "localhost" (special handling)
    const isLocalhostHostname = LOCALHOST_HOSTNAME_PATTERNS.some(pattern => pattern.test(hostname));
    // Resolve DNS to get actual IP (prevents DNS rebinding)
    // For IP addresses, this just returns the IP itself
    const resolvedIp = await resolveDns(hostname);
    // Check if resolved IP is localhost
    const isLocalhostResolved = isLocalhostIp(resolvedIp);
    if (isLocalhostHostname || isLocalhostResolved) {
        if (!isLocalhostAllowed()) {
            throw new Error(`Requests to localhost are blocked by default. ` +
                `Set ${ALLOW_LOCALHOST_ENV_VAR}=true to enable local development/testing.` +
                (isLocalhostResolved && !isLocalhostHostname
                    ? ` (Note: "${hostname}" resolved to localhost IP ${resolvedIp})`
                    : ""));
        }
        // Localhost is allowed, but check port restrictions
        if (!isAllowedLocalhostPort(port)) {
            throw new Error(`Localhost requests are restricted to ports 80, 443, and >1024. ` +
                `Port ${port} is not allowed to prevent access to privileged services.`);
        }
        // Localhost request is allowed
        return { hostname, port, resolvedIp };
    }
    // Check resolved IP against blocked patterns (catches DNS rebinding)
    if (isBlockedIp(resolvedIp)) {
        throw new Error(`DNS rebinding attack detected: "${hostname}" resolved to blocked IP ${resolvedIp}. ` +
            `Requests to internal/private networks are not allowed.`);
    }
    return { hostname, port, resolvedIp };
}
// Build cURL arguments from structured parameters
function buildCurlArgs(params) {
    const args = [];
    // Method
    if (params.method) {
        args.push("-X", params.method.toUpperCase());
    }
    // Headers - validate against CRLF injection
    if (params.headers) {
        for (const [key, value] of Object.entries(params.headers)) {
            validateNoCRLF(key, "header name");
            validateNoCRLF(value, `header value for "${key}"`);
            args.push("-H", `${key}: ${value}`);
        }
    }
    // Data/body - use --data-raw to prevent @/< file reading (security: prevents local file exfiltration)
    if (params.data) {
        args.push("--data-raw", params.data);
    }
    // Form data - use --form-string to prevent @/< file reading (security: prevents local file exfiltration)
    if (params.form) {
        for (const [key, value] of Object.entries(params.form)) {
            args.push("--form-string", `${key}=${value}`);
        }
    }
    // Follow redirects
    if (params.follow_redirects !== false) {
        args.push("-L");
        if (params.max_redirects !== undefined) {
            args.push("--max-redirs", params.max_redirects.toString());
        }
    }
    // Insecure (skip SSL verification)
    if (params.insecure) {
        args.push("-k");
    }
    // Timeout
    if (params.timeout) {
        args.push("--max-time", params.timeout.toString());
    }
    // User agent - validate against CRLF injection
    if (params.user_agent) {
        validateNoCRLF(params.user_agent, "user_agent");
        args.push("-A", params.user_agent);
    }
    // Basic auth - validate against CRLF injection
    if (params.basic_auth) {
        validateNoCRLF(params.basic_auth, "basic_auth");
        args.push("-u", params.basic_auth);
    }
    // Bearer token - validate against CRLF injection
    if (params.bearer_token) {
        validateNoCRLF(params.bearer_token, "bearer_token");
        args.push("-H", `Authorization: Bearer ${params.bearer_token}`);
    }
    // Verbose mode
    if (params.verbose) {
        args.push("-v");
    }
    // Include response headers
    if (params.include_headers) {
        args.push("-i");
    }
    // Compressed response
    if (params.compressed) {
        args.push("--compressed");
    }
    // Silent mode (no progress)
    if (params.silent !== false) {
        args.push("-s");
    }
    // Output format for response info (custom format + metadata separator for content-type)
    // The separator is unique per-request to prevent response injection attacks
    const metadataSuffix = params.metadataSeparator.replace(/\n/g, "\\n") + "%{content_type}";
    if (params.output_format) {
        args.push("-w", params.output_format + metadataSuffix);
    }
    else {
        args.push("-w", metadataSuffix);
    }
    // DNS pinning with --resolve to prevent DNS rebinding attacks
    // Format: --resolve hostname:port:ip
    // This forces cURL to use our pre-validated IP instead of doing its own DNS lookup
    if (params.dnsResolve) {
        const { hostname, port, resolvedIp } = params.dnsResolve;
        args.push("--resolve", `${hostname}:${port}:${resolvedIp}`);
    }
    // URL must be last
    args.push(params.url);
    return args;
}
// Format the response for output
function formatResponse(stdout, stderr, exitCode, includeMetadata, fileSaveInfo) {
    // If file was saved, always indicate the filepath (user needs to know where data is)
    if (fileSaveInfo?.savedToFile && fileSaveInfo.filepath) {
        if (includeMetadata) {
            // Full JSON metadata
            const output = {
                success: exitCode === 0,
                exit_code: exitCode,
                saved_to_file: true,
                filepath: fileSaveInfo.filepath,
                message: fileSaveInfo.message ?? "Response saved to file. Read the file to access contents.",
            };
            if (stderr)
                output.stderr = stderr;
            return JSON.stringify(output, null, 2);
        }
        // Plain text - just return the message or fallback to filepath
        return fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
    }
    // Normal response
    if (includeMetadata) {
        const output = {
            success: exitCode === 0,
            exit_code: exitCode,
            response: stdout,
        };
        if (stderr)
            output.stderr = stderr;
        return JSON.stringify(output, null, 2);
    }
    return stdout;
}
// Parse bracket notation: [], ["key"], [n], [n:m]
function parseBracketToken(filter, startIndex) {
    let i = startIndex + 1; // skip opening [
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket "[" in filter "${filter}"`);
    }
    // Check for iterate []
    if (filter[i] === "]") {
        return { token: { type: "iterate" }, newIndex: i + 1 };
    }
    // Check for string key ["key"] with escape sequence handling
    if (filter[i] === '"' || filter[i] === "'") {
        const quote = filter[i];
        i++; // skip opening quote
        let key = "";
        let foundClosingQuote = false;
        while (i < filter.length) {
            const ch = filter[i];
            // Handle escape sequences like \" or \'
            if (ch === "\\") {
                if (i + 1 < filter.length) {
                    key += filter[i + 1];
                    i += 2;
                    continue;
                }
                // Trailing backslash with no next char; append as-is
                key += ch;
                i++;
                continue;
            }
            // End of quoted string on unescaped matching quote
            if (ch === quote) {
                i++; // skip closing quote
                foundClosingQuote = true;
                break;
            }
            key += ch;
            i++;
        }
        // Check for missing closing quote first (more specific error)
        if (!foundClosingQuote) {
            throw new Error(`Missing closing quote ${quote} in filter "${filter}"`);
        }
        if (i >= filter.length || filter[i] !== "]") {
            throw new Error(`Missing closing bracket "]" after quoted key in filter "${filter}"`);
        }
        i++; // skip ]
        return { token: { type: "key", value: key }, newIndex: i };
    }
    // Parse number index or slice
    let numStr = "";
    let hasColon = false;
    while (i < filter.length && filter[i] !== "]") {
        if (filter[i] === ":")
            hasColon = true;
        numStr += filter[i];
        i++;
    }
    // Validate closing bracket exists
    if (i >= filter.length) {
        throw new Error(`Unterminated bracket expression in filter "${filter}" at position ${startIndex}`);
    }
    i++; // skip ]
    if (hasColon) {
        const parts = numStr.split(":");
        if (parts.length > 2) {
            throw new Error(`Invalid slice "[${numStr}]" in filter "${filter}": only [start:end] format is supported`);
        }
        let start;
        if (parts[0]) {
            const parsedStart = parseInt(parts[0], 10);
            if (Number.isNaN(parsedStart)) {
                throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}"`);
            }
            start = parsedStart;
        }
        let end;
        if (parts[1]) {
            const parsedEnd = parseInt(parts[1], 10);
            if (Number.isNaN(parsedEnd)) {
                throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}"`);
            }
            end = parsedEnd;
        }
        return {
            token: { type: "slice", start, end },
            newIndex: i,
        };
    }
    // Simple index [n] - must be non-negative
    const index = parseInt(numStr, 10);
    if (Number.isNaN(index)) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}"`);
    }
    if (index < 0) {
        throw new Error(`Invalid array index "${numStr}" in filter "${filter}": negative indices are not supported`);
    }
    return { token: { type: "index", value: index }, newIndex: i };
}
// Limits to prevent DoS via complex jq filters
const MAX_JQ_FILTER_LENGTH = 500;
const MAX_JQ_TOKENS = 50;
const MAX_JQ_FILTERS = 20; // Maximum number of comma-separated filters
const MAX_JQ_PARSE_TIME_MS = 100; // Maximum time for parsing operations
// Parse a jq-like filter expression into tokens
function parseJqFilter(filter) {
    if (filter.length > MAX_JQ_FILTER_LENGTH) {
        throw new Error(`jq_filter exceeds maximum length of ${MAX_JQ_FILTER_LENGTH} characters`);
    }
    const startTime = Date.now();
    const tokens = [];
    let i = filter[0] === "." ? 1 : 0; // skip leading dot
    while (i < filter.length) {
        // Timeout check to prevent DoS via complex filters
        if (Date.now() - startTime > MAX_JQ_PARSE_TIME_MS) {
            throw new Error("jq_filter parsing timeout - filter too complex");
        }
        if (filter[i] === ".") {
            i++;
            continue;
        }
        if (filter[i] === "[") {
            const result = parseBracketToken(filter, i);
            tokens.push(result.token);
            if (tokens.length > MAX_JQ_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${MAX_JQ_TOKENS} path segments`);
            }
            i = result.newIndex;
            continue;
        }
        // Bare key (or numeric index via dot notation like .0)
        let key = "";
        while (i < filter.length && filter[i] !== "." && filter[i] !== "[") {
            key += filter[i];
            i++;
        }
        if (key) {
            // Check if key is a non-negative numeric index (e.g., .0, .10)
            if (/^\d+$/.test(key)) {
                const parsed = parseInt(key, 10);
                // Validate: within safe integer range
                if (!Number.isSafeInteger(parsed)) {
                    throw new Error(`Invalid array index "${key}" in filter "${filter}": exceeds safe integer range`);
                }
                // Validate: no leading zeros (e.g., "007" should be rejected, but "0" is ok)
                if (key !== String(parsed)) {
                    throw new Error(`Invalid array index "${key}" in filter "${filter}": leading zeros are not allowed`);
                }
                tokens.push({ type: "index", value: parsed });
            }
            else {
                tokens.push({ type: "key", value: key });
            }
            if (tokens.length > MAX_JQ_TOKENS) {
                throw new Error(`jq_filter exceeds maximum of ${MAX_JQ_TOKENS} path segments`);
            }
        }
    }
    return tokens;
}
// Type guard for plain objects (not arrays or null)
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// Split jq filter on commas, respecting brackets and quotes
// e.g., ".name,.address[0],.[\"key,with,commas\"]" -> [".name", ".address[0]", ".[\"key,with,commas\"]"]
function splitJqFilters(filter) {
    if (filter.length > MAX_JQ_FILTER_LENGTH) {
        throw new Error(`jq_filter exceeds maximum length of ${MAX_JQ_FILTER_LENGTH} characters`);
    }
    const startTime = Date.now();
    const filters = [];
    let current = "";
    let bracketDepth = 0;
    let inQuote = null;
    let escaped = false;
    for (let i = 0; i < filter.length; i++) {
        // Timeout check to prevent DoS
        if (Date.now() - startTime > MAX_JQ_PARSE_TIME_MS) {
            throw new Error("jq_filter parsing timeout - filter too complex");
        }
        const ch = filter[i];
        // Handle escape sequences inside quotes
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\" && inQuote) {
            current += ch;
            escaped = true;
            continue;
        }
        // Track quote state
        if ((ch === '"' || ch === "'") && !inQuote) {
            inQuote = ch;
            current += ch;
            continue;
        }
        if (ch === inQuote) {
            inQuote = null;
            current += ch;
            continue;
        }
        // Skip bracket tracking while inside quotes
        if (inQuote) {
            current += ch;
            continue;
        }
        // Track bracket depth
        if (ch === "[") {
            bracketDepth++;
            current += ch;
            continue;
        }
        if (ch === "]") {
            bracketDepth--;
            if (bracketDepth < 0) {
                throw new Error(`Invalid jq_filter "${filter}": unmatched closing bracket "]"`);
            }
            current += ch;
            continue;
        }
        // Split on comma only at top level (not inside brackets or quotes)
        if (ch === "," && bracketDepth === 0) {
            const trimmed = current.trim();
            if (!trimmed) {
                // Empty segment: leading comma, consecutive commas, or will be trailing
                const position = filters.length === 0 ? "leading" : "consecutive";
                throw new Error(`Invalid jq_filter "${filter}": ${position} comma at position ${i}`);
            }
            filters.push(trimmed);
            current = "";
            continue;
        }
        current += ch;
    }
    // Check for unclosed quotes
    if (inQuote) {
        throw new Error(`Invalid jq_filter "${filter}": unclosed ${inQuote === '"' ? 'double' : 'single'} quote`);
    }
    // Check for unclosed brackets
    if (bracketDepth > 0) {
        throw new Error(`Invalid jq_filter "${filter}": unclosed bracket "["`);
    }
    // Don't forget the last segment
    const trimmed = current.trim();
    if (!trimmed && filters.length > 0) {
        // We had previous segments but the last one is empty = trailing comma
        throw new Error(`Invalid jq_filter "${filter}": trailing comma`);
    }
    if (trimmed) {
        filters.push(trimmed);
    }
    return filters;
}
// Apply a single jq-like filter path to parsed JSON data
function applySingleJqFilter(data, filter) {
    const tokens = parseJqFilter(filter);
    // Reject empty or dots-only filters that produce no tokens
    if (tokens.length === 0) {
        throw new Error(`Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`);
    }
    let result = data;
    for (const token of tokens) {
        if (result === null || result === undefined) {
            return null;
        }
        switch (token.type) {
            case "key":
                // Key access only works on plain objects, not arrays or primitives
                if (!isRecord(result)) {
                    return null;
                }
                result = result[token.value];
                break;
            case "index":
                if (Array.isArray(result)) {
                    result = result[token.value];
                }
                else {
                    return null;
                }
                break;
            case "slice":
                if (Array.isArray(result)) {
                    result = result.slice(token.start, token.end);
                }
                else {
                    return null;
                }
                break;
            case "iterate":
                if (!Array.isArray(result)) {
                    return null;
                }
                // For iterate, we just keep the array as-is for now
                // (full jq would expand it, but for our purposes keeping array is fine)
                break;
        }
    }
    return result;
}
// Apply a jq-like filter to JSON data (supports comma-separated multiple paths)
function applyJqFilter(jsonString, filter) {
    let data;
    try {
        data = JSON.parse(jsonString);
    }
    catch (error) {
        // SyntaxError indicates invalid JSON
        if (error instanceof SyntaxError) {
            const preview = jsonString.slice(0, ERROR_PREVIEW_LENGTH);
            throw new Error(`Response is not valid JSON. Cannot apply jq_filter.\nPreview: ${preview}${jsonString.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
        }
        throw error; // Re-throw unexpected errors
    }
    // Split into multiple filters (handles commas outside brackets/quotes)
    const filters = splitJqFilters(filter);
    if (filters.length === 0) {
        throw new Error(`Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`);
    }
    if (filters.length > MAX_JQ_FILTERS) {
        throw new Error(`jq_filter exceeds maximum of ${MAX_JQ_FILTERS} comma-separated paths`);
    }
    // Single filter: return value directly (backward compatible)
    if (filters.length === 1) {
        const result = applySingleJqFilter(data, filters[0]);
        return JSON.stringify(result, null, 2);
    }
    // Multiple filters: return array of values
    const results = filters.map((f) => applySingleJqFilter(data, f));
    return JSON.stringify(results, null, 2);
}
// Windows reserved filenames that cannot be used as base names
const WINDOWS_RESERVED_BASENAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
// Create a safe filename base from arbitrary input
function createSafeFilenameBase(input, fallback = "response") {
    // Replace non-alphanumeric characters with underscores
    let base = input.replace(/[^a-zA-Z0-9]/g, "_");
    // Trim leading and trailing underscores to avoid names like "___"
    base = base.replace(/^_+|_+$/g, "");
    // Ensure we have a non-empty base
    if (!base) {
        base = fallback;
    }
    // Enforce maximum length
    base = base.slice(0, FILENAME_MAX_LENGTH);
    const upper = base.toUpperCase();
    // Avoid reserved or problematic base names across platforms
    if (WINDOWS_RESERVED_BASENAMES.has(upper) || upper === "." || upper === "..") {
        base = `${fallback}_${base}`.slice(0, FILENAME_MAX_LENGTH);
    }
    return base;
}
// Save response content to a file (custom output dir or temp dir)
async function saveResponseToFile(content, url, outputDir) {
    // Use custom output dir if provided, otherwise use temp dir
    const targetDir = outputDir ?? await getOrCreateTempDir();
    // Create a safe filename from URL (fall back to raw string if URL is invalid)
    let baseName;
    try {
        const urlObj = new URL(url);
        baseName = urlObj.hostname + urlObj.pathname;
    }
    catch (error) {
        // TypeError indicates invalid URL format; fall back to raw string
        if (error instanceof TypeError) {
            baseName = url;
        }
        else {
            throw error; // Re-throw unexpected errors
        }
    }
    const safeName = createSafeFilenameBase(baseName);
    const filename = `${safeName}_${Date.now()}.txt`;
    const filepath = join(targetDir, filename);
    await writeFile(filepath, content, { encoding: "utf-8", mode: 0o600 }); // Owner-only access
    return filepath;
}
async function processResponse(response, options) {
    let content = response;
    // Step 1: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const trimmed = content.trim();
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(`Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"}).\n` +
                    `Preview: ${content.slice(0, ERROR_PREVIEW_LENGTH)}${content.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
            }
            // Actually try to parse it to verify it's valid JSON
            try {
                JSON.parse(trimmed);
            }
            catch (error) {
                // SyntaxError indicates invalid JSON
                if (error instanceof SyntaxError) {
                    throw new Error(`Cannot apply jq_filter: Response does not appear to be valid JSON.\n` +
                        `Preview: ${content.slice(0, ERROR_PREVIEW_LENGTH)}${content.length > ERROR_PREVIEW_LENGTH ? "..." : ""}`);
                }
                throw error; // Re-throw unexpected errors
            }
        }
        content = applyJqFilter(content, options.jqFilter);
    }
    // Step 2: Determine max size
    const maxSize = options.maxResultSize ?? DEFAULT_MAX_RESULT_SIZE;
    const contentBytes = Buffer.byteLength(content, "utf8");
    // Step 3: Check if we need to save to file
    const shouldSave = options.saveToFile || contentBytes > maxSize;
    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url, options.outputDir);
        // Keep content as actual response data, capped to maxSize for preview
        const displayContent = contentBytes > maxSize ? content.slice(0, maxSize) : content;
        return {
            content: displayContent,
            savedToFile: true,
            filepath,
            message: `Response (${contentBytes} bytes) saved to: ${filepath}`,
        };
    }
    return {
        content,
        savedToFile: false,
    };
}
// Schema for structured cURL execution
const CurlExecuteSchema = z.object({
    url: z.string()
        .url("Must be a valid URL")
        .refine((url) => {
        const scheme = url.split(":")[0].toLowerCase();
        return ["http", "https"].includes(scheme);
    }, { message: "URL must use http or https scheme" })
        .describe("The URL to request"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .describe("HTTP method (defaults to GET, or POST if data is provided)"),
    headers: z.record(z.string())
        .optional()
        .describe("HTTP headers as key-value pairs (e.g., {\"Content-Type\": \"application/json\"})"),
    data: z.string()
        .optional()
        .describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
    form: z.record(z.string())
        .optional()
        .describe("Form data as key-value pairs (uses multipart/form-data)"),
    follow_redirects: z.boolean()
        .default(true)
        .describe("Follow HTTP redirects (default: true)"),
    max_redirects: z.number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Maximum number of redirects to follow"),
    insecure: z.boolean()
        .default(false)
        .describe("Skip SSL certificate verification (default: false)"),
    timeout: z.number()
        .int()
        .min(1)
        .max(300)
        .default(30)
        .describe("Request timeout in seconds (default: 30, max: 300)"),
    user_agent: z.string()
        .optional()
        .describe("Custom User-Agent header"),
    basic_auth: z.string()
        .optional()
        .describe("Basic authentication in format 'username:password'"),
    bearer_token: z.string()
        .optional()
        .describe("Bearer token for Authorization header"),
    verbose: z.boolean()
        .default(false)
        .describe("Include verbose output with request/response details"),
    include_headers: z.boolean()
        .default(false)
        .describe("Include response headers in output"),
    compressed: z.boolean()
        .default(true)
        .describe("Request compressed response and automatically decompress"),
    include_metadata: z.boolean()
        .default(false)
        .describe("Wrap response in JSON with metadata (exit code, success status)"),
    jq_filter: z.string()
        .optional()
        .describe("JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory."),
});
// Schema for jq_query tool (query JSON files without HTTP requests)
const JqQuerySchema = z.object({
    filepath: z.string()
        .describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
    jq_filter: z.string()
        .describe("JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save result to file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save result files (must exist and be writable)"),
});
// Register all tools and resources on a server instance
function registerToolsAndResources(server) {
    // Register the structured cURL execution tool
    server.registerTool("curl_execute", {
        title: "Execute cURL Request",
        description: `Execute an HTTP request using cURL with structured parameters.

This tool provides a safe, structured way to make HTTP requests with common cURL options.
It handles URL encoding, header formatting, and response processing automatically.

Args:
  - url (string, required): The URL to request
  - method (string): HTTP method - GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
  - headers (object): HTTP headers as key-value pairs
  - data (string): Request body for POST/PUT/PATCH requests
  - form (object): Form data as key-value pairs (multipart/form-data)
  - follow_redirects (boolean): Follow HTTP redirects (default: true)
  - max_redirects (number): Maximum redirects to follow (0-50)
  - insecure (boolean): Skip SSL verification (default: false)
  - timeout (number): Request timeout in seconds (1-300, default: 30)
  - user_agent (string): Custom User-Agent header
  - basic_auth (string): Basic auth as "username:password"
  - bearer_token (string): Bearer token for Authorization header
  - verbose (boolean): Include verbose request/response details
  - include_headers (boolean): Include response headers in output
  - compressed (boolean): Request compressed response (default: true)
  - include_metadata (boolean): Wrap response in JSON with metadata
  - jq_filter (string): JSON path filter to extract specific data
  - max_result_size (number): Max bytes to return inline (default: 500KB, max: 1MB). Auto-saves to file when exceeded
  - save_to_file (boolean): Force save response to temp file. Returns filepath instead of content
  - output_dir (string): Custom directory to save files (overrides MCP_CURL_OUTPUT_DIR env var)

jq_filter Syntax:
  - .key - Object property access
  - .[n] or .n - Array index (non-negative only, e.g., .results.0)
  - .[n:m] - Array slice from index n to m
  - .["key"] - Bracket notation for special characters in keys
  - .a,.b,.c - Multiple comma-separated paths (returns array of values, max 20)

jq_filter Validation:
  - Unclosed quotes and brackets throw clear errors
  - Leading zeros in indices rejected (use .0 not .00)
  - Negative indices not supported (unlike real jq)
  - Indices must be within safe integer range

Returns:
  The HTTP response body, or JSON with metadata if include_metadata is true:
  {
    "success": boolean,
    "exit_code": number,
    "response": string,
    "stderr": string (if present),
    "saved_to_file": boolean (if response was saved),
    "filepath": string (path to saved file)
  }

Examples:
  - Simple GET: { "url": "https://api.example.com/data" }
  - POST JSON: { "url": "https://api.example.com/users", "method": "POST", "headers": {"Content-Type": "application/json"}, "data": "{\\"name\\": \\"John\\"}" }
  - With auth: { "url": "https://api.example.com/secure", "bearer_token": "your-token-here" }
  - Extract field: { "url": "https://api.github.com/repos/octocat/hello-world", "jq_filter": ".name" }
  - Multiple fields: { "url": "https://api.example.com/user", "jq_filter": ".name,.email,.id" }
  - Dot notation: { "url": "https://api.example.com/items", "jq_filter": ".results.0.name" }
  - Array slice: { "url": "https://api.example.com/items", "jq_filter": ".results[0:10]" }
  - Custom output: { "url": "https://api.example.com/large", "save_to_file": true, "output_dir": "/path/to/dir" }

Error Handling:
  - Returns error message if cURL fails or times out
  - Exit code 0 indicates success
  - Non-zero exit codes indicate various cURL errors
  - Invalid JSON with jq_filter returns error with response preview

Temp File Lifecycle:
  Files saved with save_to_file or auto-save are:
  - Stored in a secure temp directory (owner-only access: 0o700/0o600)
  - Deleted on graceful server shutdown (SIGINT/SIGTERM)
  - Orphaned files from crashed sessions are cleaned on next server start
  - Check ${TEMP_DIR_PREFIX}* in system temp dir if files persist after crash`,
        inputSchema: CurlExecuteSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            // Validate incompatible options: include_headers prepends HTTP headers to response,
            // making it non-JSON and breaking jq_filter parsing
            if (params.include_headers && params.jq_filter) {
                throw new Error("Cannot use jq_filter with include_headers. " +
                    "HTTP headers in the response make it non-JSON. " +
                    "Remove include_headers to use jq_filter, or remove jq_filter to see headers.");
            }
            // SSRF protection: validate URL and resolve DNS to prevent rebinding attacks
            // This returns the resolved IP which we pin with --resolve
            const dnsResult = await validateUrlAndResolveDns(params.url);
            // Rate limit by both target host and client to prevent abuse
            // Per-host: protects individual targets from being hammered
            // Per-client: prevents spreading requests across many hosts to bypass limits
            checkRateLimits(dnsResult.hostname);
            // Resolve and validate output directory (returns real path with symlinks resolved)
            const resolvedOutputDir = resolveOutputDir(params.output_dir);
            const validatedOutputDir = resolvedOutputDir
                ? await validateOutputDir(resolvedOutputDir)
                : undefined;
            // Generate unique separator for this request to prevent response injection
            const metadataSeparator = generateMetadataSeparator();
            const args = buildCurlArgs({
                ...params,
                silent: true,
                dnsResolve: dnsResult,
                metadataSeparator,
            });
            const result = await executeCommand("curl", args, params.timeout * 1000);
            // Parse response using the same unique separator
            const { body, contentType } = parseResponseWithMetadata(result.stdout, metadataSeparator);
            // Process response with filtering and size handling
            const processed = await processResponse(body, {
                url: params.url,
                jqFilter: params.jq_filter,
                maxResultSize: params.max_result_size,
                saveToFile: params.save_to_file,
                contentType,
                outputDir: validatedOutputDir,
            });
            const output = formatResponse(processed.content, result.stderr, result.exitCode, params.include_metadata, { savedToFile: processed.savedToFile, filepath: processed.filepath, message: processed.message });
            return {
                content: [
                    {
                        type: "text",
                        text: output,
                    },
                ],
            };
        }
        catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            const errorMessage = sanitizeErrorMessage(rawMessage, params.include_metadata);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error executing cURL request: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Register the jq_query tool for querying JSON files
    server.registerTool("jq_query", {
        title: "Query JSON File",
        description: `Query an existing JSON file with a jq-like filter expression.

This tool allows you to extract data from saved JSON files without making new HTTP requests.
Useful for:
- Extracting different fields from a large saved response
- Applying multiple queries to the same data
- Processing any local JSON file within allowed directories

Args:
  - filepath (string, required): Path to a JSON file to query
  - jq_filter (string, required): JSON path filter expression
  - max_result_size (number): Max bytes inline (default: 500KB, max: 1MB)
  - save_to_file (boolean): Force save result to file
  - output_dir (string): Custom directory to save result files

Filter Syntax:
  - .key - Get object property
  - .[n] - Get array element at index n (non-negative only, also .n with dot notation)
  - .[n:m] - Array slice from n to m
  - .["key"] - Bracket notation for keys with special chars
  - .name,.email - Multiple comma-separated paths (returns array of values, max 20)
  - Note: Negative indices not supported (unlike real jq)

Security:
  - Only files in these directories can be read:
    1. Our temp directory (files saved by curl_execute)
    2. MCP_CURL_OUTPUT_DIR environment variable path
    3. Current working directory and ALL subdirectories (broad - ensure cwd is safe)
  - Maximum file size: 10MB

Examples:
  - Extract name: { "filepath": "/path/to/response.txt", "jq_filter": ".name" }
  - Multiple fields: { "filepath": "/path/to/data.json", "jq_filter": ".name,.email,.id" }
  - Array slice: { "filepath": "/path/to/list.json", "jq_filter": ".items[0:5]" }`,
        inputSchema: JqQuerySchema,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async (params) => {
        try {
            // Validate file path (security check)
            await validateFilePath(params.filepath);
            // Resolve and validate output directory if saving (returns real path with symlinks resolved)
            const resolvedOutputDir = resolveOutputDir(params.output_dir);
            const validatedOutputDir = resolvedOutputDir
                ? await validateOutputDir(resolvedOutputDir)
                : undefined;
            // Read the file
            const content = await readFile(resolve(params.filepath), { encoding: "utf-8" });
            // Apply jq filter
            const filtered = applyJqFilter(content, params.jq_filter);
            // Handle result size and file saving
            const maxSize = params.max_result_size ?? DEFAULT_MAX_RESULT_SIZE;
            const contentBytes = Buffer.byteLength(filtered, "utf8");
            const shouldSave = params.save_to_file || contentBytes > maxSize;
            if (shouldSave) {
                // Generate a filename based on the source file
                const sourceBasename = basename(params.filepath) || "query_result";
                const safeName = createSafeFilenameBase(sourceBasename, "query_result");
                const filename = `${safeName}_${Date.now()}.txt`;
                const targetDir = validatedOutputDir ?? await getOrCreateTempDir();
                const filepath = join(targetDir, filename);
                await writeFile(filepath, filtered, { encoding: "utf-8", mode: 0o600 });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Result (${contentBytes} bytes) saved to: ${filepath}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: filtered,
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error querying JSON file: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Register documentation resource
    server.registerResource("documentation", "curl://docs/api", {
        title: "cURL MCP Server Documentation",
        description: "API documentation and usage examples for the cURL MCP server",
        mimeType: "text/markdown",
    }, async () => ({
        contents: [{
                uri: "curl://docs/api",
                mimeType: "text/markdown",
                text: `# cURL MCP Server API

## Tool: curl_execute

Execute HTTP requests with structured, validated parameters.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | Yes | - | The URL to request |
| method | string | No | GET | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| headers | object | No | - | HTTP headers as key-value pairs |
| data | string | No | - | Request body data |
| form | object | No | - | Form data as key-value pairs |
| timeout | number | No | 30 | Request timeout in seconds (1-300) |
| bearer_token | string | No | - | Bearer token for Authorization |
| basic_auth | string | No | - | Basic auth as "username:password" |
| follow_redirects | boolean | No | true | Follow HTTP redirects |
| include_headers | boolean | No | false | Include response headers |
| include_metadata | boolean | No | false | Return JSON with metadata |
| jq_filter | string | No | - | JSON path filter (e.g., ".data.items[0]") |
| max_result_size | number | No | 500KB | Max bytes inline before auto-save (max: 1MB) |
| save_to_file | boolean | No | false | Force save response to temp file |
| output_dir | string | No | - | Custom directory for saved files (overrides MCP_CURL_OUTPUT_DIR) |

### Large Response Handling

Responses larger than \`max_result_size\` (default: 500KB) are automatically saved to a file.
Files are saved to (in priority order):
1. \`output_dir\` parameter if provided
2. \`MCP_CURL_OUTPUT_DIR\` environment variable if set
3. System temp directory (cleaned up on shutdown)

### jq_filter Syntax

Extract data from JSON responses:
- \`.key\` - Get object property
- \`.[n]\` or \`.n\` - Get array element at index n (non-negative only)
- \`.[n:m]\` - Array slice from n to m
- \`.["key"]\` - Bracket notation for keys with special chars
- \`.name,.email\` - Multiple comma-separated paths (returns array of values, max 20)

**Validation:**
- Unclosed quotes and unmatched brackets throw clear errors
- Leading zeros in indices are rejected (use \`.0\` not \`.00\`)
- Negative indices are not supported (unlike real \`jq\`)
- Indices must be within JavaScript safe integer range

### Examples

**Simple GET request:**
\`\`\`json
{ "url": "https://api.github.com/users/octocat" }
\`\`\`

**Extract multiple fields:**
\`\`\`json
{
  "url": "https://api.github.com/users/octocat",
  "jq_filter": ".name,.email,.location"
}
\`\`\`

**Using dot notation for arrays:**
\`\`\`json
{
  "url": "https://api.example.com/items",
  "jq_filter": ".results.0.name"
}
\`\`\`

**Save to custom directory:**
\`\`\`json
{
  "url": "https://api.example.com/large",
  "save_to_file": true,
  "output_dir": "/path/to/accessible/dir"
}
\`\`\`

## Tool: jq_query

Query existing JSON files with jq_filter without making new HTTP requests.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filepath | string | Yes | Path to JSON file (must be in allowed directory) |
| jq_filter | string | Yes | JSON path filter expression |
| max_result_size | number | No | Max bytes inline (default: 500KB) |
| save_to_file | boolean | No | Force save result to file |
| output_dir | string | No | Directory for saved result files |

### Security

Files can only be read from:
- Our temp directory (files saved by curl_execute)
- MCP_CURL_OUTPUT_DIR path
- Current working directory and all subdirectories

**Note:** The cwd permission is broad. Ensure the server's working directory doesn't contain sensitive files.

### Example

\`\`\`json
{
  "filepath": "/path/to/saved_response.txt",
  "jq_filter": ".users[0:5].name"
}
\`\`\`

## Security

### Network Protection
- **SSRF Prevention**: Blocks private IPs, IPv4-mapped IPv6, internal TLDs
- **DNS Rebinding Prevention**: DNS resolved before validation, cURL pinned via \`--resolve\`
- **Protocol Whitelist**: Only http:// and https:// allowed
- **Localhost**: Blocked by default (set MCP_CURL_ALLOW_LOCALHOST=true with port restrictions)

### Rate Limits
- Per-hostname: 60 requests/minute
- Per-client: 300 requests/minute total

### Resource Limits
- Max response for processing: 10MB
- Max inline result: 1MB (default 500KB)
- Global memory limit: 100MB across concurrent requests
- JQ parsing timeout: 100ms
- Request timeout: 30 seconds (configurable up to 300s)

### File Security
- Symlinks resolved via realpath() before validation
- Path traversal (\`..\`) blocked
- jq_query restricted to temp dir, MCP_CURL_OUTPUT_DIR, and cwd

## Common Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 6 | Could not resolve host |
| 7 | Failed to connect |
| 28 | Operation timeout |
| 35 | SSL connect error |
| 52 | Empty reply from server |
`,
            }],
    }));
    // Register API testing prompt
    server.registerPrompt("api-test", {
        title: "API Testing",
        description: "Test an API endpoint and analyze the response",
        argsSchema: {
            url: z.string().describe("The API endpoint URL to test"),
            method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
            description: z.string().optional().describe("What this API endpoint does"),
        },
    }, ({ url, method = "GET", description }) => ({
        messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Test the following API endpoint:

URL: ${url}
Method: ${method}
${description ? `Description: ${description}` : ""}

Please:
1. Make the request using curl_execute
2. Analyze the response structure
3. Report the status and any errors
4. Summarize what the response contains`,
                },
            }],
    }));
    // Register API discovery prompt
    server.registerPrompt("api-discovery", {
        title: "REST API Discovery",
        description: "Explore a REST API to discover available endpoints",
        argsSchema: {
            base_url: z.string().describe("Base URL of the API"),
            auth_token: z.string().optional().describe("Optional bearer token for authentication"),
        },
    }, ({ base_url, auth_token }) => ({
        messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Explore the REST API at: ${base_url}

${auth_token ? `Use bearer token for authentication: ${auth_token}` : "No authentication token provided."}

Please:
1. Try common discovery endpoints (/api, /api/v1, /health, /swagger.json, /openapi.json)
2. Check for available methods using OPTIONS requests
3. Look for API documentation endpoints
4. Report what you discover about the API structure`,
                },
            }],
    }));
}
// HTTP server reference for graceful shutdown
let httpServer = null;
// Graceful shutdown handler
async function shutdown(signal) {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    // Close HTTP server if running
    if (httpServer) {
        await new Promise((resolve, reject) => {
            httpServer.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    // Close all active sessions
    for (const [sessionId, session] of sessions) {
        try {
            session.transport.close();
            await session.server.close();
        }
        catch {
            // Ignore errors during shutdown
        }
        sessions.delete(sessionId);
    }
    // Clean up temp directory
    if (sharedTempDir) {
        try {
            await rm(sharedTempDir, { recursive: true, force: true });
        }
        catch {
            // Ignore errors during cleanup
        }
    }
    process.exit(0);
}
// Register shutdown handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
// Run with stdio transport (default)
async function runStdio() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    const server = createServer();
    registerToolsAndResources(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("cURL MCP server running on stdio");
}
// Environment variable for HTTP authentication token (opt-in security)
const HTTP_AUTH_TOKEN_ENV_VAR = "MCP_AUTH_TOKEN";
/**
 * Authentication middleware for HTTP transport.
 *
 * When MCP_AUTH_TOKEN is set, all HTTP requests must include a matching
 * Bearer token in the Authorization header. This prevents unauthorized
 * clients from accessing the MCP server when running in HTTP mode.
 *
 * Usage: Set MCP_AUTH_TOKEN=your-secret-token in the environment.
 */
function createAuthMiddleware() {
    const authToken = process.env[HTTP_AUTH_TOKEN_ENV_VAR];
    return (req, res, next) => {
        // If no token configured, allow all requests (backward compatible)
        if (!authToken) {
            next();
            return;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${authToken}`) {
            res.status(401).json({
                jsonrpc: "2.0",
                error: {
                    code: -32600,
                    message: "Unauthorized: Invalid or missing authentication token",
                },
            });
            return;
        }
        next();
    };
}
// Run with HTTP transport
async function runHTTP() {
    // Clean up orphaned temp directories from previous runs
    await cleanupOrphanedTempDirs();
    const app = express();
    // Limit request body size to prevent DoS
    app.use(express.json({ limit: "1mb" }));
    // Apply authentication middleware to all /mcp routes when token is configured
    const authMiddleware = createAuthMiddleware();
    app.use("/mcp", authMiddleware);
    // POST /mcp - Handle MCP requests
    app.post("/mcp", async (req, res) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            // Validate session ID format if provided
            if (sessionId && !isValidSessionId(sessionId)) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid session ID format" },
                });
                return;
            }
            // Check for existing session
            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId);
                session.lastActivity = Date.now(); // Update activity timestamp
                await session.transport.handleRequest(req, res, req.body);
                return;
            }
            // Check session limit before creating new session
            if (sessions.size >= MAX_SESSIONS) {
                res.status(503).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Server at capacity. Try again later." },
                });
                return;
            }
            // Create new session
            const server = createServer();
            registerToolsAndResources(server);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
            });
            // Track session when initialized
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && sessions.has(sid)) {
                    sessions.delete(sid);
                }
            };
            await server.connect(transport);
            // Store session after connection
            if (transport.sessionId) {
                sessions.set(transport.sessionId, {
                    server,
                    transport,
                    lastActivity: Date.now(),
                });
            }
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error("MCP request error:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                });
            }
        }
    });
    // GET /mcp - Handle SSE streams for existing sessions
    app.get("/mcp", async (req, res, next) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            if (!isValidSessionId(sessionId)) {
                res.status(400).json({ error: "Invalid or missing session ID" });
                return;
            }
            if (!sessions.has(sessionId)) {
                res.status(400).json({ error: "Session not found" });
                return;
            }
            const session = sessions.get(sessionId);
            session.lastActivity = Date.now(); // Update activity timestamp
            await session.transport.handleRequest(req, res);
        }
        catch (error) {
            next(error);
        }
    });
    // DELETE /mcp - Terminate a session
    app.delete("/mcp", async (req, res, next) => {
        const sessionId = req.headers["mcp-session-id"];
        if (isValidSessionId(sessionId) && sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            try {
                session.transport.close();
                await session.server.close();
            }
            catch (error) {
                next(error);
                return;
            }
            finally {
                sessions.delete(sessionId);
            }
        }
        res.status(200).end();
    });
    // Global error handler
    app.use((err, _req, res, _next) => {
        console.error("Unhandled error:", err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
            });
        }
    });
    const port = parseInt(process.env.PORT || "3000");
    httpServer = app.listen(port, () => {
        console.error(`cURL MCP server running on http://localhost:${port}/mcp`);
    });
}
// Main entry point
const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "http") {
    runHTTP().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
else {
    runStdio().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
