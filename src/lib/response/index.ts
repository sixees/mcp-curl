// src/lib/response/index.ts
// Response module barrel export

export {
    parseResponseWithMetadata,
    sanitizeErrorMessage,
    type ParsedResponse,
} from "./parser.js";

export {
    extractHeaderChannel,
    type HeaderChannel,
} from "./header-channel.js";

export {
    formatResponse,
    type FileSaveInfo,
} from "./formatter.js";

export {
    createSafeFilenameBase,
    saveResponseToFile,
} from "./file-saver.js";

export {
    defendText,
    defendForInline,
    exceedsInlineCap,
    processResponse,
    type DefendTextOptions,
    type ProcessResponseOptions,
    type ProcessedResponse,
} from "./processor.js";

export {
    createWrapper,
    isWrappedResult,
    type WrapperConfig,
    type WrappableResult,
    type WrappableContentPart,
} from "./post-processor.js";
