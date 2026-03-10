// src/lib/server/schemas.ts
import { z } from "zod";
var CurlExecuteSchema = z.object({
  url: z.string().url("Must be a valid URL").refine(
    (url) => {
      const scheme = url.split(":")[0].toLowerCase();
      return ["http", "https"].includes(scheme);
    },
    { message: "URL must use http or https scheme" }
  ).describe("The URL to request"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional().describe("HTTP method (defaults to GET, or POST if data is provided)"),
  headers: z.record(z.string()).optional().describe('HTTP headers as key-value pairs (e.g., {"Content-Type": "application/json"})'),
  data: z.string().optional().describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
  form: z.record(z.string()).optional().describe("Form data as key-value pairs (uses multipart/form-data)"),
  follow_redirects: z.boolean().default(true).describe("Follow HTTP redirects (default: true)"),
  max_redirects: z.number().int().min(0).max(50).optional().describe("Maximum number of redirects to follow"),
  insecure: z.boolean().default(false).describe("Skip SSL certificate verification (default: false)"),
  /**
   * Request timeout in seconds.
   * Optional - if not provided, defaults are applied in this order:
   * 1. McpCurlConfig.defaultTimeout (if configured)
   * 2. LIMITS.DEFAULT_TIMEOUT_MS / 1000 (30 seconds)
   *
   * Note: This field intentionally has no .default() to distinguish between
   * "user explicitly passed 30" vs "user didn't provide a value".
   */
  timeout: z.number().int().min(1).max(300).optional().describe("Request timeout in seconds (default: 30, max: 300)"),
  user_agent: z.string().optional().describe("Custom User-Agent header. If not set, a browser-like User-Agent is sent automatically. Set to empty string to disable."),
  basic_auth: z.string().optional().describe("Basic authentication in format 'username:password'"),
  bearer_token: z.string().optional().describe("Bearer token for Authorization header"),
  verbose: z.boolean().default(false).describe("Include verbose output with request/response details"),
  include_headers: z.boolean().default(false).describe("Include response headers in output"),
  compressed: z.boolean().default(true).describe("Request compressed response and automatically decompress"),
  include_metadata: z.boolean().default(false).describe("Wrap response in JSON with metadata (exit code, success status)"),
  jq_filter: z.string().optional().describe('JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .["key"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check.'),
  max_result_size: z.number().int().min(1e3).max(1e6).optional().describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
  save_to_file: z.boolean().optional().describe("Force save response to temp file. Returns filepath instead of content"),
  output_dir: z.string().optional().describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory.")
});
var JqQuerySchema = z.object({
  filepath: z.string().describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
  jq_filter: z.string().describe('JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .["key"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported.'),
  max_result_size: z.number().int().min(1e3).max(1e6).optional().describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
  save_to_file: z.boolean().optional().describe("Force save result to file. Returns filepath instead of content"),
  output_dir: z.string().optional().describe("Directory to save result files (must exist and be writable)")
});

// src/lib/config/limits.ts
var BYTES_PER_MB = 1e6;
var LIMITS = {
  /** Maximum response size for processing (10MB) */
  MAX_RESPONSE_SIZE: 1e7,
  /** Default max result size for AI agent responses (500KB) */
  DEFAULT_MAX_RESULT_SIZE: 5e5,
  /** Maximum total memory across all concurrent requests (100MB) */
  MAX_TOTAL_RESPONSE_MEMORY: 1e8,
  /** Characters to show in error previews */
  ERROR_PREVIEW_LENGTH: 200,
  /** Max distance from end to search for metadata separator */
  MAX_METADATA_TAIL_LENGTH: 200,
  /** Default request timeout in milliseconds (30 seconds) */
  DEFAULT_TIMEOUT_MS: 3e4,
  /** Maximum filename length for saved files */
  FILENAME_MAX_LENGTH: 50,
  /** Default HTTP transport port */
  DEFAULT_HTTP_PORT: 3e3,
  /** Default maximum number of redirects to follow */
  MAX_REDIRECTS: 10
};
function parsePort(value, defaultPort) {
  const raw = value || String(defaultPort);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid port value: ${value ?? "(empty)"}`);
  }
  const port = parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port value: ${value ?? "(empty)"}`);
  }
  return port;
}

// src/lib/config/server.ts
var SERVER = {
  /** MCP server name for protocol identification */
  NAME: "curl-mcp-server",
  /** Server version from package.json */
  VERSION: true ? "2.0.1" : "0.0.0"
};

// src/lib/config/session.ts
var SESSION = {
  /** Maximum concurrent HTTP sessions */
  MAX_SESSIONS: 100,
  /** Session idle timeout (1 hour) */
  IDLE_TIMEOUT_MS: 36e5,
  /** Interval for cleaning up idle sessions (5 minutes) */
  CLEANUP_INTERVAL_MS: 3e5
};
var RATE_LIMIT = {
  /** Maximum requests per host per minute */
  MAX_PER_HOST_PER_MINUTE: 60,
  /** Maximum requests per client per minute */
  MAX_PER_CLIENT_PER_MINUTE: 300,
  /** Rate limit window duration (1 minute) */
  WINDOW_MS: 6e4,
  /** Interval for cleaning up expired rate limit entries (10 seconds) */
  CLEANUP_INTERVAL_MS: 1e4,
  /** Client ID used for stdio transport */
  STDIO_CLIENT_ID: "__stdio_client__"
};
var TEMP_DIR = {
  /** Prefix for temp directories */
  PREFIX: "mcp-curl-",
  /** Minimum age before orphaned temp dirs are cleaned (1 hour) */
  ORPHAN_MIN_AGE_MS: 36e5,
  /** Backoff period before retrying temp directory creation after failure (1 second) */
  RETRY_BACKOFF_MS: 1e3
};

// src/lib/config/jq.ts
var JQ = {
  /** Maximum jq_filter string length */
  MAX_FILTER_LENGTH: 500,
  /** Maximum tokens in a single filter */
  MAX_TOKENS: 50,
  /** Maximum comma-separated filters */
  MAX_FILTERS: 20,
  /** Parsing timeout to prevent ReDoS (100ms) */
  MAX_PARSE_TIME_MS: 100,
  /** Maximum file size for jq_query tool (same as response limit) */
  MAX_QUERY_FILE_SIZE: LIMITS.MAX_RESPONSE_SIZE,
  /** TTL for allowed directories cache in file validation (1 minute) */
  ALLOWED_DIRS_CACHE_TTL_MS: 6e4
};

