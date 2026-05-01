import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import { createHttpOnlyUrlSchema, resolveBaseUrl, safeHostname } from "./url.js";

describe("resolveBaseUrl", () => {
    it("strips trailing slash from base and joins with path", () => {
        expect(resolveBaseUrl("https://api.example.com/", "/users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("handles base without trailing slash", () => {
        expect(resolveBaseUrl("https://api.example.com", "/users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("adds leading slash to path if missing", () => {
        expect(resolveBaseUrl("https://api.example.com", "users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("handles base with trailing slash and path without leading slash", () => {
        expect(resolveBaseUrl("https://api.example.com/", "users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("preserves path with query params", () => {
        expect(resolveBaseUrl("https://api.example.com", "/search?q=test")).toBe(
            "https://api.example.com/search?q=test"
        );
    });

    it("handles nested base paths", () => {
        expect(resolveBaseUrl("https://api.example.com/v2/", "/users")).toBe(
            "https://api.example.com/v2/users"
        );
    });

    it("handles empty path", () => {
        expect(resolveBaseUrl("https://api.example.com", "/")).toBe(
            "https://api.example.com/"
        );
    });
});

describe("safeHostname", () => {
    it("returns hostname for a valid URL", () => {
        expect(safeHostname("https://api.example.com/foo/bar")).toBe("api.example.com");
    });

    it("returns hostname stripped of port", () => {
        expect(safeHostname("https://api.example.com:8443/foo")).toBe("api.example.com");
    });

    it("returns default fallback for malformed URL", () => {
        expect(safeHostname("not-a-url")).toBe("unknown");
    });

    it("returns default fallback for undefined", () => {
        expect(safeHostname(undefined)).toBe("unknown");
    });

    it("returns default fallback for empty string", () => {
        expect(safeHostname("")).toBe("unknown");
    });

    it("returns custom fallback when provided", () => {
        expect(safeHostname("not-a-url", "no-host")).toBe("no-host");
        expect(safeHostname(undefined, "no-host")).toBe("no-host");
    });

    it("does not throw for inputs WHATWG URL would reject", () => {
        // Each call must return the fallback rather than propagate a TypeError.
        expect(() => safeHostname("javascript:alert(1)")).not.toThrow();
        expect(() => safeHostname("://broken")).not.toThrow();
    });
});

describe("createHttpOnlyUrlSchema", () => {
    const schema = createHttpOnlyUrlSchema({ description: "test url" });

    describe("accepts valid http(s) URLs", () => {
        it("accepts http://example.com", () => {
            expect(schema.safeParse("http://example.com").success).toBe(true);
        });

        it("accepts https://example.com", () => {
            expect(schema.safeParse("https://example.com").success).toBe(true);
        });

        it("accepts https URLs with path and query", () => {
            expect(schema.safeParse("https://example.com/path?query=1").success).toBe(true);
        });

        it("accepts IPv6 hosts (embedded colons must not confuse the parser)", () => {
            // Regression guard: the previous .split(":")[0] form parsed this as the
            // scheme "https" and host "[", which still passed by accident. The WHATWG
            // parser treats the brackets correctly — protocol is "https:".
            expect(schema.safeParse("https://[::1]/").success).toBe(true);
        });
    });

    describe("rejects non-http(s) schemes", () => {
        it("rejects ftp:", () => {
            expect(schema.safeParse("ftp://example.com").success).toBe(false);
        });

        it("rejects file:", () => {
            expect(schema.safeParse("file:///etc/passwd").success).toBe(false);
        });

        it("rejects data:", () => {
            expect(schema.safeParse("data:text/plain;base64,SGVsbG8=").success).toBe(false);
        });

        it("rejects javascript:", () => {
            expect(schema.safeParse("javascript:alert(1)").success).toBe(false);
        });

        it("rejects vbscript:", () => {
            // Legacy IE script scheme — same exfiltration class as javascript:.
            expect(schema.safeParse("vbscript:msgbox(1)").success).toBe(false);
        });

        it("rejects look-alike scheme httpx:", () => {
            // The previous .split(":")[0] form would have classified the scheme as
            // "httpx" and rejected; the parser-based form classifies as "httpx:" and
            // rejects too. Asserted explicitly to lock the behaviour.
            expect(schema.safeParse("httpx://example.com").success).toBe(false);
        });

        it("rejects upper-cased disallowed schemes (FTP://)", () => {
            // WHATWG normalises scheme to lowercase, so "FTP" parses to protocol
            // "ftp:" and the allowlist comparison catches it. Locks the
            // case-insensitive behaviour against future regressions.
            expect(schema.safeParse("FTP://example.com").success).toBe(false);
        });

        it("rejects URLs with leading whitespace before a disallowed scheme", () => {
            // WHATWG strips leading C0/whitespace; a string like "  ftp://x"
            // parses as ftp: rather than failing parse. The refine must still
            // reject.
            expect(schema.safeParse("  ftp://example.com").success).toBe(false);
        });
    });

    describe("rejects malformed inputs", () => {
        it("rejects an empty string", () => {
            expect(schema.safeParse("").success).toBe(false);
        });

        it("rejects a non-URL string", () => {
            expect(schema.safeParse("not-a-url").success).toBe(false);
        });

        it("rejects double-colon parser quirks", () => {
            // The WHATWG parser will throw or return a strange protocol on this input;
            // the .split(":")[0] form would silently classify scheme as "https" and
            // pass. Asserted to lock the parser-based rejection.
            expect(schema.safeParse("https::").success).toBe(false);
        });
    });

    describe("options bag", () => {
        it("defaults description to 'URL (http or https)' when not provided", () => {
            const defaulted = createHttpOnlyUrlSchema();
            expect(defaulted.description).toBe("URL (http or https)");
        });

        it("uses the caller-supplied description", () => {
            const labelled = createHttpOnlyUrlSchema({ description: "Webhook target" });
            expect(labelled.description).toBe("Webhook target");
        });

        it("uses the caller-supplied error message on scheme rejection", () => {
            const customMsg = createHttpOnlyUrlSchema({ message: "must be http(s)" });
            const result = customMsg.safeParse("ftp://example.com");
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((i) => i.message === "must be http(s)")).toBe(true);
            }
        });
    });

    describe("public type stability", () => {
        it("returns z.ZodType<string> (pinned for forward-compat with Zod minor bumps and Standard Schema migration)", () => {
            // Compile-time assertion: the inferred output is `string`.
            // This locks the public surface so a future Zod patch that reshapes
            // .refine() (or the MCP SDK 2.0 Standard Schema migration) cannot
            // silently change what consumers see.
            type Inferred = z.infer<ReturnType<typeof createHttpOnlyUrlSchema>>;
            expectTypeOf<Inferred>().toEqualTypeOf<string>();
        });
    });
});
