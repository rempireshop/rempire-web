/**
 * Label PDF repair — Montonio composes the A6 label twice (see
 * src/lib/shipping/label-pdf.ts); the proxy unwraps it. These tests build the
 * same nesting with pdf-lib and check the rewritten page draws the innermost
 * form at the intended size and position.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { labelSlipFor, normaliseLabelPdf, type LabelSlip } from "@/lib/shipping/label-pdf";
import { pdfRuns, pdfText } from "./pdf-text";

const A6 = { w: 297.64, h: 419.51 };
const A4 = { w: 595.28, h: 841.89 };

/** The label itself: an A6 page with a frame and a «barcode» block. */
async function labelPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A6.w, A6.h]);
  page.drawRectangle({ x: 0, y: 0, width: A6.w, height: A6.h, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  page.drawRectangle({ x: 40, y: 60, width: 200, height: 100, color: rgb(0, 0, 0) });
  page.drawText("CC71129", { x: 40, y: 30, size: 14 });
  return doc.save();
}

/** The label laid out on an A4 sheet the way Montonio does it (1.85×). */
async function sheetPdf(label: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [embedded] = await doc.embedPdf(label);
  const page = doc.addPage([A4.w, A4.h]);
  page.drawPage(embedded, { x: 26.7876, y: 33.6756, xScale: 1.85, yScale: 1.85 });
  return doc.save();
}

/** Montonio's actual output: the laid-out sheet embedded once more. */
async function montonioPdf(sheet: Uint8Array, size: "A4" | "A6"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [embedded] = await doc.embedPdf(sheet);
  if (size === "A4") {
    const page = doc.addPage([A4.w, A4.h]);
    page.drawPage(embedded, { x: 26.7876, y: 33.6756, xScale: 1.85, yScale: 1.85 });
  } else {
    const page = doc.addPage([A6.w, 419.53]);
    page.drawPage(embedded, { x: 8.9292, y: 8.3906, xScale: 0.95, yScale: 0.95 });
  }
  return doc.save();
}

type Drawn = { mediaBox: number[]; content: string; formBBox: number[]; formSubtype: string };

/** What the first page of a PDF draws: its box, content and the one form it references. */
async function drawn(bytes: Uint8Array): Promise<Drawn> {
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const page = doc.getPage(0);
  const mediaBox = page.node.MediaBox().asArray().map((n) => Number(n.toString()));
  const contents = page.node.Contents();
  let content = "";
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i, PDFStream));
  } else if (contents) streams.push(contents);
  for (const s of streams) {
    if (s instanceof PDFRawStream) {
      const bytes = s.dict.has(PDFName.of("Filter")) ? decodePDFRawStream(s).decode() : s.contents;
      content += new TextDecoder("latin1").decode(bytes) + "\n";
    }
  }
  const xobjects = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  const entries = xobjects.entries();
  expect(entries.length).toBe(1);
  const ref = entries[0][1] as PDFRef;
  const form = doc.context.lookup(ref) as PDFStream;
  const formBBox = form.dict
    .lookup(PDFName.of("BBox"), PDFArray)
    .asArray()
    .map((n) => Number(n.toString()));
  const formSubtype = form.dict.lookup(PDFName.of("Subtype"), PDFName).asString();
  return { mediaBox, content, formBBox, formSubtype };
}

const near = (a: number, b: number, eps = 0.05) => Math.abs(a - b) <= eps;

