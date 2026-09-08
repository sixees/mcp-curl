// src/lib/tools/curl-execute.json-passthrough.test.ts
// `docs/todos/018`'s acceptance criteria, at the outermost boundary a real input
// reaches.
//
// **At `executeCurlRequest` rather than beside `defendForInline`**, because
// every one of these is a property of the COMPOSITION and a direct assertion on
// the defence cannot see it. Measured on this branch: `defendForInline` returned
// a JSON body byte-exact while the shipped path still rewrote it, because
// `formatResponse` prefixed the header block and the wrap's undivided scan ran
// over the join. A unit test on the defence passed throughout.
// `skill: pr-resolver-safety` -> *Where the regression test goes*.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { readFile, rm } from "fs/promises";
import { CurlExecuteSchema } from "../server/schemas.js";
import {
    METADATA_SEPARATOR as SEP,
    curlOutputFor,
    savedPathFrom as sharedSavedPathFrom,
} from "./curl-output.test-fixture.js";

vi.mock("../types/index.js", async () => {
    const actual = await vi.importActual<typeof import("../types/index.js")>("../types/index.js");
    return { ...actual, generateMetadataSeparator: () => SEP };
});

vi.mock("../security/index.js", async () => {
    const actual =
        await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        validateUrlAndResolveDns: vi.fn().mockResolvedValue({
            // Literals, not imported bindings: this factory hoists above every
            // import, so a binding is not initialised yet (RC-35).
            hostname: "example.test",
            resolvedIp: "93.184.216.34",
            port: 443,
        }),
        checkRateLimits: vi.fn(),
    };
});

vi.mock("../execution/index.js", async () => {
    const actual =
        await vi.importActual<typeof import("../execution/index.js")>("../execution/index.js");
    // **`platformSupportsHeaderDump` is pinned:** without it `curl-execute.ts`
    // takes the `headersUnsupported` branch on any non-darwin host, so
    // `responseHeaders` is undefined, only one content entry is emitted, and the
    // two-region cases below fail on a Linux runner. Both sibling suites pin it
    // for the same reason. The assertions it guards are the ones that catch the
    // notice-prefix splice (`LESSONS.md` RC-46).
    return { ...actual, executeCommand: vi.fn(), platformSupportsHeaderDump: () => true };
});

const executionModule = await import("../execution/index.js");
const { executeCurlRequest } = await import("./curl-execute.js");
// `vi.mocked`, not `as Mock` — the bare type erases the signature and leaves
// every fixture in this file unchecked against `CommandResult` (RC-35).
const mockedExecuteCommand = vi.mocked(executionModule.executeCommand);

const params = (p: Record<string, unknown>) => CurlExecuteSchema.parse(p);

const written: string[] = [];
const savedPathFrom = (text: string): string => {
    const path = sharedSavedPathFrom(text);
    written.push(path);
    return path;
};

beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
    await Promise.all(written.map((f) => rm(f, { force: true })));
});

/**
 * The body's slot in the returned content array — entry 0.
 *
 * This calls `executeCurlRequest` directly, so the text here is
 * `processResponse`'s own output, not what the model receives through the
 * shipped path — the wrap is applied by `registerCurlToolWithHooks`, and
 * `register-all-tools.test.ts` is what exercises that boundary.
 */
const bodyOf = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;

async function fetchBody(
    body: string,
    contentType: string,
    extra: Record<string, unknown> = {}
): Promise<string> {
    mockedExecuteCommand.mockResolvedValue(curlOutputFor({ body, contentType }));
    const result = await executeCurlRequest(
        params({ url: "https://example.test/x", ...extra })
    );
    return bodyOf(result);
}