// src/lib/config/environment.ts
var ENV = {
  /** Directory for saving response files */
  OUTPUT_DIR: "MCP_CURL_OUTPUT_DIR",
  /** Enable localhost requests for development */
  ALLOW_LOCALHOST: "MCP_CURL_ALLOW_LOCALHOST",
  /** Bearer token for HTTP transport authentication */
  AUTH_TOKEN: "MCP_AUTH_TOKEN",
  /** Comma-separated allowed origins for HTTP transport (default: localhost) */
  ALLOWED_ORIGINS: "MCP_CURL_ALLOWED_ORIGINS",
  /** HTTP transport bind address (default: 127.0.0.1) */
  HOST: "MCP_CURL_HOST",
  /** HTTP transport port (default: 3000) */
  PORT: "PORT",
  /** Override default User-Agent header (empty string disables) */
  USER_AGENT: "MCP_CURL_USER_AGENT",
  /** Override default Referer header (empty string disables) */
  REFERER: "MCP_CURL_REFERER"
};

// src/lib/config/defaults.ts
var DEFAULT_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 mcp-curl/${SERVER.VERSION}`;
var DEFAULT_REFERER = "";
function resolveDefault(configValue, envVar, builtInDefault) {
  if (configValue !== void 0) return configValue || void 0;
  const envValue = process.env[envVar];
  if (envValue !== void 0) return envValue || void 0;
  return builtInDefault || void 0;
}
var hasHeaderKey = (obj, key) => Object.keys(obj).some((k) => k.toLowerCase() === key.toLowerCase());
function applyDefaultHeaders(headers, userAgent, config) {
  const result = { ...headers };
  let resolvedUA = userAgent;
  if (resolvedUA === void 0 && !hasHeaderKey(result, "User-Agent")) {
    resolvedUA = resolveDefault(config?.defaultUserAgent, ENV.USER_AGENT, DEFAULT_USER_AGENT);
  }
  if (!hasHeaderKey(result, "Referer")) {
    const referer = resolveDefault(config?.defaultReferer, ENV.REFERER, DEFAULT_REFERER);
    if (referer) result["Referer"] = referer;
  }
  return { headers: result, userAgent: resolvedUA };
}

// src/lib/config/security/ssrf.ts
var BLOCKED_HOSTNAME_PATTERNS_INTERNAL = Object.freeze([
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
  // IPv6 unique local (fc00::/7 covers fc00::/8 and fd00::/8)
  /^\[?fc[0-9a-f]{2}:/i,
  // fc00::/8 prefix (fcxx::, not yet assigned by IANA)
  /^\[?fd[0-9a-f]{2}:/i,
  // fd00::/8 prefix (fdxx::, locally assigned)
  // Internal TLDs
  /\.local$/i,
  /\.internal$/i,
  /\.corp$/i,
  /\.lan$/i,
  /\.localhost$/i,
  // Cloud metadata service hostnames (defense-in-depth; IPs already blocked via link-local)
  // AWS EC2 metadata
  /^instance-data\.ec2\.internal$/i,
  // GCP metadata
  /^metadata\.google\.internal$/i,
  // Azure metadata (uses 169.254.169.254 with special header, but block hostname too)
  /^metadata\.azure\.com$/i,
  // Generic metadata hostname pattern (catches metadata.* on internal TLDs already blocked above,
  // but this also catches bare "metadata" hostname without TLD)
  /^metadata$/i,
  // DNS rebinding services that can map any hostname to any IP (e.g., 169.254.169.254)
  /\.nip\.io$/i,
  /\.sslip\.io$/i,
  /\.xip\.io$/i,
  // Windows UNC paths (limit to reasonable hostname length to prevent scanning long strings)
  /^\\\\[^\\]{1,255}/
]);
function isBlockedHostname(hostname) {
  return BLOCKED_HOSTNAME_PATTERNS_INTERNAL.some((pattern) => pattern.test(hostname));
}
var LOCALHOST_HOSTNAME_PATTERNS_INTERNAL = Object.freeze([
  /^localhost$/i
]);
function isLocalhostHostname(hostname) {
  return LOCALHOST_HOSTNAME_PATTERNS_INTERNAL.some((pattern) => pattern.test(hostname));
}
var BLOCKED_IP_PATTERNS_INTERNAL = Object.freeze([
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:0\.0\.0\.0$/i
]);
function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS_INTERNAL.some((pattern) => pattern.test(ip));
}
var LOCALHOST_IP_PATTERNS_INTERNAL = Object.freeze([
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^::ffff:127\./i
]);
function isLocalhostIp(ip) {
  return LOCALHOST_IP_PATTERNS_INTERNAL.some((pattern) => pattern.test(ip));
}
var ALLOWED_LOCALHOST_PORTS_INTERNAL = Object.freeze(
  /* @__PURE__ */ new Set([80, 443])
);
var MIN_UNPRIVILEGED_PORT = 1024;
function isAllowedLocalhostPort(port) {
  return ALLOWED_LOCALHOST_PORTS_INTERNAL.has(port) || port > MIN_UNPRIVILEGED_PORT;
}

// src/lib/config/security/validation.ts
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var WINDOWS_RESERVED_BASENAMES_SET = Object.freeze(
  /* @__PURE__ */ new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9"
  ])
);
var WINDOWS_RESERVED_BASENAMES = Object.freeze(
  Array.from(WINDOWS_RESERVED_BASENAMES_SET)
);
function isWindowsReservedBasename(name) {
  return WINDOWS_RESERVED_BASENAMES_SET.has(name.toUpperCase());
}

// src/lib/config/security/blocked-dirs.ts
var LINUX_BLOCKED_DIRS = Object.freeze([
  "/etc",
  "/sys",
  "/proc",
  "/dev",
  "/boot",
  "/root",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/lib",
  "/lib64",
  "/var/run",
  "/run"
]);
var MACOS_BLOCKED_DIRS = Object.freeze([
  "/System",
  "/Library",
  "/private/etc",
  "/private/var",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/cores"
]);
var MACOS_ROOT_ONLY_BLOCKED = Object.freeze([
  "/Volumes"
]);
var WINDOWS_BLOCKED_PATTERNS = Object.freeze([
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files(\\|$)/i,
  /^[a-z]:\\program files \(x86\)(\\|$)/i,
  /^[a-z]:\\programdata(\\|$)/i
]);
function startsWithBlockedPrefix(path, blockedDirs) {
  for (const blocked of blockedDirs) {
    if (path === blocked) {
      return true;
    }
    if (path.startsWith(blocked + "/")) {
      return true;
    }
  }
  return false;
}
function isExactRootOnlyMatch(path, rootOnlyDirs) {
  const normalized = path.replace(/\/+$/, "");
  return rootOnlyDirs.includes(normalized);
}
function isBlockedSystemDirectory(resolvedPath) {
  const platform = process.platform;
  if (platform === "win32") {
    const normalizedPath = resolvedPath.replace(/\//g, "\\");
    for (const pattern of WINDOWS_BLOCKED_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return true;
      }
    }
    return false;
  }
  if (platform === "darwin") {
    if (startsWithBlockedPrefix(resolvedPath, MACOS_BLOCKED_DIRS)) {
      return true;
    }
    if (isExactRootOnlyMatch(resolvedPath, MACOS_ROOT_ONLY_BLOCKED)) {
      return true;
    }
  }
  if (startsWithBlockedPrefix(resolvedPath, LINUX_BLOCKED_DIRS)) {
    return true;
  }
  return false;
}
function createBlockedDirectoryError(originalPath, resolvedPath) {
  const pathInfo = originalPath === resolvedPath ? `"${originalPath}"` : `"${originalPath}" (resolves to "${resolvedPath}")`;
  return new Error(
    `Invalid output_dir ${pathInfo}: writing to system directories is not allowed. Please choose a user-writable directory like ~/downloads or a project directory.`
  );
}

// src/lib/types/common.ts
import { randomUUID } from "crypto";
function generateMetadataSeparator() {
  return `
