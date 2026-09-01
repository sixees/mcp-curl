// src/lib/utils/url.ts
import { z } from "zod";

// src/lib/config/security/url-schemes.ts
var ALLOWED_URL_SCHEMES = Object.freeze(["http:", "https:"]);
var ALLOWED_URL_SCHEMES_CURL_FLAG = `=${ALLOWED_URL_SCHEMES.map((s) => s.replace(":", "")).join(",")}`;
function isAllowedUrlScheme(protocol) {
  return ALLOWED_URL_SCHEMES.includes(protocol);
}

// src/lib/utils/url.ts
function resolveBaseUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
function createHttpOnlyUrlSchema(options = {}) {
  const { description = "URL (http or https)", message = "URL must use http or https scheme" } = options;
  return z.url("Must be a valid URL").refine(
    (url) => {
      try {
        return isAllowedUrlScheme(new URL(url).protocol);
      } catch {
        return false;
      }
    },
    { message }
  ).describe(description);
}
function safeHostname(url, fallback = "unknown") {
  if (!url) return fallback;
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}

// src/lib/config/limits.ts
var BYTES_PER_MB = 1e6;
var FIXED_POINT_MAX_ITERATIONS = 4;
var LIMITS = {
  /** Maximum response size for processing (10MB) */
  MAX_RESPONSE_SIZE: 1e7,
  /** Default max result size for AI agent responses (500KB) */
  DEFAULT_MAX_RESULT_SIZE: 5e5,
  /** Maximum total memory across all concurrent requests (100MB) */
  MAX_TOTAL_RESPONSE_MEMORY: 1e8,
  /** Characters to show in error previews */
  ERROR_PREVIEW_LENGTH: 200,
  /**
   * Maximum bytes of response header text returned inline (64KB).
   *
   * Header text is server-controlled and is surfaced inline even when the
   * body was auto-saved to a file, so it is not covered by
   * `max_result_size`. Without its own ceiling the only bound is
   * `MAX_RESPONSE_SIZE` (10MB) — twenty times the default inline return.
   * cURL permits ~100KB per header line and caps neither header count nor
   * redirect-chain length, so "headers are small" is an assumption the
   * remote gets to falsify.
   */
  MAX_HEADER_TEXT_BYTES: 64e3,
  // NOTE: the EFFECTIVE ceiling on returned header text is
  // `min(MAX_HEADER_TEXT_BYTES, max_result_size)` — header text is inline, so
  // it honours the caller's inline budget too. Cite this constant rather than
  // restating either number; four documents said "64KB" unconditionally and
  // were wrong for any caller who set a smaller max_result_size.
  /**
   * Byte allowance for the `-w` metadata FIELDS, searched backwards from the
   * end of stdout. **This is the budget for the fields only** — the window
   * actually searched is this plus the separator's own length.
   *
   * It must not be a flat constant that the separator and a remote-controlled
   * field share. `%{content_type}` is echoed verbatim from the origin and has
   * no length limit, so when the three shared one 200-byte budget an origin
   * could evict the separator simply by sending a long `Content-Type` — a
   * legal `application/vnd.api+json; charset=utf-8; profile="…"` did it at
   * ~144 characters. The parse then found no separator, reported every
   * cURL-authored field as absent, and the caller silently lost both the
   * header/body split and the content-type-driven strip stages.
   *
   * 8KB covers every realistic origin (cURL permits ~100KB per header line,
   * but no real service approaches that in a Content-Type). Beyond it the
   * parse fails closed and the caller is told the metadata is undetermined.
   */
  MAX_METADATA_TAIL_LENGTH: 8192,
  /** Default request timeout in milliseconds (30 seconds) */
  DEFAULT_TIMEOUT_MS: 3e4,
  /** Maximum filename length for saved files */
  FILENAME_MAX_LENGTH: 50,
  /** Default HTTP transport port */
  DEFAULT_HTTP_PORT: 3e3,
  /** Default maximum number of redirects to follow */
  MAX_REDIRECTS: 10,
  /**
   * Maximum length of operator-supplied HTTP transport auth tokens.
   * 4096 covers RSA-256 JWTs (~700–900 chars), OIDC ID tokens (1500–2500 chars),
   * and JWE tokens (up to ~4 KB) while staying well below the 8 KB HTTP
   * header line-limit. Above this length is almost certainly a paste error.
   */
  MAX_AUTH_TOKEN_LENGTH: 4096
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

// src/lib/utils/unicode-attack-ranges.ts
var C0_CONTROLS = "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F";
var C1_CONTROLS = "\\u007F-\\u009F";
var SOFT_HYPHEN = "\\u00AD";
var ARABIC_LETTER_MARK = "\\u061C";
var HANGUL_FILLERS = "\\u115F\\u1160";
var MONGOLIAN_INVISIBLES = "\\u180B-\\u180E";
var ZERO_WIDTH_AND_DIRECTIONAL_MARKS = "\\u200B-\\u200F";
var LINE_PARAGRAPH_SEPARATORS = "\\u2028\\u2029";
var BIDI_EMBEDDING_OVERRIDE = "\\u202A-\\u202E";
var WORD_JOINER_FAMILY = "\\u2060-\\u2064";
var BIDI_ISOLATES = "\\u2066-\\u2069";
var BRAILLE_PATTERN_BLANK = "\\u2800";
var HANGUL_FILLER_3164 = "\\u3164";
var BOM = "\\uFEFF";
var VARIATION_SELECTORS_BASIC = "\\uFE00-\\uFE0F";
var TAGS_BLOCK = "\\u{E0000}-\\u{E007F}";
var VARIATION_SELECTORS_SUPPLEMENT = "\\u{E0100}-\\u{E01EF}";
var UNICODE_ATTACK_RANGES = C0_CONTROLS + C1_CONTROLS + SOFT_HYPHEN + ARABIC_LETTER_MARK + HANGUL_FILLERS + MONGOLIAN_INVISIBLES + ZERO_WIDTH_AND_DIRECTIONAL_MARKS + LINE_PARAGRAPH_SEPARATORS + BIDI_EMBEDDING_OVERRIDE + WORD_JOINER_FAMILY + BIDI_ISOLATES + BRAILLE_PATTERN_BLANK + HANGUL_FILLER_3164 + BOM + VARIATION_SELECTORS_BASIC + TAGS_BLOCK + VARIATION_SELECTORS_SUPPLEMENT;
var WHITESPACE_PADDING_CODEPOINTS = {
  discrete: [
    32,
    // SPACE
    9,
    // TAB
    160,
    // NO-BREAK SPACE
    8239,
    // NARROW NO-BREAK SPACE
    8287,
    // MEDIUM MATHEMATICAL SPACE
    12288
    // IDEOGRAPHIC SPACE
  ],
  ranges: [
    [8192, 8202]
    // EN/EM-space family
  ]
};
var fmt = (cp) => cp <= 65535 ? `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}` : `\\u{${cp.toString(16).toUpperCase()}}`;
var WHITESPACE_PADDING_CLASS = WHITESPACE_PADDING_CODEPOINTS.discrete.map(fmt).join("") + WHITESPACE_PADDING_CODEPOINTS.ranges.map(([lo, hi]) => `${fmt(lo)}-${fmt(hi)}`).join("");
var INJECTION_PHRASE_GAP_MAX = 80;
var INJECTION_PHRASE_GAP = `[\\s\\S]{0,${INJECTION_PHRASE_GAP_MAX}}`;

// src/lib/utils/sanitize.ts
var WS_PADDING_DISCRETE_SET = new Set(
  WHITESPACE_PADDING_CODEPOINTS.discrete
);
var MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1e3;
var DESC_CONTROL_CHARS = new RegExp(`[${UNICODE_ATTACK_RANGES}]+`, "gu");
var WHITESPACE_PADDING_PATTERN = `[${WHITESPACE_PADDING_CLASS}]{50,}|(?:\\n[ \\t\\xa0]?){20,}`;
var RESPONSE_SANITIZE_PATTERN = new RegExp(
  `[${UNICODE_ATTACK_RANGES}]+|${WHITESPACE_PADDING_PATTERN}`,
  "gu"
);
var INJECTION_PATTERNS = new RegExp(
  [
    // Explicit instruction override
    `ignore${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|system)${INJECTION_PHRASE_GAP}instructions?`,
    `disregard${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|system)${INJECTION_PHRASE_GAP}(instructions?|directives?|rules?)`,
    `forget${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|everything|instructions?)`,
    `override${INJECTION_PHRASE_GAP}(your|the|all|previous)${INJECTION_PHRASE_GAP}(instructions?|settings?|behavior|config|directives?|rules?)`,
    // Synonym families for the explicit-override class (PR-8 / B7-sub-4)
    // — paraphrases that the four canonical verbs above miss
    // ("stop following your instructions", "cease compliance with the
    // rules", "bypass your safety filters"). Each family carries at
    // least one regression test in `sanitize.test.ts`.
    //
    // **Known false-positive class** — `stop\s+applying` over-triggers
    // on legitimate ops/safety phrasing ("stop applying this patch",
    // "stop applying the brakes"). Detection is observability-only so
    // the cost is log noise, not blocked content; per master plan
    // §Risks. Locked by the `documented FP class` test in
    // `sanitize.test.ts` so a future narrowing PR (e.g. requiring an
    // instruction-class object word in the same shape
    // `bypass\s+(your|all|the)\s+(...)` uses) updates implementation
    // and tests together.
    "stop\\s+(following|obeying|applying)",
    "cease\\s+(compliance|following|obeying)",
    "bypass\\s+(your|all|the)\\s+(instructions?|filters?|safety)",
    // Persona takeover
    "you\\s+are\\s+now\\s+",
    "act\\s+as\\s+",
    "assume\\s+the\\s+role\\s+of",
    "pretend\\s+(you\\s+are|to\\s+be)",
    "roleplay\\s+as",
    "\\bDAN\\b",
    "jailbreak",
    // Privilege escalation / structural override tokens
    "\\[ADMIN[\\s_-]*OVERRIDE\\]",
    "<\\s*admin\\s*>",
    "<\\s*SYSTEM\\s*>",
    "<\\s*IMPORTANT\\s*>",
    "\\[INST\\]",
    // System/prompt manipulation
    "system\\s+prompt",
    "new\\s+(primary\\s+)?instructions?\\s*(are|:|follow)",
    "your\\s+new\\s+(primary\\s+|main\\s+)?objective",
    `do\\s+not\\s+(follow|apply|use|obey|comply)${INJECTION_PHRASE_GAP}instructions?`,
    // Data exfiltration — file system triggers
    "read\\s+~\\/\\.(ssh|cursor|env|zshrc|bashrc|config|npmrc|gitconfig)",
    `pass${INJECTION_PHRASE_GAP}(its|the)\\s+contents?\\s+as`,
    "exfiltrate",
    `(extract|exfiltrate|leak|transmit|send\\s+me)${INJECTION_PHRASE_GAP}(passwords?|credentials?|secrets?|tokens?|api[\\s\\S]{0,5}keys?)`
  ].join("|"),
  "i"
);
function sanitizeDescription(input) {
  if (input == null) return "";
  return input.replace(DESC_CONTROL_CHARS, " ").trim();
}
var SANITIZE_FIXED_POINT_MAX_ITERATIONS = FIXED_POINT_MAX_ITERATIONS;
function sanitizeResponse(input) {
  if (input == null) return "";
  let curr = input;
  for (let i = 0; i < SANITIZE_FIXED_POINT_MAX_ITERATIONS; i++) {
    const next = curr.replace(RESPONSE_SANITIZE_PATTERN, (match) => {
      if (match.charCodeAt(0) === 10) return "\n";
      if (isWhitespacePaddingMatch(match)) return " ";
      return "";
    });
    if (next === curr) return next;
    curr = next;
  }
  return curr;
}
function isWhitespacePaddingMatch(match) {
  const cp = match.codePointAt(0);
  if (cp === void 0) return false;
  if (WS_PADDING_DISCRETE_SET.has(cp)) return true;
  return WHITESPACE_PADDING_CODEPOINTS.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
}
function detectInjectionPattern(input) {
  return INJECTION_PATTERNS.test(input.normalize("NFKC"));
}
var SPOTLIGHT_SENTINEL_PREFIX = "---EXTERNAL-CONTENT-BEGIN-";
var SPOTLIGHT_REQUEST_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
var SPOTLIGHT_HEADER_PATTERN = /^---EXTERNAL-CONTENT-BEGIN-([0-9a-f-]{32,36})---\n/i;
function isSpotlightEnvelope(text) {
  if (typeof text !== "string" || text.length < SPOTLIGHT_SENTINEL_PREFIX.length) return false;
  if (!text.startsWith(SPOTLIGHT_SENTINEL_PREFIX)) return false;
  const headerMatch = SPOTLIGHT_HEADER_PATTERN.exec(text);
  if (!headerMatch) return false;
  const uuid = headerMatch[1];
  if (!SPOTLIGHT_REQUEST_ID_PATTERN.test(uuid)) return false;
  const expectedEnd = `
---EXTERNAL-CONTENT-END-${uuid}---`;
  return text.endsWith(expectedEnd);
}
function applySpotlighting(content, requestId) {
  if (isSpotlightEnvelope(content)) {
    return content;
  }
  if (!requestId) {
    throw new Error("applySpotlighting: requestId must be a non-empty string");
  }
  if (!SPOTLIGHT_REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error(
      "applySpotlighting: requestId must be a UUID-shaped string (32\u201336 hex chars; pass randomUUID())"
    );
  }
  const begin = `${SPOTLIGHT_SENTINEL_PREFIX}${requestId}---`;
  const end = `---EXTERNAL-CONTENT-END-${requestId}---`;
  return `${begin}
${content}
${end}`;
}

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
  const safeValue = value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\0/g, "\\0");
  return new Error(`Invalid ${configName} value "${safeValue}": ${reason}.`);
}