// ---------------------------------------------------------------------------
// AC 1 — a JSON body is returned byte-identical to what the origin sent.
//
// Every case here is a documented loss of the round trip this todo removed, and
// each has its own RC. They are asserted as one list because the property is
// one property: no re-serialisation happened.
// ---------------------------------------------------------------------------
describe("018 AC1 — a JSON body survives byte for byte", () => {
    const cases: Array<[string, string]> = [
        // RC-31: `JSON.parse` keeps the LAST duplicate name. Unfixable while the
        // body is re-serialised, and the P1 of this todo: a tool contracted to
        // return an API's data returned different data.
        ["duplicate name", '{"total":5,"total":9}'],
        // RC-24, RC-27, RC-29: needed `keepNumberLexeme` to survive at all.
        ["integer past MAX_SAFE_INTEGER", '{"id":9223372036854775807}'],
        ["overflowing exponent", '{"n":1e400}'],
        // **A NUMBER, not a string.** `"1.50"` in quotes is ordinary string
        // content that any round trip preserves, so the case could not fail
        // however the body was re-serialised — it discriminated nothing. The
        // lexeme is only at risk unquoted, where `JSON.parse` yields 1.5 and a
        // re-serialising defence emits `1.5`. `keepNumberLexeme` is what keeps
        // the trailing zero, and this is the case that measures it.
        ["trailing-zero decimal", '{"price":1.50}'],
        // Key order was declined as harmless while it still happened; now it
        // cannot happen, so it is pinned.
        ["key order", '{"z":1,"m":2,"a":3}'],
        ["non-ASCII keys", '{"ключ":"значение","日本":"語"}'],
        // **Escaped, because that is the only form that reaches a parser.** An
        // unescaped lone surrogate in this source becomes U+FFFD the moment the
        // fixture encodes it to a Buffer, so an unescaped form would test the
        // encoder rather than the defence. `JSON.parse` tolerates the escape and
        // a re-serialising defence would re-emit it differently — which is the
        // regression this shape is chosen to catch.
        ["escaped lone surrogate", '{"s":"\\ud800"}'],
        // Markup inside a value is legitimate string content in an API payload,
        // and rewriting it was what the strip stages did on this path.
        ["markup inside values", '{"a":"<script>x</script>","b":"<!-- c -->"}'],
        ["nested composite", '{"a":{"b":[1,{"c":"<!--"}]},"d":"-->"}'],
    ];

    // **Both content types, and `text/html` is the one with teeth.**
    // `application/json` is exempt from the strip stages, so `defendText` is a
    // no-op on it and these cases would pass even if the body were re-defended
    // — measured by probe, which failed nothing until this loop was widened.
    // Under `text/html` every stage would run, so any defence pass on the body
    // shows up as moved bytes. Same false green as `LESSONS.md` RC-33's.
    for (const [name, body] of cases) {
        for (const contentType of ["application/json", "text/html"]) {
            it(`returns ${name} unchanged (${contentType})`, async () => {
                expect(await fetchBody(body, contentType)).toBe(body);
            });
        }
    }
});

// ---------------------------------------------------------------------------
// AC 2 — the declared content type selects nothing.
//
// This is invariant 1a's named failure shape closed by construction rather than
// guarded: the header is reported, never consulted. Guarding it produced a P1 in
// each of five review rounds on PR #37.
// ---------------------------------------------------------------------------
describe("018 AC2 — the declared content type selects nothing", () => {
    // Deliberately markup-shaped AND markdown-shaped, so every strip stage has
    // something to remove if any of them still runs.
    const body = '{"note":"<script>a</script> see ![x](https://evil.test/p.gif) <!-- c -->"}';

    for (const contentType of [
        "application/json",
        "text/html",
        "text/markdown",
        "image/png",
        "application/octet-stream",
        "text/plain",
        // Malformed: `MEDIA_TYPE_HEAD` rejects it, so it arrives as `undefined`
        // with `contentTypeUndetermined` still false — the asymmetry
        // `LESSONS.md` RC-31 names. The declared type selects nothing regardless.
        "text/markdown;;",
        // The origin sent none at all.
        "",
    ]) {
        it(`returns the same bytes under ${contentType === "" ? "no content type" : contentType}`, async () => {
            expect(await fetchBody(body, contentType)).toBe(body);
        });
    }
});

