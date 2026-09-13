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
 *
 * ---- the slip under the label (r16) ---------------------------------------
 *
 * Renat, 13.09.2026: «no drop-off code for the locker is shown», «the address
 * or any information from order is not printed on the PDF». The carrier's own
 * sticker carries a barcode and the machine's name in Estonian and nothing
 * else the shop can act on — he could not tell one printed label from another,
 * and at the parcel machine he had nothing to type in.
 *
 * So when the caller hands over a `LabelSlip`, an **A4** sheet reserves a band
 * at the bottom for it: the order number, the drop-off code in big mono
 * figures, where the parcel is going, who is waiting for it, the tracking
 * number and what is inside. The label is scaled to fit what is left above —
 * it stays whole, just smaller. One sheet, cut it in half if you like.
 *
 * A6 never gets the slip: that sheet *is* the sticker for a thermal printer,
 * there is no room beside the barcode, and a second sticker for the text would
 * spend a label off the roll. The panel's own «Отправление» box already shows
 * the same fields on screen.
 *
 * Everything the slip prints comes from the caller (`LabelSlip`) — nothing is
 * read from a database here, so a test renders one without a server. The
 * drop-off code is Montonio's `parcels[0].dropOffPin`, never invented: where
 * the carrier gives none, the slip says so in words.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, rgb } from "pdf-lib";
import { giftPdfFonts } from "@/lib/giftcard-pdf";

export type LabelSize = "A4" | "A6";

/** What the sheet prints under the label. Every field may be empty. */
export type LabelSlip = {
  /** «R-100042» */
  number: string;
  /** The day the order was placed, already formatted (dd.mm.yyyy). */
  date?: string;
  /** Montonio's parcels[0].dropOffPin — "" where the carrier issues none. */
  dropOffPin?: string;
  /** «Omniva», «DPD» … as the owner knows it. */
  carrier?: string;
  /** The parcel machine's name, or the courier address, one line. */
  destination?: string;
  /** Who is waiting for it. */
  recipient?: string;
  phone?: string;
  email?: string;
  /** The carrier's own parcel number. */
  trackingCode?: string;
  /** «2 × Шампунь 250 мл» … — what to put in the box. */
  items?: string[];
};

const PAGE: Record<LabelSize, { w: number; h: number; margin: number }> = {
  A4: { w: 595.28, h: 841.89, margin: 28.35 }, // 10 mm margins
  A6: { w: 297.64, h: 419.53, margin: 0 },
};

const INK = rgb(0x1c / 255, 0x1a / 255, 0x00 / 255);
const MUTED = rgb(0.42, 0.41, 0.35);
const RULE = rgb(0.82, 0.81, 0.76);

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

/* ---------- the slip ------------------------------------------------------ */

/* The band, top to bottom: a hairline, the order line, the drop-off code (a
   caption and 26-pt figures, or one sentence where the carrier gives none),
   then one line per fact. Every number is a drop from the line above it, so
   slipBand() and drawSlip() cannot drift apart. */
const SLIP = {
  pad: 14,        // between the label and the rule
  head: 17,       // rule → «ЗАКАЗ R-100042 · 13.09.2026»
  caption: 18,    // head → «КОД СДАЧИ / ÜLEANDMISKOOD»
  code: 26,       // caption → the figures
  rows: 16,       // code → the first fact, and fact → fact
  tail: 6,        // descenders under the last line
};

const clean = (v: unknown, max = 120): string =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The carrier as the owner names it, from the code Montonio uses. Mirrors
    carrierWord() in public/shop2/app.js so the sheet and the screen agree. */
const CARRIER_WORD: Record<string, string> = {
  omniva: "Omniva", smartpost: "SmartPosti", itella: "SmartPosti",
  dpd: "DPD", venipak: "Venipak", unisend: "Unisend",
};