---MCP-CURL-${randomUUID()}---
`;
}

// src/lib/files/temp-manager.ts
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, chmod, rm, readdir, stat } from "fs/promises";
var sharedTempDir = null;
var tempDirPromise = null;
var lastFailureTime = 0;
async function getOrCreateTempDir() {
  if (tempDirPromise) {
    return tempDirPromise;
  }
  const now = Date.now();
  if (lastFailureTime && now - lastFailureTime < TEMP_DIR.RETRY_BACKOFF_MS) {
    const waitMs = TEMP_DIR.RETRY_BACKOFF_MS - (now - lastFailureTime);
    throw new Error(
      `Temp directory creation failed recently. Retry in ${waitMs}ms.`
    );
  }
  tempDirPromise = (async () => {
    let dir = null;
    try {
      dir = await mkdtemp(join(tmpdir(), TEMP_DIR.PREFIX));
      await chmod(dir, 448);
      sharedTempDir = dir;
      lastFailureTime = 0;
      return dir;
    } catch (error) {
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn("Failed to cleanup temp directory after chmod failure:", cleanupError);
        }
      }
      lastFailureTime = Date.now();
      tempDirPromise = null;
      throw error;
    }
  })();
  return tempDirPromise;
}
function getSharedTempDir() {
  return sharedTempDir;
}
async function cleanupOrphanedTempDirs() {
  try {
    const tempBase = tmpdir();
    const entries = await readdir(tempBase);
    const now = Date.now();
    for (const entry of entries) {
      if (entry.startsWith(TEMP_DIR.PREFIX)) {
        const dirPath = join(tempBase, entry);
        if (dirPath === sharedTempDir) continue;
        try {
          const stats = await stat(dirPath);
          const ageMs = now - stats.mtimeMs;
          if (ageMs < TEMP_DIR.ORPHAN_MIN_AGE_MS) {
            continue;
          }
          await rm(dirPath, { recursive: true, force: true });
        } catch (error) {
          const errno = error.code;
          if (errno !== "ENOENT" && errno !== "EBUSY") {
            console.error(`Unexpected error cleaning orphaned temp dir ${dirPath}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error during orphaned temp dir cleanup:", error);
  }
}
async function cleanupTempDir() {
  if (sharedTempDir) {
    try {
      await rm(sharedTempDir, { recursive: true, force: true });
    } catch (error) {
      const errno = error.code;
      if (errno === "ENOENT") {
      } else if (errno === "EBUSY" || errno === "EPERM" || errno === "EACCES") {
        console.error(`Security warning: Failed to clean temp directory (${errno}):`, sharedTempDir, error);
      } else {
        console.error("Warning: Failed to clean up temp directory:", error);
      }
    } finally {
      sharedTempDir = null;
      tempDirPromise = null;
    }
  }
  lastFailureTime = 0;
}

// src/lib/files/output-dir.ts
import { resolve } from "path";
import { stat as stat2, access, realpath, constants as fsConstants } from "fs/promises";

// src/lib/utils/error.ts
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function createValidationError(field, reason, suggestion) {
  let message = `Invalid ${field}: ${reason}.`;
  if (suggestion) {
    message += ` ${suggestion}`;
    if (!suggestion.endsWith(".")) {
      message += ".";
    }
  }
  return new Error(message);
}
function createFileError(filepath, reason) {
  return new Error(`File "${filepath}" ${reason}.`);
}
function createConfigError(configName, value, reason) {
  return new Error(`Invalid ${configName} value "${value}": ${reason}.`);
}

// src/lib/utils/url.ts
function resolveBaseUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

// src/lib/files/output-dir.ts
function resolveOutputDir(paramDir) {
  if (paramDir !== void 0) {
    const trimmedParam = paramDir.trim();
    if (!trimmedParam) {
      throw new Error(
        `Invalid output_dir: value is empty or whitespace-only. Remove it to use the environment variable or temp directory, or provide a valid path.`
      );
    }
    return trimmedParam;
  }
  const rawEnvDir = process.env[ENV.OUTPUT_DIR];
  if (rawEnvDir !== void 0) {
    const envDir = rawEnvDir.trim();
    if (!envDir) {
      throw new Error(
        `Environment variable ${ENV.OUTPUT_DIR} is set but empty or whitespace-only. Unset it or provide a valid directory path.`
      );
    }
    return envDir;
  }
  return null;
}
async function validateOutputDir(dir) {
  const segments = dir.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `Invalid output_dir: path traversal detected. Please provide a direct path without ".." components.`
    );
  }
  const absolutePath = resolve(dir);
  try {
    const stats = await stat2(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(
        `Invalid output_dir "${dir}": path exists but is not a directory`
      );
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Invalid output_dir "${dir}": directory does not exist. Please create it first or use a different path.`
      );
    }
    throw new Error(`Error validating output_dir "${dir}": ${getErrorMessage(error)}`);
  }
  const realPath = await realpath(absolutePath);
  if (isBlockedSystemDirectory(realPath)) {
    throw createBlockedDirectoryError(dir, realPath);
  }
  try {
    await access(realPath, fsConstants.W_OK);
  } catch (error) {
    const errno = error.code;
    let reason = "directory is not writable";
    if (errno === "EROFS") {
      reason = "filesystem is mounted read-only";
    } else if (errno === "EACCES") {
      reason = "permission denied";
    }
    throw new Error(`Invalid output_dir "${dir}": ${reason}`);
  }
  return realPath;
}

// src/lib/security/ssrf.ts
import { lookup } from "dns/promises";
function isLocalhostAllowed(configOverride) {
  if (configOverride !== void 0) {
    return configOverride;
  }
  const value = process.env[ENV.ALLOW_LOCALHOST]?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}
async function resolveDns(hostname) {
  try {
    const result = await lookup(hostname);
    return result.address;
  } catch (error) {
    throw new Error(`DNS resolution failed for "${hostname}": ${getErrorMessage(error)}`);
  }
}
async function validateUrlAndResolveDns(url, options) {
  if (url.toLowerCase().startsWith("file://")) {
    throw new Error("file:// URLs are not allowed - they could be used to read local files");
  }
  if (url.startsWith("\\\\")) {
    throw new Error("UNC paths are not allowed - they could access internal network shares");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL format: ${getErrorMessage(error)}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Protocol "${parsed.protocol}" is not allowed - only http:// and https:// are supported`);
  }
  if (isBlockedHostname(hostname)) {
    throw new Error(
      `Requests to internal/private networks are not allowed: ${hostname}`
    );
  }
  const hostnameIsLocalhost = isLocalhostHostname(hostname);
  const resolvedIp = await resolveDns(hostname);
  const ipIsLocalhost = isLocalhostIp(resolvedIp);
  if (hostnameIsLocalhost || ipIsLocalhost) {
    if (!isLocalhostAllowed(options?.allowLocalhost)) {
      throw new Error(
        `Requests to localhost are blocked by default. Set ${ENV.ALLOW_LOCALHOST}=true to enable local development/testing.` + (ipIsLocalhost && !hostnameIsLocalhost ? ` (Note: "${hostname}" resolved to localhost IP ${resolvedIp})` : "")
      );
    }
    if (!isAllowedLocalhostPort(port)) {
      throw new Error(
        `Localhost requests are restricted to ports 80, 443, and >1024. Port ${port} is not allowed to prevent access to privileged services.`
      );
    }
    return { hostname, port, resolvedIp };
  }
  if (isBlockedIp(resolvedIp)) {
    throw new Error(
      `DNS rebinding attack detected: "${hostname}" resolved to blocked IP ${resolvedIp}. Requests to internal/private networks are not allowed.`
    );
  }
  return { hostname, port, resolvedIp };
}