// src/lib/utils/content-type.ts
function parseMimeType(contentType) {
  if (typeof contentType !== "string" || !contentType) return "";
  return contentType.split(";")[0].trim().toLowerCase();
}
var BINARY_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "font/",
  "multipart/",
  "application/vnd.ms-",
  "application/vnd.openxmlformats-"
];
var TEXTUAL_MIME_OVERRIDES = /* @__PURE__ */ new Set([
  "image/svg+xml"
]);
var BINARY_MIME_EXACT = /* @__PURE__ */ new Set([
  "application/octet-stream",
  "application/pdf",
  "application/wasm",
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/protobuf",
  "application/x-protobuf",
  "application/x-msgpack",
  "application/cbor",
  "application/msword"
]);
function isBinaryContentType(contentType) {
  const mime = parseMimeType(contentType);
  if (!mime) return false;
  if (TEXTUAL_MIME_OVERRIDES.has(mime)) return false;
  return BINARY_MIME_EXACT.has(mime) || BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}
var MARKUP_COMMENT_MIME_EXACT = /* @__PURE__ */ new Set([
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "image/svg+xml"
]);
var MARKUP_COMMENT_MIME_SUFFIXES = ["+xml"];
function supportsMarkupComments(contentType) {
  const mime = parseMimeType(contentType);
  if (!mime) return false;
  if (MARKUP_COMMENT_MIME_EXACT.has(mime)) return true;
  return MARKUP_COMMENT_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix));
}
var MARKDOWN_MIME = "text/markdown";
var MARKDOWN_MIME_EXACT = /* @__PURE__ */ new Set([
  MARKDOWN_MIME,
  "text/x-markdown"
]);
var MARKDOWN_MIME_SUFFIXES = ["+markdown"];
function isMarkdownContentType(contentType) {
  const mime = parseMimeType(contentType);
  if (!mime) return false;
  if (MARKDOWN_MIME_EXACT.has(mime)) return true;
  return MARKDOWN_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix));
}
function isSniffableContentType(contentType) {
  const mime = parseMimeType(contentType);
  if (mime === "application/json") return false;
  if (MARKUP_COMMENT_MIME_EXACT.has(mime)) return false;
  if (MARKUP_COMMENT_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix))) return false;
  if (MARKDOWN_MIME_EXACT.has(mime)) return false;
  if (MARKDOWN_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix))) return false;
  if (mime === "" || mime === "text/plain") return true;
  if (mime.startsWith("text/")) return true;
  return isBinaryContentType(contentType);
}

