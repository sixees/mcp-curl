// src/lib/response/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatResponse, plainBranchNotices } from "./formatter.js";

const HEADERS = "HTTP/2 200 \r\ncontent-type: application/json\r\nx-records: 8";

describe("formatResponse — response headers", () => {
    it("omits the headers section entirely when none are supplied", () => {
        expect(formatResponse('{"id":1}', "", 0, false)).toBe('{"id":1}');
    });

    it("does NOT prefix the body with headers — they are their own content entry", () => {
        // The header text is never prefixed onto the body: two remote-controlled
        // regions sharing one string let a marker in the body pair with one in a
        // later field and delete what lies between (`LESSONS.md` RC-16).
        //
        // `tools/curl-execute.ts` emits the header text as a second MCP content
        // entry instead — ARCHITECTURE.md invariant 13's strong form, applied at
        // the output. This function returns the body alone.
        const out = formatResponse('{"id":1}', "", 0, false, undefined, HEADERS);
        expect(out).toBe('{"id":1}');
        expect(out).not.toContain("HTTP/2 200");
    });

    it("returns the save message alone on the plain branch, headers separated out", () => {
        // Header text never reaches the file: the save message is returned
        // alone, with headers reported as a second content entry (see above).
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
        // The notice text is never carried in this string: prefixing it to the
        // body would demote a JSON body to `defendForInline`'s undivided arm,
        // which splices markers across fields. `plainBranchNotices` builds it and
        // `tools/curl-execute.ts` emits it as its own MCP entry — a stronger
        // boundary than an in-band prefix. `LESSONS.md` RC-46.
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

describe("plainBranchNotices — the lossy-decode notice names the right subject", () => {
    it("points at the returned text when the body was inlined", () => {
        const notice = plainBranchNotices(0, undefined, { decodeWasLossy: true });
        expect(notice).toContain("not valid UTF-8");
        expect(notice).toContain("the text above is not byte-identical");
    });

    it("does NOT claim 'the text above' when the body went to a file", () => {
        // Two server-authored statements were contradicting each other in one
        // response. On a saved branch `content[0]` is the save message and there
        // is no inline body for "the text above" to name — and where the
        // sanitise was a no-op the artefact holds the origin's own octets, so
        // `savedMessage` says "the file holds the origin's exact bytes" while
        // this notice said the opposite about the same response.
        //
        // The decode is still reported: it is what the byte count was taken on.
        const notice = plainBranchNotices(0, undefined, {
            decodeWasLossy: true,
            savedToFile: true,
        });
        expect(notice).toContain("not valid UTF-8");
        expect(notice).not.toContain("the text above");
        expect(notice).not.toContain("not byte-identical");
        expect(notice).toContain("saved file's own message states which bytes it holds");
    });

    it("says nothing at all when the decode was clean", () => {
        // The third value: without this, a notice that fired unconditionally
        // would satisfy both cases above.
        expect(plainBranchNotices(0, undefined, { decodeWasLossy: false })).toBe("");
        expect(plainBranchNotices(0, undefined, undefined)).toBe("");
    });
});
