// src/lib/utils/url.ts
// URL resolution utilities

import { z } from "zod";
import { isAllowedUrlScheme } from "../config/security/url-schemes.js";
import { baseUrlHost } from "../config/security/host-policy.js";

/**
 * Strip trailing slash from a base URL and prepend it to a path,
 * ensuring the path has a leading slash.
 */
export function resolveBaseUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}

/** C0 controls and DEL, as a character-class body. */
const URL_CONTROL_CLASS = "\\x00-\\x1f\\x7f";

/**
 * A C0 control character or DEL, anywhere in a URL bound for cURL.
 *
 * A WHATWG parser silently strips tab, CR and LF. `executeCurlRequest` hands
 * the SSRF gate and cURL the same parsed `href`, so a URL carrying one would
 * be requested as something other than what was written; it is refused rather
 * than silently rewritten. Every check refusing control bytes in such a URL is
 * built from this one class.
 */
export const URL_CONTROL_CHARACTER = new RegExp(`[${URL_CONTROL_CLASS}]`);

/**
 * A path that may stand in for an absolute URL on a server with a `baseUrl`:
 * one leading `/`, never `//` or `/\`, and no {@link URL_CONTROL_CHARACTER}
 * anywhere.
 *
 * A WHATWG parser reads a leading `//` or `/\` as scheme-relative — a host, not
 * a path.
 */
export const RELATIVE_PATH_PATTERN = new RegExp(`^/(?![/\\\\])[^${URL_CONTROL_CLASS}]*$`);

/**
 * Whether the path part of `path` — everything before the first `?` or `#` —
 * holds a `.` or `..` segment, literal or percent-encoded in any case.
 *
 * The SSRF gate's WHATWG parse and cURL both resolve such a segment, so
 * `/users/..` requests the parent of `/users/`, and so does `/users/%2e%2e`.
 * Segments split on `\` as well, which WHATWG reads as `/` in an http(s) URL. A
 * dot that is not a whole segment — `/v1.2/`, `/.well-known/`, `/a..b`,
 * `?filter=user.name` — cannot traverse and passes.
 */
