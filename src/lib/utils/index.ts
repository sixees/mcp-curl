// src/lib/utils/index.ts
// Utilities module barrel export

export {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
    assertPositiveInteger,
    LOCAL_REFUSAL_CODES,
    LocalRefusalError,
    formatLocalRefusal,
} from "./error.js";
export type { LocalRefusalCode, LocalRefusalReason, LocalRefusal } from "./error.js";

// `rawJson` is deliberately absent — see `json-lexeme.ts`.
export { isRawNumber, keepNumberLexeme } from "./json-lexeme.js";
export {
    resolveBaseUrl,
    resolveRequestUrl,
    hasDotSegment,
    RELATIVE_PATH_PATTERN,
    createHttpOnlyUrlSchema,
    safeHostname,
} from "./url.js";
export type { CreateHttpOnlyUrlSchemaOptions, ResolvedRequestUrl } from "./url.js";

export {
    isBinaryContentType,
    isMarkdownContentType,
    MARKDOWN_MIME,
    JSON_MIME,
    isSniffableContentType,
    parseMimeType,
    supportsMarkupComments,
} from "./content-type.js";

export {
    sanitizeDescription,
    sanitizeResponse,
    detectInjectionPattern,
    applySpotlighting,
    isSpotlightEnvelope,
    SPOTLIGHT_SENTINEL_PREFIX,
    MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH,
    MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH,
} from "./sanitize.js";