// ---------------------------------------------------------------------------
// AC 3, AC 4, AC 5 — the non-JSON arm.
// ---------------------------------------------------------------------------
describe("018 AC3/AC4/AC5 — a non-JSON body is reported, not inlined", () => {
    // AC 4 is the one worth stating twice: V8's parse message embeds up to ten
    // bytes of the body, and the WHOLE body when the body is short. So the
    // secret below is a probe for a real leak channel, not decoration.
    const SECRET = "SUPERSECRET_CANARY_9f3a";

    it("returns no inline body bytes for an HTML error page (AC3), and names the shape (AC4)", async () => {
        const text = await fetchBody(`<html><body>${SECRET}</body></html>`, "text/html");
        expect(text).not.toContain(SECRET);
        expect(text).toContain("looks-like-markup");
        expect(text).toContain("not JSON");
        savedPathFrom(text);
    });

    it("leaks no body bytes through V8's message on a short unparseable body (AC4)", async () => {
        // Measured shape: `JSON.parse('{"a": SUPERSECRET}')` reports
        // `Unexpected token 'S', "{"a": SUPERSECRET}" is not valid JSON` — the
        // entire body, because the body is short.
        const text = await fetchBody(`{"a": ${SECRET}}`, "application/json");
        expect(text).not.toContain(SECRET);
        expect(text).toContain("invalid-syntax");
        savedPathFrom(text);
    });

    it("leaks no body bytes on a truncated body either (AC4)", async () => {
        const text = await fetchBody(`{"a":"${SECRET}`, "application/json");
        expect(text).not.toContain(SECRET);
        savedPathFrom(text);
    });

    // A scalar parses, so it IS JSON: the round trip is a validity check, and
    // what comes back is the payload the origin sent. An endpoint answering
    // `null` for "no record" is the case that made this worth changing — it used
    // to write a file `jq_query` cannot even open, because a top-level scalar has
    // no path to address (`jq/filter.ts` refuses a pathless filter).
    for (const [name, body] of [
        ["null", "null"],
        ["a number", "42"],
        ["a quoted string", '"x"'],
        // Returned as sent, markup and all. The population this proxy serves is
        // internal staff querying their own APIs; a body they asked for is not
        // rewritten on the way back.
        ["a quoted script tag", '"<script>x</script>"'],
    ] as Array<[string, string]>) {
        it(`returns ${name} inline, byte for byte (AC5)`, async () => {
            const text = await fetchBody(body, "application/json");
            expect(text).toBe(body);
            expect(text).not.toContain("saved to:");
        });
    }

    it("reports the byte count and the path, and echoes NO remote token", async () => {
        // **The declared content type is deliberately absent from this
        // sentence.** `docs/todos/018` settles it onto the `include_metadata`
        // JSON field, where the serialiser escapes it; this string is
        // server-authored prose a model reads as ours, so a remote-echoed token
        // inside it is what ARCHITECTURE.md invariant 13 admits only in last
        // position. A first draft interpolated it, and two existing cases in
        // `register-all-tools.test.ts` caught it.
        //
        // **`declared_content_type` is not added by this change**, and nothing
        // regressed: it was never reported on any branch before. It is coupled
        // to `MEDIA_TYPE_HEAD`'s deletion, which is the next slice of 018.
        const body = "<html>nope</html>";
        const text = await fetchBody(body, "text/html");
        expect(text).not.toContain("text/html");
        expect(text).toMatch(/\d+ bytes on disk/);
        expect(text).toContain("read the path with your own tooling");
        savedPathFrom(text);
    });

    it("saves a non-JSON body as the origin's exact bytes, diagnostics intact", async () => {
        // The reason this arm stopped defending the artefact: `stripHtmlComments`
        // deletes the `<!-- trace-id -->` a framework puts its diagnostic in, and
        // that comment is the most useful thing on a 500 page.
        const page = "<html><!-- trace-id: 7f3a91c2 --><h1>Application Error</h1></html>";
        const text = await fetchBody(page, "text/html");
        expect(text).toContain("the origin's exact bytes");
        const onDisk = await readFile(savedPathFrom(text), "utf-8");
        expect(onDisk).toBe(page);
    });

    // The other side of the sentence above. `diskContent` writes the origin's
    // octets only where Step 2 was a no-op; where it removed a codepoint the
    // file is the sanitised text, and claiming exactness there told a reader
    // diffing the file against the origin that a difference was the origin's.
    // Reported by chatgpt-codex-connector and coderabbitai on PR #39.
    it("says the file is NOT byte-identical when Step 2 changed the body", async () => {
        const page = `<html><h1>Application\u200bError</h1></html>`.replace("\\u200b", "\u200b");
        const text = await fetchBody(page, "text/html");
        expect(text).toContain("attack codepoints removed");
        expect(text).not.toContain("the origin's exact bytes");
        // And the file really is the sanitised form, so the sentence is true.
        const onDisk = await readFile(savedPathFrom(text), "utf-8");
        expect(onDisk).not.toBe(page);
        expect(onDisk).toBe(page.replace("\u200b", ""));
    });

    // A Latin-1 body decodes to U+FFFD, still parses as JSON, and used to be
    // returned inline under a byte-for-byte contract with nothing said. The
    // body is still returned — its structure is intact and only a character
    // value moved — but the re-encode is now reported, because U+FFFD from a
    // lossy decode is indistinguishable from U+FFFD an origin actually sent.
    // Reported by chatgpt-codex-connector on PR #39; RC-48's sibling.
    it("reports a lossy UTF-8 decode and still returns the body", async () => {
        // `José` in Latin-1: the 0xE9 byte is not valid UTF-8 on its own.
        const wire = Buffer.concat([
            Buffer.from('{"name":"Jos', "utf8"),
            Buffer.from([0xe9]),
            Buffer.from('","kept":1}', "utf8"),
        ]);
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: wire, contentType: "application/json" })
        );
        const result = await executeCurlRequest(params({ url: "https://example.test/x" }));
        // The body came back, structure intact.
        expect(bodyOf(result)).toContain('"kept":1');
        expect(JSON.parse(bodyOf(result)).kept).toBe(1);
        // And the re-encode is stated rather than left silent, in its own
        // content entry — never mixed into the body's.
        const all = result.content.map((c) => c.text).join("\n");
        expect(all).toContain("not valid UTF-8");
        expect(bodyOf(result)).not.toContain("not valid UTF-8");
    });

    // `options.contentType` is origin-written, and this string is prose a model
    // reads as the server's. The reason comes from the closed vocabulary.
    // Reported by coderabbitai on PR #39.
    it("names the rejection reason in the jq_filter error, never the origin's content type", async () => {
        const text = await fetchBody("<html>nope</html>", "text/html", {
            jq_filter: ".a",
        }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
        expect(text).toContain("looks-like-markup");
        expect(text).not.toContain("text/html");
    });
});