export function hasDotSegment(path: string): boolean {
    const pathPart = path.split(/[?#]/, 1)[0];
    return pathPart.split(/[/\\]/).some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
}

/** The outcome of {@link resolveRequestUrl}. */
export type ResolvedRequestUrl =
    | { ok: true; url: string }
    | { ok: false; error: string };

/**
 * Resolve a request `url` against the configured `baseUrl`.
 *
 * Without a `baseUrl`, everything comes back unchanged. With one:
 * - input beginning `/` or `\` is a relative path. It is joined if it matches
 *   {@link RELATIVE_PATH_PATTERN} and has no {@link hasDotSegment} segment, and
 *   refused otherwise, never passed on: a parser would read it as a host, or
 *   resolve it outside the path a caller built it under;
 * - anything else — an absolute URL — comes back unchanged. `baseUrl` is not a
 *   host restriction, and the executor's SSRF gate checks what it receives. Nor
 *   is its path checked for dot-segments: it names its own path, so it has no
 *   prefix to climb out of.
 *
 * The join is {@link resolveBaseUrl}'s concatenation, never `new URL(path,
 * base)`, which honours `//host`. Once the base parses as an absolute http(s)
 * URL, appending a single-slash path cannot move its authority, so that parse
 * is the whole guard on the join. No error echoes a value: the input is
 * attacker-chosen on the tool path, and the base may carry credentials.
 */
export function resolveRequestUrl(baseUrl: string | undefined, url: string): ResolvedRequestUrl {
    if (!baseUrl || !/^[/\\]/.test(url)) return { ok: true, url };
    if (!RELATIVE_PATH_PATTERN.test(url)) {
        return {
            ok: false,
            error: "Error: a relative url must start with a single / and contain no control characters; a leading // or \\ names a host, not a path",
        };
    }
    if (hasDotSegment(url)) {
        return {
            ok: false,
            error: "Error: a relative url must not contain a . or .. path segment (literal or %2e-encoded); it would resolve outside the path it was built from",
        };
    }

    // Everything that can throw is inside the try: the caller runs this before
    // the wrap, so a throw would reach the model unwrapped (invariant 1).
    try {
        if (baseUrlHost(baseUrl) !== undefined) {
            return { ok: true, url: resolveBaseUrl(baseUrl, url) };
        }
    } catch {
        // Falls through to the refusal below.
    }
    return {
        ok: false,
        error: "Error: cannot resolve a relative url: the configured baseUrl is not an absolute http(s) URL",
    };
}

/**
 * Options for `createHttpOnlyUrlSchema`.
 */
export interface CreateHttpOnlyUrlSchemaOptions {
    /**
     * Caller-facing description registered with Zod's `.describe()`. Surfaced to
     * MCP clients via `globalRegistry`, so phrase it in terms of *what the URL
     * is for* (e.g. "Base URL of the API"), not in terms of the scheme rule —
     * the scheme rule is enforced by this helper and shouldn't leak into every
     * call-site description.
     */
    description?: string;
    /**
     * Custom validation error message returned when the URL parses but uses a
     * disallowed scheme. Defaults to "URL must use http or https scheme".
     */
    message?: string;
}

/**
 * Create a Zod schema for a URL restricted to the http/https allowlist.
 *
 * Strict HTTP/HTTPS-only by design — the allowlist is the single source of
 * truth in `config/security/url-schemes.ts`, shared with the DNS layer
 * (`security/ssrf.ts`) and the cURL transport (`execution/curl-args-builder.ts`).
 * **Do not relax this helper to add `mailto:`, `data:`, etc. under pressure.**
 * If a different allowlist is ever needed, add a separate
 * `createUrlSchemaWithSchemes(allowedSchemes, options)` factory rather than
 * widening the strict default — defence-in-depth across three layers depends
 * on this list staying narrow.
 *
 * Validation logic:
 * - `z.url()` accepts any WHATWG-valid URL (including `javascript:`, `data:`,
 *   `ftp://`); the `.refine()` is the sole scheme enforcement at the schema
 *   layer.
 * - Uses the WHATWG URL parser (matching `security/ssrf.ts` and Node fetch),
 *   so a URL that string-splits to "http:" but parses to a different scheme
 *   cannot pass the schema and surprise the SSRF check.
 *
 * **Defense-in-depth, not invariant equivalence.** This helper is one of three
 * independent enforcement points (schema → DNS/SSRF → cURL `--proto`); each
 * is sufficient on its own to reject a non-http(s) request. The layers share
 * the `ALLOWED_URL_SCHEMES` allowlist, but they do not share representation —
 * for example, WHATWG canonicalises IPv4-mapped IPv6 hosts to compressed hex
 * (`[::ffff:7f00:1]`), so the SSRF blocklist must normalise that form before
 * pattern-matching against the dotted-quad rules. If a future change moves
 * one layer to a different parser or representation, the others must continue
 * to hold the line.
 *
 * Return type is pinned to `z.ZodType<string>` rather than the inferred
 * `ZodURL` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * **Build the schema once at module load and reuse the reference.** Each
 * invocation constructs a new schema and registers it with Zod's
 * `globalRegistry` (via `.describe()`). That registry holds schemas weakly, so
 * a per-request call does not leak, but it repeats the construction on every
 * request for an identical result.
 *
 * @param options - Optional configuration for the schema's caller-visible text.
 * @param options.description - Forwarded to Zod's `.describe()`. Becomes the
 *   JSON Schema `"description"` field that LLM clients render in tool input
 *   docs. Should describe what the URL is *for*; the http(s) constraint is
 *   enforced by the helper itself and shouldn't leak into every call-site
 *   description. Defaults to `"URL (http or https)"`.
 * @param options.message - Validation error message returned when the URL
 *   parses but uses a disallowed scheme. Defaults to
 *   `"URL must use http or https scheme"`.
 * @returns A Zod schema (`z.ZodType<string>`) accepting only http/https URLs.
 *   URL-format failures emit `"Must be a valid URL"`; scheme-rejection failures
 *   emit `options.message`.
 */
export function createHttpOnlyUrlSchema(
    options: CreateHttpOnlyUrlSchemaOptions = {}
): z.ZodType<string> {
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

/**
 * Extract a hostname from a URL string, or `fallback` (default: "unknown")
 * when the URL is malformed or missing. Never throws, so an error path keeps a
 * stable log label without a URL-parse failure shadowing the original error.
 * `executeCurlRequest` also reads it for the host-list check, passing `""` so
 * an unparseable URL is told apart from a real host and left to the SSRF gate.
 *
 * Pure: depends only on its inputs.
 */
export function safeHostname(url: string | undefined, fallback = "unknown"): string {
    if (!url) return fallback;
    try {
        return new URL(url).hostname || fallback;
    } catch {
        return fallback;
    }
}

/**
 * The port a parsed http(s) URL connects to: its explicit port, else the
 * scheme's default. WHATWG drops a port equal to the default, so `url.port` is
 * empty for both "no port" and ":443" on https, and both mean 443.
 *
 * Pure: depends only on its input.
 */
export function effectivePort(url: URL): number {
    if (url.port) return parseInt(url.port, 10);
    return url.protocol === "https:" ? 443 : 80;
}
