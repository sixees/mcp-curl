// src/lib/utils/error.ts
// Error handling utilities

/**
 * Safely extract an error message from an unknown error value.
 * Handles both Error objects and arbitrary thrown values.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * Create a validation error with consistent formatting.
 *
 * @param field - The field or value being validated (e.g., "filepath", "array index")
 * @param reason - Why validation failed
 * @param suggestion - Optional suggestion for fixing the issue
 *
 * @example
 * createValidationError("filepath", "path traversal detected", "Provide a direct path without '..' components")
 * // Error: Invalid filepath: path traversal detected. Provide a direct path without '..' components.
 */
export function createValidationError(field: string, reason: string, suggestion?: string): Error {
    let message = `Invalid ${field}: ${reason}.`;
    if (suggestion) {
        message += ` ${suggestion}`;
        if (!suggestion.endsWith(".")) {
            message += ".";
        }
    }
    return new Error(message);
}

/**
 * Create an access denied error with consistent formatting.
 *
 * @param action - What was being attempted (e.g., "Requests to localhost")
 * @param reason - Why access was denied
 *
 * @example
 * createAccessError("Requests to localhost", "blocked by default")
 * // Error: Requests to localhost are not allowed: blocked by default.
 */
export function createAccessError(action: string, reason: string): Error {
    return new Error(`${action} are not allowed: ${reason}.`);
}

/**
 * Create a file-related error with consistent formatting.
 *
 * @param filepath - The file path that caused the error
 * @param reason - What went wrong (e.g., "does not exist", "is not readable")
 *
 * @example
 * createFileError("/path/to/file.json", "does not exist")
 * // Error: File "/path/to/file.json" does not exist.
 */
export function createFileError(filepath: string, reason: string): Error {
    return new Error(`File "${filepath}" ${reason}.`);
}

/**
 * Create a configuration/environment variable error with consistent formatting.
 *
 * `value` is sanitised before interpolation: CR, LF, and NUL bytes are
 * replaced with their visible escape forms (`\r`, `\n`, `\0`) so a
 * misconfigured operator value cannot forge log lines on stderr. Callers
 * pass a raw environment value (the output-directory path) as well as
 * redaction markers, so this is the guard on that value, not only a backstop.
 *
 * @param configName - The config or env var name (e.g., "MCP_CURL_OUTPUT_DIR")
 * @param value - The invalid value, OR a redaction marker like `[redacted]` /
 *   `[length=N]` for entropy-bearing inputs (auth tokens, secrets) that must
 *   never be echoed in operator logs.
 * @param reason - Why the value is invalid
 *
 * @example
 * createConfigError("MCP_CURL_OUTPUT_DIR", "/invalid/path", "directory does not exist")
 * // Error: Invalid MCP_CURL_OUTPUT_DIR value "/invalid/path": directory does not exist.
 *
 * @example
 * createConfigError("MCP_AUTH_TOKEN", "[redacted]", "must contain only printable ASCII")
 * // Error: Invalid MCP_AUTH_TOKEN value "[redacted]": must contain only printable ASCII.
 */
export function createConfigError(configName: string, value: string, reason: string): Error {
    const safeValue = value
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\0/g, "\\0");
    return new Error(`Invalid ${configName} value "${safeValue}": ${reason}.`);
}

/**
 * Throw unless `value` is an integer of at least 1.
 *
 * Takes `unknown` because config objects reach the library from untyped
 * JavaScript, where a string `"240"` is the likely mistake.
 *
 * @example
 * assertPositiveInteger("maxSessions", 0)
 * // Error: maxSessions must be a positive integer, got: 0
 */
export function assertPositiveInteger(name: string, value: unknown): asserts value is number {
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new Error(`${name} must be a positive integer, got: ${String(value)}`);
    }
}

/**
 * The closed set of codes a local refusal carries: a request this server
 * refused before cURL sent it. A model reads "no request was sent" as "a retry
 * costs the upstream nothing", so a refusal partway through a redirect chain,
 * where requests were sent, has its own code and its own first line.
 */
export const LOCAL_REFUSAL_CODES = [
    "LOCAL_REFUSED_PATH",
    "LOCAL_RATE_LIMITED",
    "LOCAL_HOST_NOT_ALLOWED",
    "LOCAL_REDIRECT_REFUSED",
] as const;
export type LocalRefusalCode = (typeof LOCAL_REFUSAL_CODES)[number];

/**
 * The one sentence after the first line, by reason. Each is server-authored
 * and names no host, URL, `Location` or header value: the text reaches the
 * model, and a remote chooses those values (RC-30). Slash-free, so
 * `sanitizeErrorMessage`'s path rewrite leaves it alone.
 */
export const LOCAL_REFUSAL_REASONS = {
    "host-not-allowed": "The target host is not in this server's allowedHosts list.",
    "address-blocked": "The redirect target failed this server's address check: it is blocked by SSRF protection or did not resolve.",
    "rate-limited": "The rate limit for this target or session is exhausted; wait before retrying.",
    "redirect-limit": "The redirect chain reached max_redirects.",
    "unusable-redirect-target": "The redirect target is not a usable http(s) URL.",
    "path-names-host": "A relative url that starts with two slashes or a backslash names a host, not a path; start it with a single forward slash.",
    "path-control-character": "A relative url must not contain control characters, which a URL parser would strip or a header would carry.",
    "path-dot-segment": "A relative url must not contain a . or .. path segment, literal or percent-encoded; it would resolve outside the path it was built from.",
    "path-parameter-dot-segment": "A path parameter must not be . or ..; it would resolve outside the endpoint's path.",
} as const;
export type LocalRefusalReason = keyof typeof LOCAL_REFUSAL_REASONS;

