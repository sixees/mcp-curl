// src/lib/tools/executor-call-sites.test.ts
// Every path into executeCurlRequest passes a host policy, so no in-library caller falls back to "any"

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dirname, "..", "..");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (!entry.name.endsWith(".ts")) return [];
        if (/\.test\.ts$|\.test-fixture\.ts$/.test(entry.name)) return [];
        return [path];
    });
}

/** The text between the `(` at `open` and its matching `)`. */
function argumentText(source: string, open: number): string {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if ("([{".includes(source[i])) depth++;
        else if (")]}".includes(source[i]) && --depth === 0) return source.slice(open + 1, i);
    }
    throw new Error("unbalanced call");
}

/** Split a call's argument text at its top-level commas. */
function topLevelArguments(text: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if ("([{".includes(text[i])) depth++;
        else if (")]}".includes(text[i])) depth--;
        else if (text[i] === "," && depth === 0) {
            args.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(text.slice(start).trim());
    return args.filter((arg) => arg !== "");
}

/**
 * The `extra` argument of the call opening at `open`, as an object literal. An
 * identifier is followed to its `const` initialiser in the same file.
 */
function extraLiteral(source: string, open: number): string | undefined {
    const extra = topLevelArguments(argumentText(source, open))[1];
    if (extra === undefined) return undefined;
    if (extra.startsWith("{")) return extra;
    const declaration = new RegExp(`const ${extra}\\b[^=]*=\\s*\\{`).exec(source);
    if (!declaration) return undefined;
    const brace = declaration.index + declaration[0].length - 1;
    return `{${argumentText(source.slice(0, brace) + "(" + source.slice(brace + 1), brace)}}`;
}

/** Whether the call opening at `open` passes a `hostPolicy` that is not `undefined`. */
function passesHostPolicy(source: string, open: number): boolean {
    const extra = extraLiteral(source, open);
    return extra !== undefined && /\bhostPolicy\s*:\s*(?!undefined\b)\S/.test(extra);
}

/** Every call to `callee` in `source`, by the index of its opening parenthesis. */
function callsOf(source: string, callee: string): number[] {
    const pattern = new RegExp(`(?<!function\\s)\\b${callee}\\(`, "g");
    return [...source.matchAll(pattern)].map((match) => match.index + match[0].length - 1);
}

describe("executeCurlRequest call sites", () => {
    const files = sourceFiles(SRC).map((path) => ({
        path: relative(SRC, path),
        source: readFileSync(path, "utf8"),
    }));

    it("reach executeCurlRequest only by a direct call or by handing it to executeWithHooks", () => {
        const unaccounted = files.flatMap(({ path, source }) =>
            source
                .split("\n")
                .filter((line) => /\bexecuteCurlRequest\b/.test(line))
                .filter((line) => !/^\s*(\/?\*|\/\/)/.test(line))
                // An import, or a member of a multi-line export list.
                .filter((line) => !/^\s*(import|export)\b|^\s*executeCurlRequest,?$/.test(line))
                .filter((line) => !/\bexecuteCurlRequest\(/.test(line))
                .filter((line) => !/^\s*executor: executeCurlRequest,$/.test(line))
                .map((line) => `${path}: ${line.trim()}`)
        );
        expect(unaccounted).toEqual([]);
    });

    it("every direct call passes a defined hostPolicy", () => {
        const calls = files.flatMap(({ path, source }) =>
            callsOf(source, "executeCurlRequest").map((open) => ({ path, ok: passesHostPolicy(source, open) }))
        );
        expect(calls.map((call) => call.path).sort()).toEqual([
            "lib/extensible/instance-utilities.ts",
            "lib/schema/generator.ts",
        ]);
        expect(calls.filter((call) => !call.ok)).toEqual([]);
    });

    it("executeWithHooks passes a defined hostPolicy to its executor", () => {
        const hookExecutor = files.find(({ path }) => path === "lib/extensible/hook-executor.ts")!;
        const calls = callsOf(hookExecutor.source, "executor");
        expect(calls).toHaveLength(1);
        expect(passesHostPolicy(hookExecutor.source, calls[0])).toBe(true);
    });

    // The checker itself, against calls that must fail it.
    it.each([
        ["no extra", "executeCurlRequest(params);"],
        ["an extra without hostPolicy", "executeCurlRequest(params, { allowLocalhost: true });"],
        ["hostPolicy: undefined", "executeCurlRequest(params, { hostPolicy: undefined });"],
        ["an identifier whose literal lacks it", "const extra = { sessionId };\nexecuteCurlRequest(params, extra);"],
    ])("refuses a call with %s", (_label, source) => {
        const calls = callsOf(source, "executeCurlRequest");
        expect(calls).toHaveLength(1);
        expect(passesHostPolicy(source, calls[0])).toBe(false);
    });

    it("accepts a call whose extra identifier carries a hostPolicy", () => {
        const source = "const extra: X = { a: f(1), hostPolicy: policy };\nexecuteCurlRequest({ url }, extra);";
        expect(passesHostPolicy(source, callsOf(source, "executeCurlRequest")[0])).toBe(true);
    });
});
