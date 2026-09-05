/**
 * Label PDF repair — Montonio composes the A6 label twice (see
 * src/lib/shipping/label-pdf.ts); the proxy unwraps it. These tests build the
 * same nesting with pdf-lib and check the rewritten page draws the innermost
 * form at the intended size and position.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { normaliseLabelPdf } from "@/lib/shipping/label-pdf";

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