// src/lib/security/detection-logger.ts
var THROTTLE_WINDOW_MS = 6e4;
var lastDetectedMap = /* @__PURE__ */ new Map();
function normalizeDetectionLabel(label) {
  return label.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 128);
}
function logInjectionDetected(hostname) {
  const safeLabel = normalizeDetectionLabel(hostname);
  const now = Date.now();
  const lastSeen = lastDetectedMap.get(safeLabel);
  if (lastSeen !== void 0 && now - lastSeen < THROTTLE_WINDOW_MS) {
    return;
  }
  lastDetectedMap.set(safeLabel, now);
  console.error(`[injection-defense] [${safeLabel}] InjectionDetected`);
}
function sanitizeAndDetect(text, label) {
  if (detectInjectionPattern(text)) {
    logInjectionDetected(label);
  }
  return sanitizeResponse(text);
}
function startInjectionCleanup() {
  const interval = setInterval(cleanupInjectionDetectionMap, THROTTLE_WINDOW_MS);
  interval.unref();
  return interval;
}
function stopInjectionCleanup(interval) {
  clearInterval(interval);
}
function cleanupInjectionDetectionMap() {
  const now = Date.now();
  for (const [key, timestamp] of lastDetectedMap) {
    if (now - timestamp >= THROTTLE_WINDOW_MS) {
      lastDetectedMap.delete(key);
    }
  }
}

