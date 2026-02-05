// src/lib/security/index.ts
// Security module barrel export

export {
    isLocalhostAllowed,
    resolveDns,
    validateUrlAndResolveDns,
} from "./ssrf.js";

export {
    checkRateLimits,
    startRateLimitCleanup,
    stopRateLimitCleanup,
    // Note: clearRateLimitMaps intentionally not exported here (test-only).
    // Tests should import directly from "./rate-limiter.js" if needed.
} from "./rate-limiter.js";

export {
    isValidSessionId,
    validateNoCRLF,
    safeStringCompare,
} from "./input-validation.js";

export {
    validateFilePath,
    // Note: clearAllowedDirsCache intentionally not exported here (test-only).
    // Tests should import directly from "./file-validation.js" if needed.
} from "./file-validation.js";
