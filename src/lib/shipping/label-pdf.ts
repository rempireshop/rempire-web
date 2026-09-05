/**
 * Shipping-label PDF repair.
 *
 * Montonio's label files are composed twice: the A6 label is embedded as a
 * form XObject, laid out on an A4 sheet (translate + 1.85× scale), and that
 * laid-out sheet is embedded *again* on the final page with the same layout
 * applied a second time. On A4 the label therefore lands at 3.4× and only its
 * top-left half fits the sheet; on A6 the sheet is drawn at 0.95× and the
 * label is cut just the same. The files render like that in every viewer —
 * the owner saw «half a label».
 *
 * `normaliseLabelPdf` walks down the chain of single-child form XObjects to
 * the innermost one — the label itself — and rewrites the first page so it
 * draws that form directly: 1:1 on an A6 sheet, scaled to fit inside 10 mm
 * margins on A4. Files without such a chain (a plain page, several labels per
 * page) are left as they are; the caller then serves the original bytes.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream } from "pdf-lib";

export type LabelSize = "A4" | "A6";

const PAGE: Record<LabelSize, { w: number; h: number; margin: number }> = {
  A4: { w: 595.28, h: 841.89, margin: 28.35 }, // 10 mm margins
  A6: { w: 297.64, h: 419.53, margin: 0 },
};

type Box = { x: number; y: number; w: number; h: number };

/** [x1 y1 x2 y2] → a box; null when the array is not four finite numbers. */
function boxOf(arr: PDFArray | undefined): Box | null {
  if (!arr || arr.size() !== 4) return null;
  const n: number[] = [];
  for (let i = 0; i < 4; i++) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    n.push(v.asNumber());
  }
  const [x1, y1, x2, y2] = n;
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w, h };
}

/** The form's bounding box in the space it is drawn in (BBox through Matrix). */
function formBox(form: PDFStream): Box | null {
  const bbox = boxOf(form.dict.lookupMaybe(PDFName.of("BBox"), PDFArray));
  if (!bbox) return null;
  const matrix = form.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
  if (!matrix || matrix.size() !== 6) return bbox;
  const m: number[] = [];
  for (let i = 0; i < 6; i++) {
    const v = matrix.lookup(i);
    if (!(v instanceof PDFNumber)) return bbox;
    m.push(v.asNumber());
  }
  const [a, b, c, d, e, f] = m;
  const corners = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.w, bbox.y],
    [bbox.x, bbox.y + bbox.h],
    [bbox.x + bbox.w, bbox.y + bbox.h],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The single form XObject a resources dict refers to, or null. */
function onlyForm(doc: PDFDocument, resources: PDFDict | undefined): { ref: PDFRef; form: PDFStream } | null {
  if (!resources) return null;
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return null;
  const entries = xobjects.entries();
  if (entries.length !== 1) return null;
  const value = entries[0][1];
  if (!(value instanceof PDFRef)) return null;
  const form = doc.context.lookup(value);
  if (!(form instanceof PDFStream)) return null;
  const subtype = form.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
  if (!subtype || subtype.asString() !== "/Form") return null;
  return { ref: value, form };
}

/** Walks page → form → form … while each level holds exactly one form. */
function innermostForm(doc: PDFDocument): { ref: PDFRef; form: PDFStream; depth: number } | null {
  const page = doc.getPage(0);
  let current = onlyForm(doc, page.node.Resources());
  if (!current) return null;
  let depth = 1;
  for (let guard = 0; guard < 16; guard++) {
    const next = onlyForm(doc, current.form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict));
    if (!next) break;
    current = next;
    depth++;
  }
  return { ...current, depth };
}

const num = (v: number) => (Math.round(v * 10000) / 10000).toString();

/**
 * Rewrites the label PDF so the first page draws the innermost form directly.
 * Returns null when the file has no form chain to unwrap (serve it as is).
 */
export async function normaliseLabelPdf(bytes: ArrayBuffer | Uint8Array, size: LabelSize): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (doc.getPageCount() < 1) return null;
  const inner = innermostForm(doc);
  if (!inner) return null;
  const box = formBox(inner.form);
  if (!box) return null;

  const target = PAGE[size];
  const avail = { w: target.w - 2 * target.margin, h: target.h - 2 * target.margin };
  let scale = Math.min(avail.w / box.w, avail.h / box.h);
  // an A6 label on an A6 sheet stays 1:1 (the sheet is 0.02 pt taller)
  if (size === "A6" && scale > 1 && scale < 1.02) scale = 1;
  const x = (target.w - box.w * scale) / 2 - box.x * scale;
  const y = (target.h - box.h * scale) / 2 - box.y * scale;

  while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const page = doc.getPage(0);
  page.setMediaBox(0, 0, target.w, target.h);
  for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Annots"]) {
    page.node.delete(PDFName.of(key));
  }
  const content = `q ${num(scale)} 0 0 ${num(scale)} ${num(x)} ${num(y)} cm /Label Do Q`;
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content)));
  page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: doc.context.obj({ Label: inner.ref }) }));

  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