/**
 * The reasons each code may carry. A redirect hop can be refused for any of
 * the hop checks, so `LOCAL_REDIRECT_REFUSED` takes those; a relative path is
 * refused for any of the shapes `resolveRequestUrl` will not join, and a YAML
 * tool's path parameter for a dot-segment. Typed per code so a contradictory
 * pair does not compile.
 */
export const LOCAL_REFUSAL_CODE_REASONS = {
    LOCAL_REFUSED_PATH: ["path-names-host", "path-control-character", "path-dot-segment", "path-parameter-dot-segment"],
    LOCAL_RATE_LIMITED: ["rate-limited"],
    LOCAL_HOST_NOT_ALLOWED: ["host-not-allowed"],
    LOCAL_REDIRECT_REFUSED: [
        "host-not-allowed",
        "address-blocked",
        "rate-limited",
        "redirect-limit",
        "unusable-redirect-target",
    ],
} as const satisfies { readonly [C in LocalRefusalCode]: readonly LocalRefusalReason[] };

type ReasonFor<C extends LocalRefusalCode> = (typeof LOCAL_REFUSAL_CODE_REASONS)[C][number];
type NothingSentCode = Exclude<LocalRefusalCode, "LOCAL_REDIRECT_REFUSED">;

/**
 * What a refusal says: `requestsSent` exists only where requests were sent.
 * `retryAfterSeconds` is the server's own count of seconds until the rate
 * limit admits again, so it exists only on the codes a rate limit produces.
 */
export type LocalRefusal =
    | {
          [C in NothingSentCode]: {
              readonly code: C;
              readonly reason: ReasonFor<C>;
              readonly requestsSent?: never;
              readonly retryAfterSeconds?: C extends "LOCAL_RATE_LIMITED" ? number : never;
          };
      }[NothingSentCode]
    | {
          [R in ReasonFor<"LOCAL_REDIRECT_REFUSED">]: {
              readonly code: "LOCAL_REDIRECT_REFUSED";
              readonly reason: R;
              readonly requestsSent: number;
              readonly retryAfterSeconds?: R extends "rate-limited" ? number : never;
          };
      }[ReasonFor<"LOCAL_REDIRECT_REFUSED">];

const nothingSent = (refusal: LocalRefusal) => `Refused locally: no request was sent (${refusal.code}).`;

/** The first line, by code. One entry per member of {@link LOCAL_REFUSAL_CODES}. */
export const LOCAL_REFUSAL_FIRST_LINES: { readonly [C in LocalRefusalCode]: (refusal: LocalRefusal) => string } = {
    LOCAL_REFUSED_PATH: nothingSent,
    LOCAL_RATE_LIMITED: nothingSent,
    LOCAL_HOST_NOT_ALLOWED: nothingSent,
    LOCAL_REDIRECT_REFUSED: (refusal) => {
        const sent = refusal.code === "LOCAL_REDIRECT_REFUSED" ? refusal.requestsSent : 0;
        return `Redirect refused locally: ${sent} request(s) were sent; hop ${sent + 1} was not (LOCAL_REDIRECT_REFUSED).`;
    },
};

/** The model-facing text of a refusal: the first line, the reason, then any wait. */
export function formatLocalRefusal(refusal: LocalRefusal): string {
    const text = `${LOCAL_REFUSAL_FIRST_LINES[refusal.code](refusal)} ${LOCAL_REFUSAL_REASONS[refusal.reason]}`;
    return refusal.retryAfterSeconds === undefined ? text : `${text} Retry in ${refusal.retryAfterSeconds} s.`;
}

/**
 * A refusal this server made locally: a request refused before cURL sent it,
 * or, as `LOCAL_REDIRECT_REFUSED`, a redirect hop refused after `requestsSent`
 * requests went out. The message is {@link formatLocalRefusal}'s text, so
 * whatever reads it reads that.
 */
export class LocalRefusalError extends Error {
    readonly code: LocalRefusalCode;
    readonly reason: LocalRefusalReason;
    readonly requestsSent: number;
    readonly retryAfterSeconds?: number;

    constructor(refusal: LocalRefusal) {
        if (refusal.code === "LOCAL_REDIRECT_REFUSED" && !(Number.isInteger(refusal.requestsSent) && refusal.requestsSent >= 1)) {
            throw new TypeError("LOCAL_REDIRECT_REFUSED needs requestsSent, a positive integer");
        }
        // The figure lands in model-facing text, so it is held to the shape
        // the sentence promises rather than trusted.
        if (refusal.retryAfterSeconds !== undefined && !(Number.isInteger(refusal.retryAfterSeconds) && refusal.retryAfterSeconds >= 1)) {
            throw new TypeError("retryAfterSeconds must be a positive integer");
        }
        super(formatLocalRefusal(refusal));
        this.name = "LocalRefusalError";
        this.code = refusal.code;
        this.reason = refusal.reason;
        this.requestsSent = refusal.code === "LOCAL_REDIRECT_REFUSED" ? refusal.requestsSent : 0;
        this.retryAfterSeconds = refusal.retryAfterSeconds;
    }
}