describe("normaliseLabelPdf", () => {
  it("draws the innermost A6 form scaled into 10 mm margins on A4", async () => {
    const label = await labelPdf();
    const sheet = await sheetPdf(label);
    const broken = await montonioPdf(sheet, "A4");

    // the broken file really does nest the sheet inside the page
    const before = await drawn(broken);
    expect(before.formBBox[2]).toBeCloseTo(A4.w, 1);
    expect(before.content).toMatch(/1\.85 0 0 1\.85/);

    const fixed = await normaliseLabelPdf(broken, "A4");
    expect(fixed).not.toBeNull();
    const after = await drawn(fixed!);
    expect(after.mediaBox).toEqual([0, 0, A4.w, A4.h]);
    expect(after.formSubtype).toBe("/Form");
    expect(near(after.formBBox[2], A6.w) && near(after.formBBox[3], A6.h)).toBe(true);

    const m = after.content.match(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Label Do Q/);
    expect(m).not.toBeNull();
    const [, sx, sy, x, y] = m!.map(Number);
    expect(sx).toBe(sy);
    // scale fits the width inside 10 mm margins: (595.28 - 56.7) / 297.64
    expect(sx).toBeCloseTo(1.8095, 3);
    // the label sits inside the sheet with the margins around it
    expect(x).toBeGreaterThanOrEqual(28.3);
    expect(x + A6.w * sx).toBeLessThanOrEqual(A4.w - 28.3);
    expect(y).toBeGreaterThanOrEqual(28.3);
    expect(y + A6.h * sy).toBeLessThanOrEqual(A4.h - 28.3);
  });

  it("draws the label 1:1 on an A6 sheet", async () => {
    const broken = await montonioPdf(await sheetPdf(await labelPdf()), "A6");
    const fixed = await normaliseLabelPdf(broken, "A6");
    expect(fixed).not.toBeNull();
    const after = await drawn(fixed!);
    expect(after.mediaBox).toEqual([0, 0, 297.64, 419.53]);
    expect(near(after.formBBox[2], A6.w)).toBe(true);
    expect(after.content).toMatch(/q 1 0 0 1 0 0\.01 cm \/Label Do Q/);
  });

  it("also unwraps a correctly composed file (one level) — idempotent layout", async () => {
    const sheet = await sheetPdf(await labelPdf());
    const fixed = await normaliseLabelPdf(sheet, "A4");
    expect(fixed).not.toBeNull();
    const after = await drawn(fixed!);
    expect(near(after.formBBox[2], A6.w)).toBe(true);
    expect(after.content).toMatch(/\/Label Do/);
    // running it again on its own output changes nothing about the layout
    const again = await normaliseLabelPdf(fixed!, "A4");
    expect((await drawn(again!)).content).toBe(after.content);
  });

  it("leaves a plain page (no form chain) alone", async () => {
    const label = await labelPdf();
    expect(await normaliseLabelPdf(label, "A4")).toBeNull();
  });

  it("leaves a sheet with several labels alone", async () => {
    const label = await labelPdf();
    const doc = await PDFDocument.create();
    const [one] = await doc.embedPdf(label);
    const [two] = await doc.embedPdf(label);
    const page = doc.addPage([A4.w, A4.h]);
    page.drawPage(one, { x: 0, y: 0 });
    page.drawPage(two, { x: A6.w, y: 0 });
    expect(await normaliseLabelPdf(await doc.save(), "A4")).toBeNull();
  });
});

/**
 * The slip under the label (r16). Renat's two complaints about the printed
 * sheet were that it carried no drop-off code and nothing from the order at
 * all; an A4 sheet now reserves a band at the bottom for both. Read back with
 * the same extractor the invoice's test uses, so a dropped Cyrillic glyph or a
 * line that never reached the page fails here.
 */