// src/lib/security/rate-limiter.ts
var hostRateLimitMap = /* @__PURE__ */ new Map();
var clientRateLimitMap = /* @__PURE__ */ new Map();
function cleanupExpiredEntries(map) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.windowStart >= RATE_LIMIT.WINDOW_MS) {
      map.delete(key);
    }
  }
}
function checkRateLimitInternal(map, key, maxRequests, errorPrefix) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT.WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return;
  }
  if (entry.count >= maxRequests) {
    throw new Error(`${errorPrefix}. Maximum ${maxRequests} requests per minute.`);
  }
  entry.count++;
}
function checkRateLimits(hostname, clientId = RATE_LIMIT.STDIO_CLIENT_ID) {
  checkRateLimitInternal(
    hostRateLimitMap,
    hostname,
    RATE_LIMIT.MAX_PER_HOST_PER_MINUTE,
    `Rate limit exceeded for host "${hostname}"`
  );
  checkRateLimitInternal(
    clientRateLimitMap,
    clientId,
    RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE,
    "Client rate limit exceeded"
  );
}
function startRateLimitCleanup() {
  const interval = setInterval(() => {
    cleanupExpiredEntries(hostRateLimitMap);
    cleanupExpiredEntries(clientRateLimitMap);
  }, RATE_LIMIT.CLEANUP_INTERVAL_MS);
  interval.unref();
  return interval;
}
function stopRateLimitCleanup(interval) {
  clearInterval(interval);
}

// src/lib/security/input-validation.ts
import { timingSafeEqual } from "crypto";
function safeStringCompare(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const lengthMatch = bufA.length === bufB.length ? 1 : 0;
  return timingSafeEqual(paddedA, paddedB) && lengthMatch === 1;
}
function isValidSessionId(sessionId) {
  return sessionId !== void 0 && UUID_REGEX.test(sessionId);
}
function validateNoCRLF(value, fieldName) {
  if (value.includes("\r") || value.includes("\n") || value.includes("\0")) {
    throw new Error(
      `Invalid ${fieldName}: contains forbidden characters (CR, LF, or null byte). This could enable header injection attacks.`
    );
  }
}

// src/lib/security/file-validation.ts
import { resolve as resolve2, relative, isAbsolute } from "path";
import { stat as stat3, access as access2, realpath as realpath2, constants as fsConstants2 } from "fs/promises";
var allowedDirsCache = null;
async function resolveSharedTempDirSafely() {
  const tempDir = getSharedTempDir();
  if (!tempDir) return null;
  try {
    return await realpath2(tempDir);
  } catch (error) {
    const errno = error.code;
    if (errno !== "ENOENT") {
      console.error(
        `Warning: Failed to resolve temp directory "${tempDir}" (${errno}):`,
        error
      );
    }
    return null;
  }
}
async function getAllowedDirectories() {
  const now = Date.now();
  if (allowedDirsCache && now - allowedDirsCache.timestamp < JQ.ALLOWED_DIRS_CACHE_TTL_MS) {
    const dirs2 = [];
    const resolvedTempDir2 = await resolveSharedTempDirSafely();
    if (resolvedTempDir2) {
      dirs2.push(resolvedTempDir2);
    }
    if (allowedDirsCache.envOutputDir) {
      dirs2.push(allowedDirsCache.envOutputDir);
    }
    dirs2.push(allowedDirsCache.cwd);
    return dirs2;
  }
  let envOutputDirResolved = null;
  const envOutputDir = process.env[ENV.OUTPUT_DIR];
  if (envOutputDir) {
    try {
      const realEnvDir = await realpath2(resolve2(envOutputDir));
      const envDirStats = await stat3(realEnvDir);
      if (!envDirStats.isDirectory()) {
        throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, "path exists but is not a directory");
      }
      envOutputDirResolved = realEnvDir;
    } catch (error) {
      if (error.code === "ENOENT") {
        throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, "directory does not exist");
      }
      throw createConfigError(ENV.OUTPUT_DIR, envOutputDir, getErrorMessage(error));
    }
  }
  let cwdResolved;
  try {
    cwdResolved = await realpath2(process.cwd());
  } catch (error) {
    throw new Error(
      `Failed to resolve current working directory: ${getErrorMessage(error)}. This is required for secure file validation.`
    );
  }
  allowedDirsCache = {
    envOutputDir: envOutputDirResolved,
    cwd: cwdResolved,
    timestamp: now
  };
  const dirs = [];
  const resolvedTempDir = await resolveSharedTempDirSafely();
  if (resolvedTempDir) {
    dirs.push(resolvedTempDir);
  }
  if (envOutputDirResolved) {
    dirs.push(envOutputDirResolved);
  }
  dirs.push(cwdResolved);
  return dirs;
}
async function validateFilePath(filepath) {
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(filepath)) {
    throw createValidationError(
      "filepath",
      "path traversal detected",
      "Please provide a direct path without '..' components"
    );
  }
  const absolutePath = resolve2(filepath);
  let realFilePath;
  try {
    realFilePath = await realpath2(absolutePath);
    const stats = await stat3(realFilePath);
    if (!stats.isFile()) {
      throw new Error(`Invalid filepath "${filepath}": path exists but is not a file`);
    }
    if (stats.size > JQ.MAX_QUERY_FILE_SIZE) {
      throw new Error(
        `File "${filepath}" is too large (${stats.size} bytes). Maximum file size for jq_query is ${JQ.MAX_QUERY_FILE_SIZE / BYTES_PER_MB}MB.`
      );
    }
  } catch (error) {
    const errno = error.code;
    if (errno === "ENOENT") {
      throw createFileError(filepath, "does not exist");
    }
    if (error instanceof Error && !errno) {
      throw error;
    }
    throw new Error(`Error validating file "${filepath}": ${getErrorMessage(error)}`);
  }
  try {
    await access2(realFilePath, fsConstants2.R_OK);
  } catch (error) {
    const errno = error.code;
    throw createFileError(filepath, `is not readable (${errno || "unknown error"})`);
  }
  const allowedDirs = await getAllowedDirectories();
  const isInAllowedDir = allowedDirs.some((dir) => {
    const rel = relative(dir, realFilePath);
    return !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!isInAllowedDir) {
    throw new Error(
      `Access denied: file "${filepath}" is not in an allowed directory. Allowed directories: temp directory, MCP_CURL_OUTPUT_DIR, and current working directory.`
    );
  }
  return realFilePath;
}