// ---------------------------------------------------------------------------
// The four cases Surface 2 round 1 found in the arms above — each an ordinary
// response from an ordinary API, none of them adversarial.
// ---------------------------------------------------------------------------
describe("018 — the ordinary-response cases round 1 found", () => {
    it("returns an empty body inline and writes NO file (204 / HEAD / 304)", async () => {
        // `empty-body` was taking the save arm, so a `204 No Content` wrote a
        // ZERO-BYTE file and told the model to read it with its own tooling.
        // 018 justifies that arm on recoverability; there is nothing to recover.
        // `LESSONS.md` RC-44.
        const text = await fetchBody("", "");
        expect(text).toBe("");
        expect(text).not.toContain("saved to:");
    });

    it("still honours an explicit save_to_file for an empty body", async () => {
        // The exclusion is about the automatic arm. An explicit request is a
        // request, and silently ignoring it would be the opposite defect.
        const text = await fetchBody("", "", { save_to_file: true });
        expect(text).toContain("saved to:");
        savedPathFrom(text);
    });

    for (const [name, body, filter, expected] of [
        // `.data` rather than `.` — this repo's jq subset requires a path, so
        // `.` is refused by the parser on any body and would test nothing. A
        // path against a scalar yields jq's own answer for an absent path.
        ["null for no-record", "null", ".data", "null"],
        ["a bare string", '"ok"', ".data", "null"],
    ] as Array<[string, string, string, string]>) {
        it(`filters ${name} instead of discarding the response`, async () => {
            // The filter gate was routed through the ARTEFACT gate, which is
            // composite-only — so an endpoint returning `null` for "no record"
            // made `jq_filter` throw, and the throw sits above the save arm, so
            // the body was discarded outright. A filter only needs the body to
            // parse. `LESSONS.md` RC-45.
            const text = await fetchBody(body, "application/json", { jq_filter: filter });
            expect(text).toContain(expected);
        });
    }

    it("does not corrupt a BOM-prefixed JSON body", async () => {
        // `\uFEFF{...}` is what .NET and Java services emit routinely. The gate
        // classified the RAW decode, which does not parse, so the body took the
        // non-JSON arm — and `defendText` then sanitised the BOM away and ran
        // the full strip over what was by then valid JSON, splicing a field out
        // of the only copy. Sanitise now precedes the classification.
        // `LESSONS.md` RC-44.
        const body = '\uFEFF{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}';
        const text = await fetchBody(body, "application/json");
        // Classified as the JSON document it is, so returned inline, BOM gone.
        expect(Object.keys(JSON.parse(text) as object)).toEqual(["a", "b", "c", "d"]);
        expect(text).toContain('"b":"secret"');
        expect(text).not.toContain("\uFEFF");
    });

    it("persists a BOM-prefixed body in a form jq_query can open", async () => {
        // The trap in the fix: raw octets for this class would put a BOM on disk
        // and `applyJqFilter` cannot parse one. Byte-exactness is therefore
        // conditional on Step 2 having been a no-op.
        const body = '\uFEFF{"pad":"' + "z".repeat(600_000) + '","k":"v"}';
        const text = await fetchBody(body, "application/json");
        const onDisk = await readFile(savedPathFrom(text), "utf-8");
        expect(onDisk.startsWith("\uFEFF")).toBe(false);
        expect(() => JSON.parse(onDisk)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// AC 6 — the artefact gate is the same rule as the body gate, and inherits no
// strip cap.
//
// **Both directions, at a size that reaches the save arm**, which is the whole
// point: `parseJsonDocument` returns `undefined` above `STRIP_PATH_MAX_BYTES`
// (262,144) while the default inline cap is 500,000, so the arm where this
// question exists is the arm where `isDefinitelyJson` always answers "not
// JSON". Both cases below fail against that predicate.
// ---------------------------------------------------------------------------
describe("018 AC6 — the artefact gate is the body gate, with no strip cap", () => {
    // **A zero-width space is what makes these two cases able to fail**, and
    // without it neither could. Above `STRIP_PATH_MAX_BYTES` no strip stage runs
    // at all, so at 600 KB the defended text equals the origin text for any
    // benign body — and an assertion comparing them would pass whichever branch
    // the artefact took. Step 2 removes this codepoint at ANY size, so it is the
    // one discriminator available here.
    //
    // That is the same false green the last round of this work recorded: an
    // `application/json` fixture is exempt from the strip stages, so the
    // defended text equalled the origin bytes and the assertion could not tell
    // them apart. Caught by probing, not by reading. `LESSONS.md` RC-33.
    const ZWSP = "\u200b";

    it("persists a 600 KB OBJECT body as the origin's exact octets", async () => {
        // **No ZWSP here any more**, and the reason is the point: Step 2 now runs
        // before the classification, so a body carrying an attack codepoint is
        // deliberately NOT byte-exact — the sanitised form is persisted instead,
        // because raw octets carrying a BOM would be a file `jq_query` cannot
        // open. Byte-exactness is conditional on the sanitise being a no-op,
        // which is true of every legitimate document.
        //
        // Teeth for the artefact gate itself live in the non-UTF-8 case below —
        // for a valid-UTF-8 body the two arms produce identical bytes, so no
        // assertion here can separate them.
        const filler = "x".repeat(600_000);
        const body = `{"pad":"${filler}","dup":1,"dup":2,"big":9223372036854775807}`;
        const text = await fetchBody(body, "application/json");
        const onDisk = await readFile(savedPathFrom(text));
        expect(onDisk.equals(Buffer.from(body, "utf8"))).toBe(true);
        // And the losses a round trip would have caused are simply absent.
        expect(onDisk.toString("utf8")).toContain('"dup":1,"dup":2');
        expect(onDisk.toString("utf8")).toContain("9223372036854775807");
    });

    it("persists a non-UTF-8 JSON body as the exact wire octets", async () => {
        // **This is the case that gives the artefact gate teeth**, and the only
        // one that can. On the JSON arm `content` is the decoded body and the
        // artefact is `responseBytes`, so for a valid-UTF-8 body the two arms
        // produce identical bytes and no assertion can separate them — probe
        // measured exactly that: reverting the gate failed nothing.
        //
        // A raw `0xE9` decodes to U+FFFD, so re-encoding the decode gives
        // `EF BF BD` where the origin sent one byte. `docs/todos/016`'s
        // acceptance criterion 1, finally reachable now that 018 has settled
        // who reads the file.
        const wire = Buffer.concat([
            Buffer.from('{"name":"Jos', "utf8"),
            Buffer.from([0xe9]),
            Buffer.from('","pad":"', "utf8"),
            Buffer.from("z".repeat(600_000), "utf8"),
            Buffer.from('"}', "utf8"),
        ]);
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: wire, contentType: "application/json" })
        );
        const result = await executeCurlRequest(params({ url: "https://example.test/x" }));
        const onDisk = await readFile(savedPathFrom(bodyOf(result)));
        expect(onDisk.equals(wire)).toBe(true);
        // The specific loss this closes: one octet, not three.
        expect(onDisk.includes(Buffer.from([0xe9]))).toBe(true);
        expect(onDisk.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
    });

    it("persists a 600 KB bare string on the JSON arm, sanitised because Step 2 fired", async () => {
        const filler = "y".repeat(600_000);
        const body = `"${filler}a${ZWSP}b"`;
        const text = await fetchBody(body, "application/json");
        // A scalar is JSON, so there is no rejection to report — only the cap.
        expect(text).not.toContain("is not JSON");
        expect(text).toContain("inline limit");
        // **The one case where the artefact is NOT the origin's octets.** Step 2
        // removed the ZWSP, so writing the raw octets would put a byte on disk
        // that the sanitised inline copy does not have.
        const onDisk = await readFile(savedPathFrom(text));
        expect(onDisk.equals(Buffer.from(body, "utf8"))).toBe(false);
        expect(onDisk.toString("utf8")).not.toContain(ZWSP);
    });
});

// ---------------------------------------------------------------------------
// Invariant 13 / 16 — the regions stay separate, and the divider survives.
//
// These are the two routes that re-opened RC-16's splice when the per-leaf walk
// was removed, and each is fixed at a different layer.
// ---------------------------------------------------------------------------
describe("018 — two remote regions, two content entries", () => {
    const spliceable = '{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}';

    it("keeps the body byte-exact and puts header text in its own entry", async () => {
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({
                body: spliceable,
                contentType: "application/json",
                headerBlock: "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n",
            })
        );
        const result = await executeCurlRequest(
            params({
                url: "https://example.test/x",
                include_headers: true,
                include_metadata: false,
            })
        );

        // Body, then header text. No third entry: a clean exit with headers
        // captured produces no notices.
        expect(result.content).toHaveLength(2);
        // The body region: untouched, every field intact. Merged into one entry
        // this returned `{"a":"open ","d":"kept"}` — `b` and `c` deleted, still
        // valid JSON, nothing downstream able to tell.
        expect(result.content[0]!.text).toBe(spliceable);
        expect(Object.keys(JSON.parse(result.content[0]!.text) as object)).toEqual([
            "a",
            "b",
            "c",
            "d",
        ]);
        // The header region: its own entry, and never mixed into the body.
        expect(result.content[1]!.text).toContain("HTTP/1.1 200 OK");
        expect(result.content[0]!.text).not.toContain("HTTP/1.1");
    });

    // -----------------------------------------------------------------------
    // The notice is a THIRD region, and it was the second join in one function.
    // One case per trigger, because each is reached by a different flag — and a
    // missing platform pin silently neutralises either one's coverage.
    // `LESSONS.md` RC-46.
    // -----------------------------------------------------------------------
    for (const [trigger, fixture] of [
        ["non-zero cURL exit", { exitCode: 18 }],
        ["headers requested but none arrived", { headerBlock: "", includeHeaders: true }],
    ] as Array<[string, { exitCode?: number; headerBlock?: string; includeHeaders?: boolean }]>) {
        it(`keeps every key when a notice is present (${trigger})`, async () => {
            const base = curlOutputFor({
                body: spliceable,
                contentType: "application/json",
                ...(fixture.headerBlock === undefined ? {} : { headerBlock: fixture.headerBlock }),
            });
            mockedExecuteCommand.mockResolvedValue({
                ...base,
                ...(fixture.exitCode === undefined ? {} : { exitCode: fixture.exitCode }),
            });
            const result = await executeCurlRequest(
                params({
                    url: "https://example.test/x",
                    include_metadata: false,
                    ...(fixture.includeHeaders ? { include_headers: true } : {}),
                })
            );

            // The body entry is still entry 0 and still parses on its own — the
            // notice cannot have been prefixed to it.
            expect(result.content[0]!.text).toBe(spliceable);
            expect(Object.keys(JSON.parse(result.content[0]!.text) as object)).toEqual([
                "a",
                "b",
                "c",
                "d",
            ]);
            // And the notice really was produced, or this case proves nothing.
            const notice = result.content.find((c) => c.text.startsWith("[mcp-curl]"));
            expect(notice, "no notice was produced, so the case is vacuous").toBeDefined();
        });
    }

    it("emits the notice exactly ONCE on the saved plain branch", async () => {
        // **The fix for the notice prefix introduced this, and no test caught
        // it.** `formatResponse` kept joining the notice to the saved-to-file
        // MESSAGE — sound in itself, since both sides are server-authored — while
        // `curl-execute.ts` also appends the notice entry unconditionally. So on
        // a non-zero exit with a saved body the model received it twice. One
        // rule now: notices travel as their own entry, always. `LESSONS.md` RC-46.
        const base = curlOutputFor({ body: "<html>nope</html>", contentType: "text/html" });
        mockedExecuteCommand.mockResolvedValue({ ...base, exitCode: 18 });
        const result = await executeCurlRequest(
            params({ url: "https://example.test/x", include_metadata: false })
        );
        const occurrences = result.content.filter((c) => c.text.includes("[mcp-curl] cURL exited"));
        expect(occurrences).toHaveLength(1);
        savedPathFrom(result.content[0]!.text);
    });

    it("emits a single entry when no header text was reported", async () => {
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: spliceable, contentType: "application/json" })
        );
        const result = await executeCurlRequest(params({ url: "https://example.test/x" }));
        expect(result.content).toHaveLength(1);
    });
});
