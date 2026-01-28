// src/lib/files/index.ts
// Files module barrel export

export {
    getOrCreateTempDir,
    getSharedTempDir,
    cleanupOrphanedTempDirs,
    cleanupTempDir,
} from "./temp-manager.js";

export {
    resolveOutputDir,
    validateOutputDir,
} from "./output-dir.js";