// src/lib/execution/command-executor.ts
import { spawn } from "child_process";

// src/lib/execution/memory-tracker.ts
var totalResponseMemory = 0;
function allocateMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return false;
  }
  const newTotal = totalResponseMemory + bytes;
  if (newTotal > LIMITS.MAX_TOTAL_RESPONSE_MEMORY) {
    return false;
  }
  totalResponseMemory = newTotal;
  return true;
}
function releaseMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return;
  }
  totalResponseMemory -= bytes;
  if (totalResponseMemory < 0) {
    totalResponseMemory = 0;
  }
}

// src/lib/execution/command-executor.ts
var ALLOWED_COMMANDS = ["curl"];
async function executeCommand(command, args, timeout = LIMITS.DEFAULT_TIMEOUT_MS) {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(`Command not allowed: ${command}. Only ${ALLOWED_COMMANDS.join(", ")} can be executed.`);
  }
  if (!Number.isFinite(timeout) || timeout <= 0) {
    timeout = LIMITS.DEFAULT_TIMEOUT_MS;
  }
  let requestMemoryUsage = 0;
  return new Promise((resolve4, reject) => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);
    const childProcess = spawn(command, args, {
      signal: abortController.signal
    });
    let stdout = "";
    let stderr = "";
    let stderrMemoryUsage = 0;
    let killed = false;
    const releaseRequestMemory = () => {
      releaseMemory(requestMemoryUsage);
      requestMemoryUsage = 0;
    };
    childProcess.stdout?.on("data", (data) => {
      if (killed) return;
      const dataSize = data.length;
      if (!allocateMemory(dataSize)) {
        killed = true;
        clearTimeout(timeoutId);
        releaseRequestMemory();
        childProcess.kill();
        reject(new Error(
          "Server memory limit reached due to concurrent requests. Please try again later."
        ));
        return;
      }
      stdout += data.toString();
      requestMemoryUsage += dataSize;
      if (requestMemoryUsage > LIMITS.MAX_RESPONSE_SIZE) {
        killed = true;
        clearTimeout(timeoutId);
        releaseRequestMemory();
        childProcess.kill();
        reject(new Error(
          `Response exceeded maximum processing size of ${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. Consider using a more specific API endpoint or adding query parameters to reduce response size.`
        ));
      }
    });
    childProcess.stderr?.on("data", (data) => {
      if (killed) return;
      const dataSize = data.length;
      if (!allocateMemory(dataSize)) {
        killed = true;
        clearTimeout(timeoutId);
        releaseRequestMemory();
        childProcess.kill();
        reject(new Error(
          "Server memory limit reached due to concurrent requests. Please try again later."
        ));
        return;
      }
      requestMemoryUsage += dataSize;
      if (requestMemoryUsage > LIMITS.MAX_RESPONSE_SIZE) {
        killed = true;
        clearTimeout(timeoutId);
        releaseRequestMemory();
        childProcess.kill();
        reject(new Error(
          `Response exceeded maximum processing size of ${LIMITS.MAX_RESPONSE_SIZE / BYTES_PER_MB}MB. Consider using a more specific API endpoint or adding query parameters to reduce response size.`
        ));
        return;
      }
      if (stderrMemoryUsage < LIMITS.MAX_RESPONSE_SIZE) {
        const dataStr = data.toString();
        stderr += dataStr;
        stderrMemoryUsage += dataSize;
        if (stderrMemoryUsage > LIMITS.MAX_RESPONSE_SIZE) {
          const truncateMsg = "\n[stderr truncated]";
          const maxBytes = LIMITS.MAX_RESPONSE_SIZE - Buffer.byteLength(truncateMsg, "utf8");
          const buf = Buffer.from(stderr, "utf8").subarray(0, maxBytes);
          stderr = buf.toString("utf8") + truncateMsg;
          stderrMemoryUsage = Buffer.byteLength(stderr, "utf8");
        }
      }
    });
    childProcess.on("close", (code, signal) => {
      clearTimeout(timeoutId);
      releaseRequestMemory();
      if (!killed) {
        resolve4({
          stdout,
          stderr,
          // null code means process was killed by signal — report as failure (not 0)
          exitCode: code ?? (signal ? 1 : 0)
        });
      }
    });
    childProcess.on("error", (error) => {
      clearTimeout(timeoutId);
      releaseRequestMemory();
      if (error.name === "AbortError") {
        reject(new Error(
          `Request timed out after ${timeout / 1e3} seconds. The server may be slow or unresponsive.`
        ));
      } else {
        reject(error);
      }
    });
  });
}