// src/lib/server/schemas.ts
import { z as z2 } from "zod";
var CurlExecuteSchema = z2.object({
  url: createHttpOnlyUrlSchema({ description: "The URL to request (http or https)" }),
  method: z2.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional().describe("HTTP method (defaults to GET, or POST if data is provided)"),
  headers: z2.record(z2.string(), z2.string()).optional().describe('HTTP headers as key-value pairs (e.g., {"Content-Type": "application/json"})'),
  data: z2.string().optional().describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
  form: z2.record(z2.string(), z2.string()).optional().describe("Form data as key-value pairs (uses multipart/form-data)"),
  follow_redirects: z2.boolean().default(true).describe("Follow HTTP redirects (default: true)"),
  max_redirects: z2.number().int().min(0).max(50).optional().describe("Maximum number of redirects to follow"),
  insecure: z2.boolean().default(false).describe("Skip SSL certificate verification (default: false)"),
  /**
   * Request timeout in seconds.
   * Optional - if not provided, defaults are applied in this order:
   * 1. McpCurlConfig.defaultTimeout (if configured)
   * 2. LIMITS.DEFAULT_TIMEOUT_MS / 1000 (30 seconds)
   *
   * Note: This field intentionally has no .default() to distinguish between
   * "user explicitly passed 30" vs "user didn't provide a value".
   */
  timeout: z2.number().int().min(1).max(300).optional().describe("Request timeout in seconds (default: 30, max: 300)"),
  user_agent: z2.string().optional().describe("Custom User-Agent header. If not set, a browser-like User-Agent is sent automatically. Set to empty string to disable."),
  basic_auth: z2.string().optional().describe("Basic authentication in format 'username:password'"),
  bearer_token: z2.string().optional().describe("Bearer token for Authorization header"),
  verbose: z2.boolean().default(false).describe("Include verbose output with request/response details"),
  include_headers: z2.boolean().default(false).describe(
    "Report response headers. They never enter the saved file or the jq_filter input, which is what makes this safe to combine with save_to_file and jq_filter. With include_metadata they arrive under a separate 'headers' key; without it they are prefixed to the returned text followed by a blank line, so that result is not JSON-parseable. Capped at 64KB; truncation is reported via headers_truncated"
  ),
  compressed: z2.boolean().default(true).describe("Request compressed response and automatically decompress"),
  include_metadata: z2.boolean().default(false).describe("Wrap response in JSON with metadata (exit code, success status)"),
  jq_filter: z2.string().optional().describe('JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .["key"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check.'),
  max_result_size: z2.number().int().min(1e3).max(1e6).optional().describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
  save_to_file: z2.boolean().optional().describe("Force save response to temp file. Returns filepath instead of content"),
  output_dir: z2.string().optional().describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory.")
});
var JqQuerySchema = z2.object({
  filepath: z2.string().describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
  jq_filter: z2.string().describe('JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .["key"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported.'),
  max_result_size: z2.number().int().min(1e3).max(1e6).optional().describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
  save_to_file: z2.boolean().optional().describe("Force save result to file. Returns filepath instead of content"),
  output_dir: z2.string().optional().describe("Directory to save result files (must exist and be writable)")
});

