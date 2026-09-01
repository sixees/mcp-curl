// src/lib/utils/index.ts
// Utilities module barrel export

export {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
} from "./error.js";

export { resolveBaseUrl, createHttpOnlyUrlSchema, safeHostname } from "./url.js";
export type { CreateHttpOnlyUrlSchemaOptions } from "./url.js";

export {
    isBinaryContentType,
    isMarkdownContentType,
    MARKDOWN_MIME,
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
} from "./sanitize.js";