// src/lib/execution/curl-args-builder.ts
function buildCurlArgs(params) {
  const args = [];
  args.push("--proto", "=http,https");
  if (params.method) {
    args.push("-X", params.method.toUpperCase());
  }
  if (params.headers) {
    for (const [key, value] of Object.entries(params.headers)) {
      validateNoCRLF(key, "header name");
      validateNoCRLF(value, `header value for "${key}"`);
      args.push("-H", `${key}: ${value}`);
    }
  }
  if (params.data) {
    args.push("--data-raw", params.data);
  }
  if (params.form) {
    for (const [key, value] of Object.entries(params.form)) {
      validateNoCRLF(key, "form field name");
      validateNoCRLF(value, `form field value for "${key}"`);
      args.push("--form-string", `${key}=${value}`);
    }
  }
  if (params.follow_redirects !== false) {
    args.push("-L");
    args.push("--max-redirs", String(params.max_redirects ?? LIMITS.MAX_REDIRECTS));
    args.push("--proto-redir", "=http,https");
  }
  if (params.insecure) {
    args.push("-k");
  }
  if (params.timeout) {
    args.push("--max-time", params.timeout.toString());
  }
  if (params.user_agent) {
    validateNoCRLF(params.user_agent, "user_agent");
    args.push("-A", params.user_agent);
  }
  if (params.basic_auth) {
    validateNoCRLF(params.basic_auth, "basic_auth");
    args.push("-u", params.basic_auth);
  }
  if (params.bearer_token) {
    validateNoCRLF(params.bearer_token, "bearer_token");
    args.push("-H", `Authorization: Bearer ${params.bearer_token}`);
  }
  if (params.verbose) {
    args.push("-v");
  }
  if (params.include_headers) {
    args.push("-i");
  }
  if (params.compressed) {
    args.push("--compressed");
  }
  if (params.silent !== false) {
    args.push("-s");
  }
  const metadataSuffix = params.metadataSeparator.replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "%{content_type}";
  if (params.output_format) {
    args.push("-w", params.output_format + metadataSuffix);
  } else {
    args.push("-w", metadataSuffix);
  }
  if (params.dnsResolve) {
    const { hostname, port, resolvedIp } = params.dnsResolve;
    args.push("--resolve", `${hostname}:${port}:${resolvedIp}`);
  }
  args.push("--max-filesize", String(LIMITS.MAX_RESPONSE_SIZE));
  args.push(params.url);
  return args;
}

// src/lib/response/parser.ts
function isJsonContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  const mimeType = ct.split(";")[0].trim();
  return mimeType === "application/json" || mimeType.endsWith("+json");
}
function parseResponseWithMetadata(rawResponse, separator) {
  const searchStart = Math.max(0, rawResponse.length - LIMITS.MAX_METADATA_TAIL_LENGTH);
  const tailSection = rawResponse.slice(searchStart);
  const separatorIndexInTail = tailSection.lastIndexOf(separator);
  if (separatorIndexInTail === -1) {
    return { body: rawResponse };
  }
  const separatorIndex = searchStart + separatorIndexInTail;
  const body = rawResponse.slice(0, separatorIndex);
  const contentType = rawResponse.slice(separatorIndex + separator.length).trim();
  return { body, contentType: contentType || void 0 };
}
function sanitizeErrorMessage(message, includeDetails) {
  if (includeDetails) {
    return message;
  }
  let sanitized = message.replace(/\nPreview:[\s\S]*$/, "");
  sanitized = sanitized.replace(/(?:\/(?:[^\s/:]+\/)+[^\s/:]+|[A-Za-z]:\\[^\s:]+)/g, "[PATH]");
  if (sanitized !== message) {
    sanitized += " (use include_metadata: true for details)";
  }
  return sanitized;
}

// src/lib/response/formatter.ts
function formatResponse(stdout, stderr, exitCode, includeMetadata, fileSaveInfo) {
  if (fileSaveInfo?.savedToFile && fileSaveInfo.filepath) {
    if (includeMetadata) {
      const output = {
        success: exitCode === 0,
        exit_code: exitCode,
        saved_to_file: true,
        filepath: fileSaveInfo.filepath,
        message: fileSaveInfo.message ?? "Response saved to file. Read the file to access contents."
      };
      if (stderr) output.stderr = stderr;
      return JSON.stringify(output, null, 2);
    }
    return fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
  }
  if (includeMetadata) {
    const output = {
      success: exitCode === 0,
      exit_code: exitCode,
      response: stdout
    };
    if (stderr) output.stderr = stderr;
    return JSON.stringify(output, null, 2);
  }
  return stdout;
}

// src/lib/response/file-saver.ts
import { join as join2, resolve as resolve3 } from "path";
import { writeFile, realpath as realpath3 } from "fs/promises";
function createSafeFilenameBase(input, fallback = "response") {
  let base = input.replace(/[^a-zA-Z0-9]/g, "_");
  base = base.slice(0, LIMITS.FILENAME_MAX_LENGTH);
  base = base.replace(/^_+|_+$/g, "");
  if (!base) {
    base = fallback;
  }
  if (isWindowsReservedBasename(base) || base === "." || base === "..") {
    const prefixed = `${fallback}_${base}`.slice(0, LIMITS.FILENAME_MAX_LENGTH);
    base = isWindowsReservedBasename(prefixed) ? `safe_${Date.now()}`.slice(0, LIMITS.FILENAME_MAX_LENGTH) : prefixed;
  }
  return base;
}
async function saveResponseToFile(content, url, outputDir) {
  const targetDir = outputDir ?? await getOrCreateTempDir();
  if (outputDir) {
    const realDir = await realpath3(resolve3(outputDir));
    const normalizedTarget = await realpath3(resolve3(targetDir));
    if (realDir !== normalizedTarget) {
      throw new Error(`Output directory path mismatch after normalization`);
    }
  }
  let baseName;
  try {
    const urlObj = new URL(url);
    baseName = urlObj.hostname + urlObj.pathname;
  } catch (error) {
    if (error instanceof TypeError) {
      baseName = url;
    } else {
      throw error;
    }
  }
  const safeName = createSafeFilenameBase(baseName);
  const filename = `${safeName}_${Date.now()}.txt`;
  const filepath = join2(targetDir, filename);
  await writeFile(filepath, content, { encoding: "utf-8", mode: 384 });
  return filepath;
}