// src/lib/config/server.ts
var SERVER = {
  /** MCP server name for protocol identification */
  NAME: "curl-mcp-server",
  /** Server version from package.json */
  VERSION: true ? "3.3.0" : "0.0.0"
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
var UNSUPPORTED_KEY_CHARS = /* @__PURE__ */ new Set([
  // Pipes, comparison, and arithmetic operators
  "|",
  "=",
  "<",
  ">",
  "!",
  "+",
  "*",
  "/",
  "%",
  // Optional operator
  "?",
  // Object construction, grouping, and function calls
  "{",
  "}",
  "(",
  ")",
  ":",
  ";",
  // Variables and format strings
  "$",
  "@",
  // String literals belong inside bracket notation
  '"',
  "'",
  "`",
  "\\",
  // Whitespace: a bare key containing spaces must use bracket notation
  " ",
  "	",
  "\n",
  "\r",
  "\f",
  "\v"
]);

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

// src/lib/config/labels.ts
var JQ_QUERY_HOSTNAME_LABEL = "n/a";
var CUSTOM_TOOL_HOSTNAME_LABEL = "custom";

// src/lib/config/security/ssrf.ts
var IPV4_MAPPED_IPV6_HEX_RE = /^\[?::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/i;
function normalizeIpv4MappedIpv6(host) {
  const match = host.match(IPV4_MAPPED_IPV6_HEX_RE);
  if (!match) return host;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  if (high > 65535 || low > 65535) return host;
  return `${high >> 8 & 255}.${high & 255}.${low >> 8 & 255}.${low & 255}`;
}
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
  const normalized = normalizeIpv4MappedIpv6(hostname);
  return BLOCKED_HOSTNAME_PATTERNS_INTERNAL.some((pattern) => pattern.test(normalized));
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
  const normalized = normalizeIpv4MappedIpv6(ip);
  return BLOCKED_IP_PATTERNS_INTERNAL.some((pattern) => pattern.test(normalized));
}
var LOCALHOST_IP_PATTERNS_INTERNAL = Object.freeze([
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^::ffff:127\./i
]);
function isLocalhostIp(ip) {
  const normalized = normalizeIpv4MappedIpv6(ip);
  return LOCALHOST_IP_PATTERNS_INTERNAL.some((pattern) => pattern.test(normalized));
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
var PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

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
  if (!isAllowedUrlScheme(parsed.protocol)) {
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

// src/lib/security/wrap-error-logger.ts
var THROTTLE_WINDOW_MS2 = 6e4;
var lastErrorMap = /* @__PURE__ */ new Map();
function normalizeLabel(label) {
  return label.replace(/[ --]/g, "").slice(0, 128);
}
function logWrapError(label, error) {
  const safeLabel = normalizeLabel(label);
  const now = Date.now();
  const lastSeen = lastErrorMap.get(safeLabel);
  if (lastSeen !== void 0 && now - lastSeen < THROTTLE_WINDOW_MS2) {
    return;
  }
  lastErrorMap.set(safeLabel, now);
  const errorName = error instanceof Error && typeof error.name === "string" && error.name.length > 0 ? error.name : "UnknownError";
  console.error(`[wrap-error] [${safeLabel}] ${errorName}`);
}
function cleanupWrapErrorMap() {
  const now = Date.now();
  for (const [key, timestamp] of lastErrorMap) {
    if (now - timestamp >= THROTTLE_WINDOW_MS2) {
      lastErrorMap.delete(key);
    }
  }
}
function startWrapErrorCleanup() {
  const interval = setInterval(cleanupWrapErrorMap, THROTTLE_WINDOW_MS2);
  interval.unref();
  return interval;
}
function stopWrapErrorCleanup(interval) {
  clearInterval(interval);
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
    const stdoutChunks = [];
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
      stdoutChunks.push(data);
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
        const stdoutBytes = Buffer.concat(stdoutChunks);
        stdoutChunks.length = 0;
        resolve4({
          stdoutBytes,
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
  args.push("--proto", ALLOWED_URL_SCHEMES_CURL_FLAG);
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
    args.push("--proto-redir", ALLOWED_URL_SCHEMES_CURL_FLAG);
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
  const metadataSuffix = params.metadataSeparator.replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "%{size_header} %{content_type}";
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
  const mime = parseMimeType(contentType);
  return mime === "application/json" || mime.endsWith("+json");
}
function parseResponseWithMetadata(rawResponse, separator) {
  const raw = rawResponse;
  const sep = Buffer.from(separator, "utf8");
  const windowBytes = sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH;
  const searchStart = Math.max(0, raw.length - windowBytes);
  const indexInWindow = raw.subarray(searchStart).lastIndexOf(sep);
  const separatorIndex = indexInWindow === -1 ? -1 : searchStart + indexInWindow;
  if (separatorIndex === -1) {
    return {
      body: raw.toString("utf8"),
      bodyBytes: raw,
      metadataFound: false
    };
  }
  const bodyBytes = raw.subarray(0, separatorIndex);
  const metadata = raw.subarray(separatorIndex + sep.length).toString("utf8");
  const sizeMatch = /^(\d+) ?/.exec(metadata);
  const parsedBytes = sizeMatch ? Number(sizeMatch[1]) : void 0;
  const contentType = (sizeMatch ? metadata.slice(sizeMatch[0].length) : metadata).trim();
  return {
    body: bodyBytes.toString("utf8"),
    bodyBytes,
    contentType: contentType || void 0,
    headerBytes: Number.isSafeInteger(parsedBytes) ? parsedBytes : void 0,
    metadataFound: true
  };
}
function splitResponseHeaders(bodyBytes, headerBytes) {
  if (headerBytes === void 0 || !Number.isSafeInteger(headerBytes) || headerBytes <= 0) {
    return { body: bodyBytes.toString("utf8") };
  }
  if (headerBytes > bodyBytes.length) {
    return { body: bodyBytes.toString("utf8") };
  }
  const terminator = bodyBytes.subarray(Math.max(0, headerBytes - 4), headerBytes).toString("latin1");
  if (!terminator.endsWith("\r\n\r\n") && !terminator.endsWith("\n\n")) {
    return { body: bodyBytes.toString("utf8") };
  }
  const body = bodyBytes.subarray(headerBytes).toString("utf8");
  const capped = headerBytes > LIMITS.MAX_HEADER_TEXT_BYTES;
  const sliceEnd = capped ? LIMITS.MAX_HEADER_TEXT_BYTES : headerBytes;
  const headerText = bodyBytes.subarray(0, sliceEnd).toString("utf8").replace(/\r?\n\r?\n$/, "");
  if (!headerText) return { body };
  return { headerText, body, headerBytesReceived: headerBytes, truncated: capped };
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
function formatResponse(stdout, stderr, exitCode, includeMetadata, fileSaveInfo, responseHeaders, headerInfo) {
  const plainNotice = !includeMetadata && headerInfo ? [
    headerInfo.truncated ? `[mcp-curl] response headers truncated at ${LIMITS.MAX_HEADER_TEXT_BYTES} of ${headerInfo.bytesReceived} bytes` : null,
    headerInfo.undetermined ? "[mcp-curl] response header boundary undetermined; headers are NOT separated from the body below" : null
  ].filter(Boolean).join("\n") : "";
  const withNotice = (text) => plainNotice ? `${plainNotice}

${text}` : text;
  if (fileSaveInfo?.savedToFile && fileSaveInfo.filepath) {
    if (includeMetadata) {
      const output = {
        success: exitCode === 0,
        exit_code: exitCode,
        saved_to_file: true,
        filepath: fileSaveInfo.filepath,
        message: fileSaveInfo.message ?? "Response saved to file. Read the file to access contents."
      };
      if (responseHeaders) output.headers = responseHeaders;
      if (responseHeaders && headerInfo?.truncated) {
        output.headers_truncated = true;
        output.header_bytes_received = headerInfo.bytesReceived;
      }
      if (headerInfo?.undetermined) output.headers_undetermined = true;
      if (stderr) output.stderr = stderr;
      return JSON.stringify(output, null, 2);
    }
    const message = fileSaveInfo.message ?? `Response saved to: ${fileSaveInfo.filepath}`;
    return withNotice(responseHeaders ? `${responseHeaders}

${message}` : message);
  }
  if (includeMetadata) {
    const output = {
      success: exitCode === 0,
      exit_code: exitCode,
      response: stdout
    };
    if (responseHeaders) output.headers = responseHeaders;
    if (responseHeaders && headerInfo?.truncated) {
      output.headers_truncated = true;
      output.header_bytes_received = headerInfo.bytesReceived;
    }
    if (headerInfo?.undetermined) output.headers_undetermined = true;
    if (stderr) output.stderr = stderr;
    return JSON.stringify(output, null, 2);
  }
  return withNotice(responseHeaders ? `${responseHeaders}

${stdout}` : stdout);
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
      const ch = filter[i];
      if (UNSUPPORTED_KEY_CHARS.has(ch)) {
        throw new Error(
          `Invalid jq_filter "${filter}": unsupported jq syntax ${JSON.stringify(ch)} at position ${i}. This filter supports paths only: .key, .[n], .[n:m], .["key"], and comma-separated paths. Pipes, object construction, and functions (e.g. "| {id}", "map(...)", "select(...)") are not supported.`
        );
      }
      key += ch;
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
  const iterateIndex = tokens.findIndex((t) => t.type === "iterate");
  if (iterateIndex !== -1 && iterateIndex !== tokens.length - 1) {
    throw new Error(
      `Invalid jq_filter "${filter}": "[]" cannot be followed by further path segments. This filter does not support jq's iterate-and-project (e.g. ".items[].id"); use an explicit index (".items[0].id") or a slice (".items[0:20]") instead.`
    );
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
    return JSON.stringify(result, null, 2) ?? "null";
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

// src/lib/response/strip-blocks.ts
var IMAGE_REMOVED_PLACEHOLDER = "[image removed]";
var LINK_REMOVED_PLACEHOLDER = "[link removed]";
var STRIP_PATH_MAX_BYTES = 256 * 1024;
var STRIP_FIXED_POINT_MAX_ITERATIONS = FIXED_POINT_MAX_ITERATIONS;
var HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;
var SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>[\s\S]*?(?:<\/\s*script\b[^>]*>|$)/gi;
var STYLE_BLOCK_PATTERN = /<style\b[^>]*>[\s\S]*?(?:<\/\s*style\b[^>]*>|$)/gi;
var MARKDOWN_EXTERNAL_IMAGE_PATTERN = /!\[[^\]\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;
var MARKDOWN_EXTERNAL_LINK_PATTERN = /(?<!!)\[[^\]\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;
var MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN = /!\[[^\]\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;
var MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN = /(?<!!)\[[^\]\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;
var MARKDOWN_DANGEROUS_SCHEME_RESIDUAL_PATTERN = /(?<=\])\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;
function decodeNumericHtmlEntities(input) {
  return input.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, body) => {
    const cp = body[0] === "x" || body[0] === "X" ? Number.parseInt(body.slice(1), 16) : Number.parseInt(body, 10);
    if (!Number.isInteger(cp) || cp < 0 || cp > 1114111 || cp >= 55296 && cp <= 57343) {
      return "";
    }
    return String.fromCodePoint(cp);
  });
}
function stripBlocksFixedPoint(input, options = {}) {
  const { decodeEntities = true } = options;
  if (Buffer.byteLength(input, "utf8") > STRIP_PATH_MAX_BYTES) return input;
  let curr = input;
  for (let i = 0; i < STRIP_FIXED_POINT_MAX_ITERATIONS; i++) {
    const decoded = decodeEntities ? decodeNumericHtmlEntities(curr) : curr;
    const next = decoded.replace(SCRIPT_BLOCK_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
    if (next === curr) return next;
    curr = next;
  }
  return curr;
}
function stripHtmlComments(input) {
  return input.replace(HTML_COMMENT_PATTERN, "");
}
function stripMarkdownBeacons(input) {
  return input.replace(MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER).replace(MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER).replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER).replace(MARKDOWN_EXTERNAL_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER).replace(MARKDOWN_DANGEROUS_SCHEME_RESIDUAL_PATTERN, "");
}
var MARKUP_SHAPE_PATTERN = /<(?:!doctype\b|html\b|svg\b|script\b|style\b|iframe\b|\?xml\b|[a-z][a-z0-9-]{0,16}[\s>/])/i;
function looksLikeMarkupShape(content) {
  return MARKUP_SHAPE_PATTERN.test(content);
}

// src/lib/response/processor.ts
function defendText(text, options) {
  let content = text;
  const { hostname, contentTypeUndetermined = false, decodeEntities = true } = options;
  const looksLikeJsonBody = content.trimStart().startsWith("{") || content.trimStart().startsWith("[");
  const strictestGrammar = contentTypeUndetermined && !looksLikeJsonBody;
  const isMarkup = strictestGrammar || supportsMarkupComments(options.contentType);
  const isMarkdown = strictestGrammar || isMarkdownContentType(options.contentType);
  content = sanitizeAndDetect(content, hostname);
  const exceedsStripCap = Buffer.byteLength(content, "utf8") > STRIP_PATH_MAX_BYTES;
  const sniffedAsMarkup = !exceedsStripCap && !strictestGrammar && !looksLikeJsonBody && isSniffableContentType(options.contentType) && looksLikeMarkupShape(content);
  const needsStripPath = isMarkup || isMarkdown || sniffedAsMarkup;
  if (needsStripPath && !exceedsStripCap) {
    content = stripHtmlComments(content);
    content = stripBlocksFixedPoint(content, { decodeEntities });
    if (isMarkdown) {
      content = stripMarkdownBeacons(content);
    }
    content = sanitizeAndDetect(content, hostname);
  }
  return content;
}
async function processResponse(response, options) {
  if (typeof response !== "string") {
    throw new TypeError("processResponse: response must be a string");
  }
  const rawBytes = Buffer.byteLength(response, "utf8");
  if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
    throw new Error(
      `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
    );
  }
  const hostname = safeHostname(options.url);
  let content = defendText(response, {
    contentType: options.contentType,
    contentTypeUndetermined: options.contentTypeUndetermined,
    hostname
  });
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
    content = sanitizeAndDetect(content, hostname);
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

// src/lib/response/post-processor.ts
import { randomUUID as randomUUID2 } from "crypto";
var WRAPPED = /* @__PURE__ */ Symbol("mcp-curl.wrapped");
function hasOwnWrappedTag(result) {
  try {
    return Object.hasOwn(result, WRAPPED) && result[WRAPPED] === true;
  } catch {
    return false;
  }
}
function isWrappedResult(result) {
  if (result === null || typeof result !== "object") return false;
  return hasOwnWrappedTag(result);
}
function tag(result) {
  if (hasOwnWrappedTag(result)) return result;
  try {
    Object.defineProperty(result, WRAPPED, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false
    });
  } catch {
  }
  return result;
}
function processTextPart(part, hostname, requestId) {
  if (part === null || typeof part !== "object") return part;
  const contentPart = part;
  let type;
  let text;
  try {
    type = contentPart.type;
    text = contentPart.text;
  } catch {
    return part;
  }
  if (type !== "text" || typeof text !== "string") return part;
  const sanitised = sanitizeAndDetect(text, hostname);
  const finalText = requestId ? applySpotlighting(sanitised, requestId) : sanitised;
  try {
    return { ...contentPart, text: finalText };
  } catch {
    return part;
  }
}
function createWrapper(config) {
  return function wrap(result, hostname) {
    if (result === null || typeof result !== "object") return result;
    if (isWrappedResult(result)) return result;
    try {
      if (!Array.isArray(result.content)) return tag(result);
      const requestId = config.enableSpotlighting && !result.isError ? randomUUID2() : void 0;
      const newContent = result.content.map(
        (part) => processTextPart(part, hostname, requestId)
      );
      return tag({ ...result, content: newContent });
    } catch (err) {
      logWrapError(hostname, err);
      return tag(result);
    }
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
  - include_headers (boolean): Report response headers. With include_metadata they
    arrive under a separate "headers" key; without it they are prefixed to the returned
    text followed by a blank line, so that result is NOT JSON-parseable. On both
    branches headers never reach the saved file and never reach jq_filter, which is
    what makes this safe to combine with save_to_file and jq_filter. Header text is
    capped at 64KB; truncation is reported via headers_truncated
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
    "response": string (the body alone \u2014 headers are NOT in here),
    "headers": string (response header text; present only with include_headers),
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
    let headerTruncated = false;
    let headerBytesReceived;
    const parsed = parseResponseWithMetadata(result.stdoutBytes, metadataSeparator);
    const { contentType, headerBytes, metadataFound } = parsed;
    let responseHeaders;
    let headersUndetermined = false;
    let body = parsed.body;
    if (params.include_headers) {
      const split = splitResponseHeaders(parsed.bodyBytes, headerBytes);
      body = split.body;
      headersUndetermined = split.headerText === void 0;
      if (split.headerText) {
        const defended = defendText(split.headerText, {
          contentType: MARKDOWN_MIME,
          hostname: safeHostname(params.url),
          decodeEntities: false
        });
        const inlineCeiling = Math.min(
          LIMITS.MAX_HEADER_TEXT_BYTES,
          params.max_result_size ?? LIMITS.DEFAULT_MAX_RESULT_SIZE
        );
        responseHeaders = Buffer.byteLength(defended, "utf8") > inlineCeiling ? Buffer.from(defended, "utf8").subarray(0, inlineCeiling).toString("utf8") : defended;
        headerTruncated = split.truncated === true || Buffer.byteLength(defended, "utf8") > inlineCeiling;
        headerBytesReceived = split.headerBytesReceived;
      }
    }
    if (headersUndetermined && (params.save_to_file || params.jq_filter)) {
      throw new Error(
        "Response header boundary could not be determined, so the body cannot be separated from the header block. Refusing save_to_file/jq_filter rather than writing or filtering unseparated bytes. Retry without include_headers to operate on the raw response."
      );
    }
    const processed = await processResponse(body, {
      url: params.url,
      jqFilter: params.jq_filter,
      maxResultSize: params.max_result_size,
      saveToFile: params.save_to_file,
      contentType,
      contentTypeUndetermined: !metadataFound,
      outputDir: validatedOutputDir
    });
    const defendedStderr = result.stderr ? defendText(result.stderr, {
      contentType: MARKDOWN_MIME,
      hostname: safeHostname(params.url),
      decodeEntities: false
    }) : result.stderr;
    const output = formatResponse(
      processed.content,
      defendedStderr,
      result.exitCode,
      params.include_metadata,
      {
        savedToFile: processed.savedToFile,
        filepath: processed.savedToFile ? processed.filepath : void 0,
        message: processed.message
      },
      responseHeaders,
      {
        truncated: headerTruncated,
        bytesReceived: headerBytesReceived,
        // The caller asked for headers and provably did not get them.
        // Reporting it is the point: silence is what made the pre-fix
        // corruption invisible, because the degraded path returned bytes
        // indistinguishable from the success path.
        undetermined: params.include_headers && headersUndetermined
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
    const hostname = safeHostname(params.url);
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
  createConfigError,
  resolveBaseUrl,
  createHttpOnlyUrlSchema,
  safeHostname,
  LIMITS,
  parsePort,
  MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH,
  sanitizeDescription,
  sanitizeResponse,
  detectInjectionPattern,
  applySpotlighting,
  SESSION,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  PRINTABLE_ASCII,
  safeStringCompare,
  isValidSessionId,
  SERVER,
  applyDefaultHeaders,
  JQ_QUERY_HOSTNAME_LABEL,
  CUSTOM_TOOL_HOSTNAME_LABEL,
  getOrCreateTempDir,
  cleanupOrphanedTempDirs,
  cleanupTempDir,
  validateFilePath,
  logInjectionDetected,
  sanitizeAndDetect,
  startInjectionCleanup,
  stopInjectionCleanup,
  startWrapErrorCleanup,
  stopWrapErrorCleanup,
  resolveOutputDir,
  validateOutputDir,
  CurlExecuteSchema,
  JqQuerySchema,
  createSafeFilenameBase,
  applyJqFilter,
  createWrapper,
  CURL_EXECUTE_TOOL_META,
  executeCurlRequest,
  registerCurlExecuteTool
};
