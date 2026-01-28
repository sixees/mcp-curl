export declare const MAX_RESPONSE_SIZE = 10000000;
export declare const DEFAULT_MAX_RESULT_SIZE = 500000;
export declare const MAX_TOTAL_RESPONSE_MEMORY = 100000000;
export declare const ERROR_PREVIEW_LENGTH = 200;
export declare const MAX_METADATA_TAIL_LENGTH = 200;
export declare const SERVER_NAME = "curl-mcp-server";
export declare const SERVER_VERSION = "1.1.5";
export declare const DEFAULT_TIMEOUT = 30000;
export declare const TEMP_DIR_PREFIX = "mcp-curl-";
export declare const ORPHAN_DIR_MIN_AGE_MS = 3600000;
export declare const FILENAME_MAX_LENGTH = 50;
export declare const WINDOWS_RESERVED_BASENAMES: ReadonlyArray<string>;
/** Check if a name is a Windows reserved basename (case-insensitive) */
export declare function isWindowsReservedBasename(name: string): boolean;
export declare const MAX_SESSIONS = 100;
export declare const SESSION_IDLE_TIMEOUT_MS = 3600000;
export declare const SESSION_CLEANUP_INTERVAL_MS = 300000;
export declare const MAX_REQUESTS_PER_HOST_PER_MINUTE = 60;
export declare const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 300;
export declare const RATE_LIMIT_WINDOW_MS = 60000;
export declare const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10000;
export declare const STDIO_CLIENT_ID = "__stdio_client__";
export declare const MAX_JQ_FILTER_LENGTH = 500;
export declare const MAX_JQ_TOKENS = 50;
export declare const MAX_JQ_FILTERS = 20;
export declare const MAX_JQ_PARSE_TIME_MS = 100;
export declare const MAX_JQ_QUERY_FILE_SIZE = 10000000;
export declare const UUID_REGEX: RegExp;
export declare const OUTPUT_DIR_ENV_VAR = "MCP_CURL_OUTPUT_DIR";
export declare const ALLOW_LOCALHOST_ENV_VAR = "MCP_CURL_ALLOW_LOCALHOST";
export declare const HTTP_AUTH_TOKEN_ENV_VAR = "MCP_AUTH_TOKEN";
/** Check if a hostname matches any blocked pattern (internal networks, reserved TLDs, etc.) */
export declare function isBlockedHostname(hostname: string): boolean;
/** Check if a hostname is a localhost variant */
export declare function isLocalhostHostname(hostname: string): boolean;
/** Check if an IP address matches any blocked pattern (private networks, link-local, etc.) */
export declare function isBlockedIp(ip: string): boolean;
/** Check if an IP address is a localhost address */
export declare function isLocalhostIp(ip: string): boolean;
export declare const MIN_UNPRIVILEGED_PORT = 1024;
/** Check if a port is allowed for localhost connections (80, 443, or >1024) */
export declare function isAllowedLocalhostPort(port: number): boolean;