// src/lib/jq/tokenizer.ts
function parseQuotedKey(filter, quoteIndex) {
  const quote = filter[quoteIndex];
  let i = quoteIndex + 1;
  let key = "";
  let foundClosingQuote = false;
  while (i < filter.length) {
    const ch = filter[i];
    if (ch === "\\") {
      if (i + 1 < filter.length) {
        key += filter[i + 1];
        i += 2;
        continue;
      }
      key += ch;
      i++;
      continue;
    }
    if (ch === quote) {
      i++;
      foundClosingQuote = true;
      break;
    }
    key += ch;
    i++;
  }
  if (!foundClosingQuote) {
    throw new Error(`Missing closing quote ${quote} in filter "${filter}"`);
  }
  if (i >= filter.length || filter[i] !== "]") {
    throw new Error(`Missing closing bracket "]" after quoted key in filter "${filter}"`);
  }
  return { token: { type: "key", value: key }, newIndex: i + 1 };
}
function parseNumericOrSlice(filter, contentStart, bracketStart) {
  let i = contentStart;
  let numStr = "";
  let hasColon = false;
  while (i < filter.length && filter[i] !== "]") {
    if (filter[i] === ":") hasColon = true;
    numStr += filter[i];
    i++;
  }
  if (i >= filter.length) {
    throw new Error(`Unterminated bracket expression in filter "${filter}" at position ${bracketStart}`);
  }
  i++;
  if (hasColon) {
    return parseSlice(numStr, filter, i);
  }
  return parseIndex(numStr, filter, i);
}
function parseSlice(numStr, filter, newIndex) {
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
    if (!Number.isSafeInteger(parsedStart)) {
      throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": exceeds safe integer range`);
    }
    if (parsedStart < 0) {
      throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": negative indices are not supported`);
    }
    if (parts[0] !== String(parsedStart)) {
      throw new Error(`Invalid slice start "${parts[0]}" in filter "${filter}": leading zeros are not allowed`);
    }
    start = parsedStart;
  }
  let end;
  if (parts[1]) {
    const parsedEnd = parseInt(parts[1], 10);
    if (Number.isNaN(parsedEnd)) {
      throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}"`);
    }
    if (!Number.isSafeInteger(parsedEnd)) {
      throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": exceeds safe integer range`);
    }
    if (parsedEnd < 0) {
      throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": negative indices are not supported`);
    }
    if (parts[1] !== String(parsedEnd)) {
      throw new Error(`Invalid slice end "${parts[1]}" in filter "${filter}": leading zeros are not allowed`);
    }
    end = parsedEnd;
  }
  return { token: { type: "slice", start, end }, newIndex };
}
function parseIndex(numStr, filter, newIndex) {
  const index = parseInt(numStr, 10);
  if (Number.isNaN(index)) {
    throw new Error(`Invalid array index "${numStr}" in filter "${filter}"`);
  }
  if (index < 0) {
    throw new Error(`Invalid array index "${numStr}" in filter "${filter}": negative indices are not supported`);
  }
  if (!Number.isSafeInteger(index)) {
    throw new Error(`Invalid array index "${numStr}" in filter "${filter}": exceeds safe integer range`);
  }
  if (numStr !== String(index)) {
    throw new Error(`Invalid array index "${numStr}" in filter "${filter}": leading zeros and explicit '+' signs are not allowed`);
  }
  return { token: { type: "index", value: index }, newIndex };
}
function parseBracketToken(filter, startIndex) {
  const contentStart = startIndex + 1;
  if (contentStart >= filter.length) {
    throw new Error(`Unterminated bracket "[" in filter "${filter}"`);
  }
  if (filter[contentStart] === "]") {
    return { token: { type: "iterate" }, newIndex: contentStart + 1 };
  }
  if (filter[contentStart] === '"' || filter[contentStart] === "'") {
    return parseQuotedKey(filter, contentStart);
  }
  return parseNumericOrSlice(filter, contentStart, startIndex);
}

// src/lib/jq/parser.ts
function parseJqFilter(filter) {
  if (filter.length > JQ.MAX_FILTER_LENGTH) {
    throw new Error(`jq_filter exceeds maximum length of ${JQ.MAX_FILTER_LENGTH} characters`);
  }
  const startTime = Date.now();
  const tokens = [];
  let i = filter[0] === "." ? 1 : 0;
  while (i < filter.length) {
    if (Date.now() - startTime > JQ.MAX_PARSE_TIME_MS) {
      throw new Error("jq_filter parsing timeout - filter too complex");
    }
    if (filter[i] === ".") {
      i++;
      continue;
    }
    if (filter[i] === "[") {
      const result = parseBracketToken(filter, i);
      tokens.push(result.token);
      if (tokens.length > JQ.MAX_TOKENS) {
        throw new Error(`jq_filter exceeds maximum of ${JQ.MAX_TOKENS} path segments`);
      }
      i = result.newIndex;
      continue;
    }
    let key = "";
    while (i < filter.length && filter[i] !== "." && filter[i] !== "[") {
      key += filter[i];
      i++;
    }
    if (key) {
      if (/^\d+$/.test(key)) {
        const parsed = parseInt(key, 10);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(
            `Invalid array index "${key}" in filter "${filter}": exceeds safe integer range`
          );
        }
        if (key !== String(parsed)) {
          throw new Error(
            `Invalid array index "${key}" in filter "${filter}": leading zeros are not allowed`
          );
        }
        tokens.push({ type: "index", value: parsed });
      } else {
        tokens.push({ type: "key", value: key });
      }
      if (tokens.length > JQ.MAX_TOKENS) {
        throw new Error(`jq_filter exceeds maximum of ${JQ.MAX_TOKENS} path segments`);
      }
    }
  }
  return tokens;
}
function splitJqFilters(filter) {
  if (filter.length > JQ.MAX_FILTER_LENGTH) {
    throw new Error(`jq_filter exceeds maximum length of ${JQ.MAX_FILTER_LENGTH} characters`);
  }
  const startTime = Date.now();
  const filters = [];
  let current = "";
  let bracketDepth = 0;
  let inQuote = null;
  let escaped = false;
  for (let i = 0; i < filter.length; i++) {
    if (Date.now() - startTime > JQ.MAX_PARSE_TIME_MS) {
      throw new Error("jq_filter parsing timeout - filter too complex");
    }
    const ch = filter[i];
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
    if (inQuote) {
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth--;
      if (bracketDepth < 0) {
        throw new Error(
          `Invalid jq_filter "${filter}": unmatched closing bracket "]"`
        );
      }
      current += ch;
      continue;
    }
    if (ch === "," && bracketDepth === 0) {
      const trimmed2 = current.trim();
      if (!trimmed2) {
        const position = filters.length === 0 ? "leading" : "consecutive";
        throw new Error(
          `Invalid jq_filter "${filter}": ${position} comma at position ${i}`
        );
      }
      filters.push(trimmed2);
      current = "";
      continue;
    }
    current += ch;
  }
  if (inQuote) {
    throw new Error(
      `Invalid jq_filter "${filter}": unclosed ${inQuote === '"' ? "double" : "single"} quote`
    );
  }
  if (bracketDepth > 0) {
    throw new Error(
      `Invalid jq_filter "${filter}": unclosed bracket "["`
    );
  }
  const trimmed = current.trim();
  if (!trimmed && filters.length > 0) {
    throw new Error(
      `Invalid jq_filter "${filter}": trailing comma`
    );
  }
  if (trimmed) {
    filters.push(trimmed);
  }
  if (filters.length > JQ.MAX_FILTERS) {
    throw new Error(
      `jq_filter has too many comma-separated paths (${filters.length}). Maximum allowed is ${JQ.MAX_FILTERS}.`
    );
  }
  return filters;
}