/** «13.09.2026» out of an ISO stamp — the day the order was placed. */
function slipDate(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/**
 * The order as the sheet prints it. Deliberately structural rather than typed
 * against `Order`: everything it reads is a field the admin panel already
 * shows, and keeping it free of the order module lets a test build one.
 *
 * A parcel-machine order prints the machine's name; a courier one the address
 * that was typed at checkout. `shipment` is `orders.shipping.montonio` — the
 * parcel Montonio registered, drop-off code included.
 */
export function labelSlipFor(
  order: {
    number?: string;
    createdAt?: string;
    name?: string;
    phone?: string;
    email?: string;
    shipping?: {
      carrier?: string | null;
      pointName?: string | null;
      address?: Record<string, unknown> | null;
    } | null;
    items?: Array<{ title?: string; brand?: string; variant?: string | null; qty?: number }>;
  },
  shipment: { carrier?: string; trackingCode?: string; dropOffPin?: string } | null,
): LabelSlip {
  const ship = order.shipping ?? null;
  const code = String(shipment?.carrier || ship?.carrier || "").toLowerCase();
  const addr = (ship?.address ?? {}) as Record<string, unknown>;
  const destination = ship?.pointName
    ? String(ship.pointName)
    : [addr.addr ?? addr.street, addr.zip, addr.city].map((v) => clean(v, 90)).filter(Boolean).join(", ");
  return {
    number: clean(order.number, 30),
    date: slipDate(order.createdAt),
    dropOffPin: clean(shipment?.dropOffPin, 24),
    carrier: CARRIER_WORD[code] || (code ? code.charAt(0).toUpperCase() + code.slice(1) : ""),
    destination,
    recipient: clean(order.name, 80),
    phone: clean(order.phone, 40),
    email: clean(order.email, 80),
    trackingCode: clean(shipment?.trackingCode, 60),
    // six lines at most: the slip is a packing crib, not a second invoice
    items: (order.items ?? []).slice(0, 6).map((i) => {
      const name = [clean(i.brand, 30), clean(i.title, 60)].filter(Boolean).join(" ");
      const size = clean(i.variant, 24);
      return `${Math.max(1, Math.round(Number(i.qty) || 1))} × ${name}${size ? ` (${size})` : ""}`;
    }),
  };
}

/** `["Куда", "Omniva · Tallinn…"]` pairs — only the ones that have a value. */
function slipRows(slip: LabelSlip): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const where = [clean(slip.carrier, 40), clean(slip.destination, 160)].filter(Boolean).join(" · ");
  if (where) rows.push(["Куда", where]);
  const who = [clean(slip.recipient, 80), clean(slip.phone, 40), clean(slip.email, 80)].filter(Boolean).join(" · ");
  if (who) rows.push(["Кому", who]);
  const track = clean(slip.trackingCode, 60);
  if (track) rows.push(["Трек-номер", track]);
  const items = (slip.items ?? []).map((i) => clean(i, 90)).filter(Boolean);
  if (items.length) rows.push(["В посылке", items.join("; ")]);
  return rows;
}

/**
 * How tall the slip's band is — from the page's bottom edge up to the rule,
 * the bottom margin included. The label above is scaled to fit what is left.
 *
 * The row count is an estimate on purpose: it is needed before a font is
 * embedded, so a long value is allowed two lines at ~78 characters each. An
 * estimate that is one line out costs whitespace, never a cut line — drawSlip
 * writes downwards from the same rule and stops when the facts run out.
 */
function slipBand(slip: LabelSlip): number {
  const lines = slipRows(slip).reduce((n, [, value]) => n + (value.length > 78 ? 2 : 1), 0);
  return (
    PAGE.A4.margin + SLIP.pad + SLIP.head + SLIP.caption + SLIP.code + SLIP.rows * lines + SLIP.tail
  );
}

/** Cuts `text` into at most `maxLines` lines that fit `width` at `size`. */
function wrap(
  text: string,
  width: number,
  maxLines: number,
  measure: (s: string) => number,
): string[] {
  const words = text.split(" ").filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
      if (out.length === maxLines) break;
    }
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

/**
 * Draws the slip into the band `[margin, top]` of the first page. Returns
 * quietly if the fonts cannot be read — a label with no slip beats no label.
 */
async function drawSlip(doc: PDFDocument, slip: LabelSlip, rule: number): Promise<void> {
  const target = PAGE.A4;
  const page = doc.getPage(0);
  doc.registerFontkit(fontkit);
  const faces = giftPdfFonts();
  // subset: true — three whole faces would be ~220 KB on top of the label
  const display = await doc.embedFont(faces.display, { subset: true });
  const body = await doc.embedFont(faces.body, { subset: true });
  const mono = await doc.embedFont(faces.mono, { subset: true });

  const left = target.margin;
  const right = target.w - target.margin;
  let y = rule;

  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: RULE });

  y -= SLIP.head;
  const head = ["ЗАКАЗ " + clean(slip.number, 30), clean(slip.date, 20)].filter(Boolean).join(" · ");
  page.drawText(head, { x: left, y, size: 13, font: display, color: INK });

  /* The drop-off code is the one thing he needs standing at the machine, so it
     is the biggest thing on the slip. Montonio hands it back as
     parcels[0].dropOffPin; a courier parcel has none and never will, and the
     line says so rather than leaving a blank he would stand and look for. */
  const pin = clean(slip.dropOffPin, 24);
  y -= SLIP.caption;
  if (pin) {
    const capW = display.widthOfTextAtSize("КОД СДАЧИ ", 10);
    page.drawText("КОД СДАЧИ ", { x: left, y, size: 10, font: display, color: MUTED });
    page.drawText("/ ÜLEANDMISKOOD", { x: left + capW, y, size: 10, font: body, color: MUTED });
    y -= SLIP.code;
    page.drawText(pin, { x: left, y, size: 26, font: mono, color: INK });
  } else {
    page.drawText("Кода сдачи перевозчик не выдал — посылку принимают по трек-номеру.", {
      x: left, y, size: 10.5, font: body, color: MUTED,
    });
    y -= SLIP.code;
  }

  const keyW = 74;
  for (const [key, value] of slipRows(slip)) {
    const lines = wrap(value, right - left - keyW, 2, (s) => body.widthOfTextAtSize(s, 10.5));
    for (let i = 0; i < lines.length; i++) {
      y -= SLIP.rows;
      if (i === 0) page.drawText(key, { x: left, y, size: 10.5, font: body, color: MUTED });
      page.drawText(lines[i], { x: left + keyW, y, size: 10.5, font: body, color: INK });
    }
  }
}

