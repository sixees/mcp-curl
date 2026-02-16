import {defineConfig} from "tsup";
import {readFileSync} from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
    entry: {
        "index": "src/index.ts",
        "lib": "src/lib.ts",
        "lib/index": "src/lib/index.ts",
        "lib/schema/index": "src/lib/schema/index.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    clean: true,
    dts: true,
    splitting: true,
    sourcemap: false,
    external: [
        "express",
        "zod",
        "@modelcontextprotocol/sdk",
        "js-yaml",
    ],
    define: {
        "__PACKAGE_VERSION__": JSON.stringify(pkg.version),
    },
});