// src/lib/jq/filter.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function applySingleJqFilter(data, filter) {
  const tokens = parseJqFilter(filter);
  if (tokens.length === 0) {
    throw new Error(
      `Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`
    );
  }
  let result = data;
  for (const token of tokens) {
    if (result === null || result === void 0) {
      return null;
    }
    switch (token.type) {
      case "key":
        if (!isRecord(result)) {
          return null;
        }
        result = result[token.value];
        break;
      case "index":
        if (Array.isArray(result)) {
          result = result[token.value];
        } else {
          return null;
        }
        break;
      case "slice":
        if (Array.isArray(result)) {
          result = result.slice(token.start, token.end);
        } else {
          return null;
        }
        break;
      case "iterate":
        if (!Array.isArray(result)) {
          return null;
        }
        break;
    }
  }
  return result;
}
function applyJqFilterToParsed(data, filter) {
  const filters = splitJqFilters(filter);
  if (filters.length === 0) {
    throw new Error(
      `Invalid jq_filter "${filter}": filter must specify a path (e.g., ".data", ".[0]", ".items[0:5]")`
    );
  }
  if (filters.length > JQ.MAX_FILTERS) {
    throw new Error(
      `jq_filter exceeds maximum of ${JQ.MAX_FILTERS} comma-separated paths`
    );
  }
  if (filters.length === 1) {
    const result = applySingleJqFilter(data, filters[0]);
    return JSON.stringify(result, null, 2);
  }
  const results = filters.map((f) => applySingleJqFilter(data, f));
  return JSON.stringify(results, null, 2);
}
function applyJqFilter(jsonString, filter) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const preview = jsonString.slice(0, LIMITS.ERROR_PREVIEW_LENGTH);
      throw new Error(
        `Response is not valid JSON. Cannot apply jq_filter.
Preview: ${preview}${jsonString.length > LIMITS.ERROR_PREVIEW_LENGTH ? "..." : ""}`
      );
    }
    throw error;
  }
  return applyJqFilterToParsed(data, filter);
}

// src/lib/response/processor.ts
async function processResponse(response, options) {
  const rawBytes = Buffer.byteLength(response, "utf8");
  if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
    throw new Error(
      `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
    );
  }
  let content = response;
  if (options.jqFilter) {
    const isJson = isJsonContentType(options.contentType);
    const trimmed = content.trim();
    let parsedData;
    if (!isJson) {
      const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
      if (!looksLikeJson) {
        throw new Error(
          `Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"})`
        );
      }
    }
    try {
      parsedData = JSON.parse(trimmed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Cannot apply jq_filter: Response does not appear to be valid JSON`
        );
      }
      throw error;
    }
    content = applyJqFilterToParsed(parsedData, options.jqFilter);
  }
  const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
  const contentBytes = Buffer.byteLength(content, "utf8");
  const shouldSave = options.saveToFile || contentBytes > maxSize;
  if (shouldSave) {
    const filepath = await saveResponseToFile(content, options.url, options.outputDir);
    let displayContent = content;
    if (contentBytes > maxSize) {
      displayContent = Buffer.from(content, "utf8").subarray(0, maxSize).toString("utf8");
    }
    return {
      content: displayContent,
      savedToFile: true,
      filepath,
      message: `Response (${contentBytes} bytes) saved to: ${filepath}`
    };
  }
  return {
    content,
    savedToFile: false
  };
}

// src/lib/tools/curl-execute.ts
var CURL_EXECUTE_TOOL_META = {
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
  - user_agent (string): Custom User-Agent header (a browser-like default is sent automatically if not set; empty string disables)
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
  - Check ${TEMP_DIR.PREFIX}* in system temp dir if files persist after crash`,
  inputSchema: CurlExecuteSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
};
async function executeCurlRequest(params, extra = {}) {
  try {
    if (params.include_headers && params.jq_filter) {
      throw new Error(
        "Cannot use jq_filter with include_headers. HTTP headers in the response make it non-JSON. Remove include_headers to use jq_filter, or remove jq_filter to see headers."
      );
    }
    if (params.basic_auth && !params.basic_auth.includes(":")) {
      throw new Error("basic_auth must be in 'username:password' format");
    }
    const dnsResult = await validateUrlAndResolveDns(params.url, {
      allowLocalhost: extra.allowLocalhost
    });
    checkRateLimits(dnsResult.hostname, extra.sessionId);
    const resolvedOutputDir = resolveOutputDir(params.output_dir);
    const validatedOutputDir = resolvedOutputDir ? await validateOutputDir(resolvedOutputDir) : void 0;
    const metadataSeparator = generateMetadataSeparator();
    const args = buildCurlArgs({
      ...params,
      silent: true,
      dnsResolve: dnsResult,
      metadataSeparator
    });
    const timeoutMs = (params.timeout ?? LIMITS.DEFAULT_TIMEOUT_MS / 1e3) * 1e3;
    const result = await executeCommand("curl", args, timeoutMs);
    const { body, contentType } = parseResponseWithMetadata(result.stdout, metadataSeparator);
    const processed = await processResponse(body, {
      url: params.url,
      jqFilter: params.jq_filter,
      maxResultSize: params.max_result_size,
      saveToFile: params.save_to_file,
      contentType,
      outputDir: validatedOutputDir
    });
    const output = formatResponse(
      processed.content,
      result.stderr,
      result.exitCode,
      params.include_metadata,
      {
        savedToFile: processed.savedToFile,
        filepath: processed.savedToFile ? processed.filepath : void 0,
        message: processed.message
      }
    );
    return {
      content: [
        {
          type: "text",
          text: output
        }
      ]
    };
  } catch (error) {
    const rawMessage = getErrorMessage(error);
    const errorMessage = sanitizeErrorMessage(rawMessage, params.include_metadata);
    let hostname = "unknown";
    try {
      hostname = new URL(params.url).hostname;
    } catch {
    }
    const errorClass = error instanceof Error ? error.constructor.name : "Error";
    console.error(`curl_execute error: [${hostname}] ${errorClass}`);
    return {
      content: [
        {
          type: "text",
          text: `Error executing cURL request: ${errorMessage}`
        }
      ],
      isError: true
    };
  }
}
function registerCurlExecuteTool(server) {
  server.registerTool(
    "curl_execute",
    CURL_EXECUTE_TOOL_META,
    (params, extra) => executeCurlRequest(params, extra)
  );
}

export {
  ENV,
  getErrorMessage,
  resolveBaseUrl,
  SESSION,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  safeStringCompare,
  isValidSessionId,
  LIMITS,
  parsePort,
  SERVER,
  applyDefaultHeaders,
  getOrCreateTempDir,
  cleanupOrphanedTempDirs,
  cleanupTempDir,
  validateFilePath,
  resolveOutputDir,
  validateOutputDir,
  CurlExecuteSchema,
  JqQuerySchema,
  createSafeFilenameBase,
  applyJqFilter,
  CURL_EXECUTE_TOOL_META,
  executeCurlRequest,
  registerCurlExecuteTool
};
