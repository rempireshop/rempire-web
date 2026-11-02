/**
 * A PDF from a link, read on the server (src/lib/pdf-text.ts) — the text a
 * material keeps when Renat's Claude saves a brand's PDF by its address
 * (Dim, 02.11.2026: «PDFs and images at a URL included»). The files are made
 * here with pdf-lib: one with the standard Helvetica (a simple font, WinAnsi),
 * one with the shop's own Golos Text embedded (a Type0 font with a ToUnicode
 * map — how InDesign and every modern exporter write Cyrillic).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { glyphToText, pageHeading, parseToUnicode, PDF_TEXT_LIMITS, pdfPages, PdfTextError, _test } from "@/lib/pdf-text";

const GOLOS = readFileSync(fileURLToPath(new URL("../public/fonts/GolosText-Regular.ttf", import.meta.url)));

async function latinPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  p1.drawText("ANGEL.WASH", { x: 60, y: 780, size: 28, font });
  p1.drawText("Shampoo for fine, coloured hair.", { x: 60, y: 700, size: 12, font });
  p1.drawText("Apply to wet hair, then rinse.", { x: 60, y: 684, size: 12, font });
  doc.addPage([595, 842]);   // a photo page: no text at all
  const p3 = doc.addPage([595, 842]);
  p3.drawText("HYDRATE-ME.WASH", { x: 60, y: 780, size: 28, font });
  p3.drawText("Moisturising shampoo for dry hair.", { x: 60, y: 700, size: 12, font });
  return doc.save();
}

async function cyrillicPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(GOLOS, { subset: true });
  const p = doc.addPage([595, 842]);
  p.drawText("УВЛАЖНЕНИЕ", { x: 60, y: 780, size: 26, font });
  p.drawText("Шампунь для сухих волос: мягко очищает и увлажняет.", { x: 60, y: 700, size: 12, font });
  // two runs on one line, a gap between them: one line, a space between the words
  p.drawText("Применение:", { x: 60, y: 680, size: 12, font });
  p.drawText("нанести на влажные волосы.", { x: 160, y: 680, size: 12, font });
  // …and a run that starts where the one before it ends is the same word
  p.drawText("Kevin", { x: 60, y: 660, size: 12, font });
  p.drawText(".Murphy", { x: 60 + font.widthOfTextAtSize("Kevin", 12), y: 660, size: 12, font });
  return doc.save();
}

describe("a PDF's text, read on the server", () => {
  it("reads a simple-font PDF page by page, each page's heading, and skips a page with no text", async () => {
    const got = await pdfPages(await latinPdf());
    expect(got.pageCount).toBe(3);
    expect(got.pages.map((p) => p.n)).toEqual([1, 3]);
    expect(got.pages[0]).toEqual({
      n: 1, heading: "ANGEL.WASH",
      text: "ANGEL.WASH\nShampoo for fine, coloured hair.\nApply to wet hair, then rinse.",
    });
    expect(got.pages[1].heading).toBe("HYDRATE-ME.WASH");
  });

  it("reads Cyrillic through the font's ToUnicode map, and keeps two runs of one line as one line", async () => {
    const got = await pdfPages(await cyrillicPdf());
    expect(got.pages).toHaveLength(1);
    expect(got.pages[0].heading).toBe("УВЛАЖНЕНИЕ");
    const lines = got.pages[0].text.split("\n");
    expect(lines[1]).toBe("Шампунь для сухих волос: мягко очищает и увлажняет.");
    expect(lines[2]).toBe("Применение: нанести на влажные волосы.");
    expect(lines[3]).toBe("Kevin.Murphy");
  });

  it("refuses what is not a PDF, a PDF with no words, and a broken one — with a code, never with nonsense", async () => {
    const code = async (b: Uint8Array) => { try { await pdfPages(b); return "ok"; } catch (e) { return (e as PdfTextError).code; } };
    expect(await code(Buffer.from("<html><body>not a pdf</body></html>"))).toBe("not_pdf");
    const blank = await PDFDocument.create();
    blank.addPage();
    expect(await code(await blank.save())).toBe("no_text");
    expect(await code(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF"))).not.toBe("ok");
  });

  it("parses a ToUnicode map: bfchar, both kinds of bfrange, and the code length its codespace declares", () => {
    const cmap = parseToUnicode(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      2 beginbfchar <0003> <0020> <0024> <0410> endbfchar
      2 beginbfrange <0025> <0027> <0431> <0030> <0031> [<0044> <0045>] endbfrange`);
    expect(cmap.bytes).toBe(2);
    expect([3, 0x24, 0x25, 0x26, 0x27, 0x30, 0x31].map((c) => cmap.map.get(c))).toEqual([" ", "А", "б", "в", "г", "D", "E"]);
    expect(parseToUnicode("1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <0058> endbfchar").bytes).toBe(1);
  });

  it("turns glyph names into letters: Latin, uniXXXX and the afii Cyrillic names", () => {
    expect(["a", "Z", "space", "hyphen", "uni0416", "u1F600", "afii10017", "afii10023", "afii10049", "afii10065", "afii10071", "afii10097", "nonsense"].map(glyphToText))
      .toEqual(["a", "Z", " ", "-", "Ж", "😀", "А", "Ё", "Я", "а", "ё", "я", ""]);
  });

  it("takes the heading the way the panel does: capitals first, then the first line with a word", () => {
    expect(pageHeading(["12", "HYDRATE-ME.WASH", "Shampoo"])).toBe("HYDRATE-ME.WASH");
    expect(pageHeading(["Наша миссия", "текст"])).toBe("Наша миссия");
    expect(pageHeading(["", "1"])).toBe("");
  });

  it("lexes strings with escapes and hex, and skips an inline image whole", () => {
    const lex = new _test.Lexer("(a\\(b\\)\\101) <48 49> BI /W 2 ID \u0001\u0002EI binary EI Q", { tokens: 100 });
    const toks = [];
    for (let t = lex.next(); t; t = lex.next()) {
      if (t.t === "op" && t.v === "BI") { lex.skipInlineImage(); continue; }
      toks.push(t);
    }
    expect(toks).toEqual([{ t: "str", v: "a(b)A" }, { t: "str", v: "HI" }, { t: "op", v: "Q" }]);
  });
});

/* A PDF comes from a stranger's address: a small file must not unpack into
   gigabytes, nor a font table into millions of loop steps (security review of
   3c035572, 02.11.2026). */