/**
 * A fresh A4 sheet: the label file's own first page, whole and scaled to fit
 * above the band, with the order's slip under it.
 *
 * The way out for a file the unwrapping does not recognise. Nothing is cut —
 * the page can only come out smaller than it went in — and the owner gets the
 * drop-off code and the address either way, which is the whole point of the
 * sheet. Used by the e2e carrier (src/lib/shipping/montonio-mock.ts), whose
 * label is a plain page, and by any real file whose shape ever changes.
 */
async function sheetWithSlip(bytes: ArrayBuffer | Uint8Array, slip: LabelSlip, band: number): Promise<Uint8Array> {
  const target = PAGE.A4;
  const out = await PDFDocument.create();
  const [label] = await out.embedPdf(bytes as Uint8Array);
  const page = out.addPage([target.w, target.h]);
  const avail = { w: target.w - 2 * target.margin, h: target.h - 2 * target.margin - band };
  const scale = Math.min(avail.w / label.width, avail.h / label.height, 1);
  page.drawPage(label, {
    x: (target.w - label.width * scale) / 2,
    y: band + (target.h - band - label.height * scale) / 2,
    xScale: scale,
    yScale: scale,
  });
  await drawSlipSafely(out, slip, band);
  return out.save();
}

/** The slip, or a label without one — the fonts live on disk (public/fonts)
    and a face that will not load must never cost the owner his sticker. */
async function drawSlipSafely(doc: PDFDocument, slip: LabelSlip, band: number): Promise<void> {
  try {
    await drawSlip(doc, slip, band - SLIP.pad);
  } catch (err) {
    console.error("[label-pdf] the slip could not be drawn:", err);
  }
}

/**
 * Rewrites the label PDF so the first page draws the innermost form directly.
 * Returns null when the file has no form chain to unwrap **and** no slip was
 * asked for (the caller then serves the original bytes).
 *
 * With a `slip` and `size === "A4"` the sheet also carries the order's own
 * details under the label (see the file header). Called without one — every
 * A6 request, and the tests that measure the bare repair — the layout is
 * exactly what it has always been.
 */
export async function normaliseLabelPdf(
  bytes: ArrayBuffer | Uint8Array,
  size: LabelSize,
  slip?: LabelSlip | null,
): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (doc.getPageCount() < 1) return null;

  const target = PAGE[size];
  const band = size === "A4" && slip ? slipBand(slip) : 0;

  const inner = innermostForm(doc);
  const box = inner ? formBox(inner.form) : null;
  if (!inner || !box) {
    // no chain to unwrap. Without a slip that is the end of it — with one, the
    // sheet is built round the page as it is rather than going out bare.
    return band ? await sheetWithSlip(bytes, slip!, band) : null;
  }

  const avail = { w: target.w - 2 * target.margin, h: target.h - 2 * target.margin - band };
  let scale = Math.min(avail.w / box.w, avail.h / box.h);
  // an A6 label on an A6 sheet stays 1:1 (the sheet is 0.02 pt taller)
  if (size === "A6" && scale > 1 && scale < 1.02) scale = 1;
  const x = (target.w - box.w * scale) / 2 - box.x * scale;
  // the label keeps the middle of what is left above the slip's band
  const y = band + (target.h - band - box.h * scale) / 2 - box.y * scale;

  while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const page = doc.getPage(0);
  page.setMediaBox(0, 0, target.w, target.h);
  for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Annots"]) {
    page.node.delete(PDFName.of(key));
  }
  const content = `q ${num(scale)} 0 0 ${num(scale)} ${num(x)} ${num(y)} cm /Label Do Q`;
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content)));
  page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: doc.context.obj({ Label: inner.ref }) }));

  if (band) await drawSlipSafely(doc, slip!, band);

  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
