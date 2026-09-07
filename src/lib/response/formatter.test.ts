// src/lib/response/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatResponse, plainBranchNotices } from "./formatter.js";

const HEADERS = "HTTP/2 200 \r\ncontent-type: application/json\r\nx-records: 8";

describe("formatResponse — response headers", () => {
    it("omits the headers section entirely when none are supplied", () => {
        expect(formatResponse('{"id":1}', "", 0, false)).toBe('{"id":1}');
    });

    it("does NOT prefix the body with headers — they are their own content entry", () => {
        // **Reversed by `docs/todos/018`, deliberately.** Prefixing merged two
        // remote-controlled regions into one string, and the wrap's undivided
        // scan then paired a marker in the body with one in a later field and
        // deleted what lay between (`LESSONS.md` RC-16). That was survivable
        // only while the wrap re-serialised each JSON leaf and so neutralised
        // the markers first; 018 removes that round trip to make a JSON body
        // byte-exact, which takes the mitigation with it.
        //
        // `tools/curl-execute.ts` emits the header text as a second MCP content
        // entry instead — ARCHITECTURE.md invariant 13's strong form, applied at
        // the output. This function returns the body alone.
        const out = formatResponse('{"id":1}', "", 0, false, undefined, HEADERS);
        expect(out).toBe('{"id":1}');
        expect(out).not.toContain("HTTP/2 200");
    });

    it("returns the save message alone on the plain branch, headers separated out", () => {
        // Header text still never reaches the file — that guarantee is unchanged
        // and is what this case was originally written for. What changed is where
        // the headers are REPORTED: a second content entry rather than a prefix
        // on this string. See the case above.
        const out = formatResponse("", "", 0, false, {
            savedToFile: true,
            filepath: "/tmp/x.txt",
            message: "Response (11524 bytes) saved to: /tmp/x.txt",
        }, HEADERS);

        expect(out).toBe("Response (11524 bytes) saved to: /tmp/x.txt");
        expect(out).not.toContain("x-records: 8");
    });

    it("still returns the bare message when saved without headers", () => {
        const out = formatResponse("", "", 0, false, {
            savedToFile: true,
            filepath: "/tmp/x.txt",
            message: "saved to: /tmp/x.txt",
        });
        expect(out).toBe("saved to: /tmp/x.txt");
    });

    it("exposes headers as a discrete field under include_metadata", () => {
        const parsed = JSON.parse(
            formatResponse('{"id":1}', "", 0, true, undefined, HEADERS)
        );
        expect(parsed.headers).toBe(HEADERS);
        // The body stays a clean, separately parseable document.
        expect(JSON.parse(parsed.response)).toEqual({ id: 1 });
    });

    it("exposes headers under include_metadata when saved to a file", () => {
        const parsed = JSON.parse(
            formatResponse("", "", 0, true, {
                savedToFile: true,
                filepath: "/tmp/x.txt",
                message: "saved",
            }, HEADERS)
        );
        expect(parsed.headers).toBe(HEADERS);
        expect(parsed.filepath).toBe("/tmp/x.txt");
    });

    it("has no headers key when include_metadata is used without headers", () => {
        const parsed = JSON.parse(formatResponse('{"id":1}', "", 0, true));
        expect(parsed).not.toHaveProperty("headers");
    });
});

describe("formatResponse — header metadata", () => {
    const HDRS = "HTTP/2 200 \r\nx-request-id: abc\r\n";

    it("emits the out-of-band truncation keys under include_metadata", () => {
        const out = JSON.parse(
            formatResponse("body", "", 0, true, undefined, HDRS, {
                truncated: true,
                bytesReceived: 90_000,
            })
        );
        expect(out.headers_truncated).toBe(true);
        expect(out.header_bytes_received).toBe(90_000);
    });

    it("emits headers_undetermined under include_metadata", () => {
        const out = JSON.parse(
            formatResponse("body", "", 0, true, undefined, undefined, { undetermined: true })
        );
        expect(out.headers_undetermined).toBe(true);
    });

    it("omits the keys entirely when nothing degraded", () => {
        // Absence must mean "nothing happened", so it cannot be emitted always.
        const out = JSON.parse(formatResponse("body", "", 0, true, undefined, HDRS, {}));
        expect(out.headers_truncated).toBeUndefined();
        expect(out.header_bytes_received).toBeUndefined();
        expect(out.headers_undetermined).toBeUndefined();
    });

    it("does NOT carry the notice itself — that is a separate content entry", () => {
        // **The notice moved out of this function entirely** (`LESSONS.md`
        // RC-41). Prefixing it to the body demoted a JSON body to
        // `defendForInline`'s undivided arm, which then spliced across two
        // fields. `plainBranchNotices` builds it and `tools/curl-execute.ts`
        // emits it as its own MCP entry, which is a stronger boundary than the
        // unoccupiable position the prefix relied on.
        const out = formatResponse("body", "", 0, false, undefined, HDRS, {
            truncated: true,
            bytesReceived: 90_000,
        });
        expect(out).toBe("body");
        expect(out).not.toContain("[mcp-curl]");
    });

    it("builds the degradation notice separately, so nothing is lost", () => {
        const notice = plainBranchNotices(0, { truncated: true, bytesReceived: 90_000 });
        expect(notice).toContain("[mcp-curl]");
        expect(notice).toContain("truncated");
        // Server-authored and alone in its own entry, so there is no remote text
        // in this string for an origin to hide behind.
        expect(notice.startsWith("[mcp-curl]")).toBe(true);
    });
});
