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
