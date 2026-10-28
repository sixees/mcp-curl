// src/lib/config/security/index.ts
// Security configuration barrel export

export {
    isBlockedHostname,
    isLocalhostHostname,
    isBlockedIp,
    isLocalhostIp,
    isAllowedLocalhostPort,
    MIN_UNPRIVILEGED_PORT,
} from "./ssrf.js";

export {
    UUID_REGEX,
    WINDOWS_RESERVED_BASENAMES,
    isWindowsReservedBasename,
    PRINTABLE_ASCII,
    HTTP_FIELD_NAME,
} from "./validation.js";

export {
    isBlockedSystemDirectory,
    createBlockedDirectoryError,
} from "./blocked-dirs.js";

export {
    ALLOWED_URL_SCHEMES,
    ALLOWED_URL_SCHEMES_CURL_FLAG,
    isAllowedUrlScheme,
} from "./url-schemes.js";

export {
    ANY_HOST_POLICY,
    canonicalHost,
    baseUrlHost,
    parseAllowedHosts,
    deriveHostPolicy,
    isHostAllowed,
} from "./host-policy.js";
export type { HostPolicy } from "./host-policy.js";
