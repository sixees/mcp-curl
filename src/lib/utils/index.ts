// src/lib/utils/index.ts
// Utilities module barrel export

export {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
} from "./error.js";

export { resolveBaseUrl, httpOnlyUrl, safeHostname } from "./url.js";

export { isBinaryContentType, parseMimeType, supportsMarkupComments } from "./content-type.js";

export {
    sanitizeDescription,
    sanitizeResponse,
    detectInjectionPattern,
    applySpotlighting,
    MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH,
} from "./sanitize.js";