describe("normaliseLabelPdf — the order's slip", () => {
  const SLIP: LabelSlip = {
    number: "R-100042",
    date: "13.09.2026",
    dropOffPin: "4821",
    carrier: "Omniva",
    destination: "Tallinn, Mustika keskuse pakiautomaat",
    recipient: "Иван Петров",
    phone: "+372 5550000",
    email: "ivan@example.com",
    trackingCode: "CC711290000EE",
    items: ["2 × Шампунь (250 мл)", "1 × Бальзам"],
  };

  async function sheet(slip: LabelSlip | null): Promise<Uint8Array> {
    const broken = await montonioPdf(await sheetPdf(await labelPdf()), "A4");
    const out = await normaliseLabelPdf(broken, "A4", slip);
    expect(out).not.toBeNull();
    return out!;
  }

  it("prints the drop-off code, where the parcel goes and who is waiting for it", async () => {
    const runs = pdfRuns(await sheet(SLIP));
    const all = runs.map((r) => r.text).join("\n");

    expect(all).toContain("ЗАКАЗ R-100042 · 13.09.2026");
    expect(all).toContain("КОД СДАЧИ ");
    expect(all).toContain("ÜLEANDMISKOOD");
    expect(all).toContain("Omniva · Tallinn, Mustika keskuse pakiautomaat");
    expect(all).toContain("Иван Петров · +372 5550000 · ivan@example.com");
    expect(all).toContain("CC711290000EE");
    expect(all).toContain("2 × Шампунь (250 мл); 1 × Бальзам");

    // the code is the biggest thing on the sheet, and in the mono face
    const pin = runs.find((r) => r.text === "4821");
    expect(pin, "the drop-off code is not on the sheet").toBeTruthy();
    expect(pin!.size).toBeGreaterThanOrEqual(20);
    expect(pin!.font).toMatch(/PTMono/);
    for (const r of runs) if (r !== pin) expect(r.size).toBeLessThan(pin!.size);
  });

  it("says so in words when the carrier gave no code, and invents none", async () => {
    const all = pdfText(await sheet({ ...SLIP, dropOffPin: "" })).join("\n");
    expect(all).toContain("Кода сдачи перевозчик не выдал");
    expect(all).not.toMatch(/\b4821\b/);
    // everything else the sheet is for is still there
    expect(all).toContain("CC711290000EE");
  });

  it("keeps the whole label on the sheet, above the slip", async () => {
    const withSlip = await drawn(await sheet(SLIP));
    const bare = await drawn((await normaliseLabelPdf(await montonioPdf(await sheetPdf(await labelPdf()), "A4"), "A4"))!);

    const read = (c: string) => c.match(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Label Do Q/)!.map(Number);
    const [, sx, sy, x, y] = read(withSlip.content);
    const [, bareScale] = read(bare.content);

    expect(sx).toBe(sy);
    // smaller than the bare sheet's label — the band took the room
    expect(sx).toBeLessThan(bareScale);
    // …and still whole, inside the margins, clear of the slip's band
    expect(x).toBeGreaterThanOrEqual(28.3);
    expect(x + A6.w * sx).toBeLessThanOrEqual(A4.w - 28.3);
    expect(y + A6.h * sy).toBeLessThanOrEqual(A4.h - 28.3);
    const runs = pdfRuns(await sheet(SLIP));
    const highest = Math.max(...runs.map((r) => r.y));
    expect(y, "the label reaches down into the slip").toBeGreaterThan(highest);
  });

  it("a file with no form chain still gets its slip, whole and above the band", async () => {
    // the e2e carrier's label is a plain page (src/lib/shipping/montonio-mock.ts),
    // and so is any real file whose composition ever changes
    const plain = await labelPdf();
    expect(await normaliseLabelPdf(plain, "A4"), "a bare call must still leave it alone").toBeNull();

    const out = (await normaliseLabelPdf(plain, "A4", SLIP))!;
    expect(out).not.toBeNull();
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount(), "the slip took a page of its own").toBe(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(A4.w, 1);

    const runs = pdfRuns(out);
    expect(runs.map((r) => r.text)).toContain("КОД СДАЧИ ");
    expect(runs.find((r) => r.text === "4821")).toBeTruthy();
  });

  it("A6 stays the bare sticker — a slip would cover the barcode", async () => {
    const broken = await montonioPdf(await sheetPdf(await labelPdf()), "A6");
    const out = (await normaliseLabelPdf(broken, "A6", SLIP))!;
    // nothing of ours is on it: the only text is the fixture label's own,
    // drawn in Helvetica — none of the shop's three embedded faces appear
    for (const run of pdfRuns(out)) expect(run.font).not.toMatch(/Oswald|GolosText|PTMono/);
    expect((await drawn(out)).content).toMatch(/q 1 0 0 1 0 0\.01 cm \/Label Do Q/);
  });
});

describe("labelSlipFor", () => {
  const order = {
    number: "R-100042",
    createdAt: "2026-09-13T08:14:00.000Z",
    name: "Иван Петров",
    phone: "+372 5550000",
    email: "ivan@example.com",
    shipping: { carrier: "smartpost", pointName: "Tallinn, Kristiine SmartPosti", address: null },
    items: [{ brand: "Reuzel", title: "Clay Matte Pomade", variant: "113 г", qty: 2 }],
  };

  it("names the carrier the way the panel does and dates the order", () => {
    const slip = labelSlipFor(order, { carrier: "smartpost", trackingCode: "MK1", dropOffPin: "4821" });
    expect(slip.carrier).toBe("SmartPosti");
    expect(slip.date).toBe("13.09.2026");
    expect(slip.destination).toBe("Tallinn, Kristiine SmartPosti");
    expect(slip.dropOffPin).toBe("4821");
    expect(slip.items).toEqual(["2 × Reuzel Clay Matte Pomade (113 г)"]);
  });

  it("falls back to the courier address, and leaves the code empty when there is none", () => {
    const slip = labelSlipFor(
      { ...order, shipping: { carrier: "dpd", pointName: null, address: { addr: "Mardi 1", zip: "10145", city: "Tallinn" } } },
      { carrier: "dpd", trackingCode: "DPD9", dropOffPin: "" },
    );
    expect(slip.destination).toBe("Mardi 1, 10145, Tallinn");
    expect(slip.carrier).toBe("DPD");
    expect(slip.dropOffPin).toBe("");
  });

  it("survives an order with nothing on it", () => {
    const slip = labelSlipFor({}, null);
    expect(slip.number).toBe("");
    expect(slip.items).toEqual([]);
  });
});