describe("a hostile PDF stays inside its limits", () => {
  it("does not inflate a Flate stream past the document's byte budget", async () => {
    const doc = await PDFDocument.create();
    const bomb = deflateSync(Buffer.alloc(8 * 1024 * 1024));
    const s = PDFRawStream.of(doc.context.obj({ Filter: "FlateDecode" }) as PDFDict, bomb);
    const budget = { tokens: 1000, bytes: 64 * 1024 };
    const t0 = Date.now();
    expect(_test.streamText(s, budget)).toBe("");
    expect(budget.bytes).toBe(64 * 1024);
    expect(Date.now() - t0).toBeLessThan(2000);
    // a stream inside the budget still reads, and is charged to it
    const ok = PDFRawStream.of(doc.context.obj({ Filter: "FlateDecode" }) as PDFDict, deflateSync(Buffer.from("BT (Hi) Tj ET")));
    expect(_test.streamText(ok, budget)).toBe("BT (Hi) Tj ET");
    expect(budget.bytes).toBe(64 * 1024 - 13);
  });

  it("refuses a file whose object streams unpack past the budget, before pdf-lib opens them", () => {
    const huge = deflateSync(Buffer.alloc(PDF_TEXT_LIMITS.decoded + 1024 * 1024));
    const head = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${huge.length} >>\nstream\n`, "latin1");
    const tail = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
    const file = new Uint8Array(Buffer.concat([head, huge, tail]));
    expect(() => _test.checkObjectStreams(file, { tokens: 1, bytes: PDF_TEXT_LIMITS.decoded })).toThrow(PdfTextError);
    return expect(pdfPages(file)).rejects.toMatchObject({ code: "broken" });
  });

  it("charges wide ToUnicode ranges and W widths to one step budget", async () => {
    const t0 = Date.now();
    const lines = Array.from({ length: 2000 }, () => "<0000> <FFFF> <0041>").join("\n");
    const { map } = parseToUnicode(`1 begincodespacerange <0000> <FFFF> endcodespacerange\n2000 beginbfrange\n${lines}\nendbfrange`);
    expect(map.size).toBeLessThanOrEqual(PDF_TEXT_LIMITS.cmapSteps);

    const doc = await PDFDocument.create();
    const W = doc.context.obj(Array.from({ length: 3000 }, () => [0, 65535, 500]).flat());
    const desc = doc.context.obj({ Type: "Font", Subtype: "CIDFontType2", W });
    const font = doc.context.obj({ Type: "Font", Subtype: "Type0", DescendantFonts: [desc] }) as PDFDict;
    const info = _test.fontInfo(font, { tokens: 1000, bytes: 1024 });
    expect(info.widths(10)).toBe(500);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
