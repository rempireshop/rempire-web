/**
 * The invoice as a file — one A4 page (more when an order is long), made with
 * the same pdf-lib + fontkit pair, the same three faces and the same tower as
 * the gift card (src/lib/giftcard-pdf.ts), so the two documents the shop
 * hands out look like they come from one place.
 *
 * Bilingual by design. A company in Estonia may be Estonian-, Russian- or
 * English-speaking, and its accountant is almost always Estonian-speaking:
 * every heading is printed in Estonian and English, and a Russian order gets
 * the Russian word as a quieter third line. The numbers, the dates
 * (dd.mm.yyyy) and the layout are the same whatever the language.
 *
 * What is on the page, top to bottom, is exactly the legal minimum for an
 * Estonian invoice (VAT Act §37 — see src/lib/invoices.ts): the seller with
 * address, registry code and KMKR number; the buyer with address (and VAT
 * number when given); the serial number, the issue and due dates and the
 * order number; the lines with quantity, unit price, net, VAT rate and
 * amount, total; the three totals in EUR; and the payment box — beneficiary,
 * IBAN, bank, the reference to put on the transfer.
 *
 * Pure at the core: renderInvoicePdf() prints only what it is handed, so a
 * test can read the text back without a database. buildInvoicePdf() is the
 * wrapper the app calls — it fetches the seller from settings and the VAT
 * split from src/lib/invoices.ts.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { giftPdfFonts, humanDate, towerPath, wrapText } from "@/lib/giftcard-pdf";
import {
  companyOf,
  invoiceLines,
  invoiceOf,
  invoiceSeller,
  type InvoiceRecord,
  type InvoiceSeller,
  type InvoiceTotals,
  type OrderCompany,
} from "@/lib/invoices";
import type { Order } from "@/lib/orders";

/* ---------- names ---------------------------------------------------------- */

/** `rempire-invoice-A-2026-0001.pdf` — the attachment's and the download's name. */
export function invoicePdfFilename(number: string): string {
  return `rempire-invoice-${String(number || "invoice").replace(/[^A-Za-z0-9-]+/g, "_")}.pdf`;
}

/* ---------- copy ----------------------------------------------------------- */

export type PdfLang = "ru" | "et" | "en";

export function invoicePdfLang(lang: unknown): PdfLang {
  const s = String(lang ?? "").toLowerCase().slice(0, 2);
  return s === "et" ? "et" : s === "en" ? "en" : "ru";
}

type Tri = { et: string; en: string; ru: string };

const W = {
  title: { et: "ARVE", en: "Invoice", ru: "Счёт" },
  number: { et: "Arve nr", en: "Invoice no", ru: "№ счёта" },
  date: { et: "Kuupäev", en: "Date", ru: "Дата" },
  due: { et: "Maksetähtaeg", en: "Due date", ru: "Срок оплаты" },
  order: { et: "Tellimus", en: "Order", ru: "Заказ" },
  seller: { et: "Müüja", en: "Seller", ru: "Продавец" },
  buyer: { et: "Ostja", en: "Buyer", ru: "Покупатель" },
  regCode: { et: "Registrikood", en: "Reg. code", ru: "Рег. код" },
  vatNo: { et: "KMKR nr", en: "VAT no", ru: "Номер НДС" },
  desc: { et: "Kirjeldus", en: "Description", ru: "Наименование" },
  qty: { et: "Kogus", en: "Qty", ru: "Кол-во" },
  unit: { et: "Hind (km-ga)", en: "Unit (incl. VAT)", ru: "Цена с НДС" },
  net: { et: "Summa km-ta", en: "Net", ru: "Без НДС" },
  vatCol: { et: "KM {r} %", en: "VAT {r} %", ru: "НДС {r} %" },
  total: { et: "Kokku", en: "Total", ru: "Итого" },
  netTotal: { et: "Summa ilma käibemaksuta", en: "Subtotal excl. VAT", ru: "Сумма без НДС" },
  vatTotal: { et: "Käibemaks {r} %", en: "VAT {r} %", ru: "НДС {r} %" },
  dueTotal: { et: "Kokku tasuda", en: "Total due", ru: "Итого к оплате" },
  payment: { et: "Maksmine", en: "Payment", ru: "Оплата" },
  beneficiary: { et: "Saaja", en: "Beneficiary", ru: "Получатель" },
  bank: { et: "Pank", en: "Bank", ru: "Банк" },
  reference: { et: "Selgitus", en: "Reference", ru: "Пояснение платежа" },
  amount: { et: "Summa", en: "Amount", ru: "Сумма" },
  notSet: { et: "täitmata", en: "not set", ru: "не указан" },
  payNote: {
    et: "Palume tasuda arve maksetähtajaks. Tellimus saadetakse teele pärast makse laekumist.",
    en: "Please pay by the due date. The order ships once the payment arrives.",
    ru: "Просим оплатить счёт до указанного срока. Заказ отправим после поступления денег.",
  },
  page: { et: "lk", en: "page", ru: "стр." },
} satisfies Record<string, Tri>;

/** «Arve nr / Invoice no», plus « / № счёта» on a Russian order. */
function lab(w: Tri, lang: PdfLang, rate?: number): string {
  const f = (s: string) => (rate == null ? s : s.replace("{r}", String(rate)));
  const parts = [f(w.et), f(w.en)];
  if (lang === "ru") parts.push(f(w.ru));
  return parts.join(" / ");
}

/** The three lines of a table header, ET and EN always, RU on a Russian order. */
function lines3(w: Tri, lang: PdfLang, rate?: number): string[] {
  const f = (s: string) => (rate == null ? s : s.replace("{r}", String(rate)));
  const out = [f(w.et), f(w.en)];
  if (lang === "ru") out.push(f(w.ru));
  return out;
}

/* ---------- the data ------------------------------------------------------- */

export interface InvoicePdfData {
  number: string;
  /** `YYYY-MM-DD` — printed as dd.mm.yyyy. */
  issueDate: string;
  dueAt: string;
  orderNumber: string;
  lang: PdfLang;
  seller: InvoiceSeller;
  buyer: OrderCompany;
  totals: InvoiceTotals;
  currency?: string;
}

/* ---------- the page ------------------------------------------------------- */

/* A4 portrait, in points: 210 × 297 mm. */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

const MARGIN = 44;
const INK = rgb(0x1c / 255, 0x1a / 255, 0x00 / 255);
const PAPER = rgb(1, 1, 1);
const MUTED = rgb(0.42, 0.41, 0.35);
const RULE = rgb(0.82, 0.81, 0.76);

/* the table's columns — the right edge of every numeric column */
const COL = {
  descX: MARGIN,
  descW: 196,
  qty: 274,
  unit: 344,
  net: 414,
  vat: 481,
  total: A4_WIDTH - MARGIN, // 551.28
} as const;

function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** «1234,56» — comma decimal, no currency; the header names the EUR. */
export function amount(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2).replace(".", ",");
}

function euro(n: number): string {
  return `${amount(n)} €`;
}

function qtyText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ",");
}

interface Faces {
  display: PDFFont;
  body: PDFFont;
  mono: PDFFont;
}

function drawRight(page: PDFPage, text: string, right: number, y: number, font: PDFFont, size: number, color = INK): void {
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function drawTower(page: PDFPage, left: number, top: number, height: number): void {
  const tower = towerPath();
  if (!tower) return;
  const [minX, minY, , boxH] = tower.box;
  const scale = height / boxH;
  page.drawSvgPath(tower.d, { x: left - minX * scale, y: top + minY * scale, scale, color: INK, borderWidth: 0 });
}

function drawWordmark(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, tracking = 2.4): void {
  let cursor = x;
  for (const ch of text) {
    page.drawText(ch, { x: cursor, y, size, font, color: INK });
    cursor += font.widthOfTextAtSize(ch, size) + tracking;
  }
}

/**
 * The invoice, as bytes. Pure: nothing here reads a database or the
 * environment, so the layout can be asserted against known input.
 */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const L = data.lang;
  const rate = data.totals.vatRate;
  const number = clean(data.number, 40);
  if (!number) throw new Error("bad_invoice_number");
  const fonts = giftPdfFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const faces: Faces = {
    display: await doc.embedFont(fonts.display, { subset: true }),
    body: await doc.embedFont(fonts.body, { subset: true }),
    mono: await doc.embedFont(fonts.mono, { subset: true }),
  };
  doc.setTitle(`${lab(W.title, L)} ${number} — Rempire`);
  doc.setSubject(`${lab(W.order, L)} ${clean(data.orderNumber, 20)}`);
  doc.setProducer("rempireshop.com");
  doc.setCreator("rempireshop.com");

  const pages: PDFPage[] = [];
  const newPage = (): PDFPage => {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: PAPER });
    pages.push(page);
    return page;
  };

  let page = newPage();
  let y = A4_HEIGHT - MARGIN;

  /* ---- the mark and the title ---- */
  drawTower(page, MARGIN, y + 4, 40);
  drawWordmark(page, "REMPIRE", MARGIN + 36, y - 22, faces.display, 20, 3);
  drawRight(page, W.title.et, A4_WIDTH - MARGIN, y - 18, faces.display, 26);
  drawRight(page, W.title.en, A4_WIDTH - MARGIN, y - 34, faces.body, 10, MUTED);
  if (L === "ru") drawRight(page, W.title.ru, A4_WIDTH - MARGIN, y - 47, faces.body, 10, MUTED);
  y -= L === "ru" ? 70 : 58;

  /* ---- number, dates, order — right column; seller — left column ---- */
  const metaTop = y;
  const meta: Array<[string, string, PDFFont]> = [
    [lab(W.number, L), number, faces.mono],
    [lab(W.date, L), humanDate(data.issueDate), faces.body],
    [lab(W.due, L), humanDate(data.dueAt), faces.body],
    [lab(W.order, L), clean(data.orderNumber, 20), faces.mono],
  ];
  let my = metaTop;
  for (const [label, value, font] of meta) {
    drawRight(page, value, A4_WIDTH - MARGIN, my, font, 10);
    drawRight(page, label, A4_WIDTH - MARGIN - faces.mono.widthOfTextAtSize(value, 10) - 10, my, faces.body, 8, MUTED);
    my -= 15;
  }

  const partyBlock = (title: string, rows: string[], x: number, top: number, width: number): number => {
    let py = top;
    page.drawText(title.toUpperCase(), { x, y: py, size: 7.5, font: faces.body, color: MUTED });
    py -= 14;
    rows.filter(Boolean).forEach((row, i) => {
      const lines = wrapText(row, faces.body, i === 0 ? 10.5 : 9, width, 2);
      for (const line of lines) {
        page.drawText(line, { x, y: py, size: i === 0 ? 10.5 : 9, font: faces.body, color: INK });
        py -= i === 0 ? 14 : 12;
      }
    });
    return py;
  };

  const s = data.seller;
  const sellerRows = [
    clean(s.name, 120),
    clean(s.address, 200),
    s.regCode ? `${lab(W.regCode, L)}: ${clean(s.regCode, 20)}` : "",
    s.vatNumber ? `${lab(W.vatNo, L)}: ${clean(s.vatNumber, 20)}` : "",
    [clean(s.email, 100), clean(s.phone, 30)].filter(Boolean).join(" · "),
  ];
  const sellerBottom = partyBlock(lab(W.seller, L), sellerRows, MARGIN, metaTop, 250);

  const b = data.buyer;
  const buyerRows = [
    clean(b.name, 120),
    clean(b.address, 300),
    b.regCode ? `${lab(W.regCode, L)}: ${clean(b.regCode, 20)}` : "",
    b.vatNumber ? `${lab(W.vatNo, L)}: ${clean(b.vatNumber, 20)}` : "",
    clean(b.email, 100),
  ];
  const buyerTop = Math.min(my, sellerBottom) - 8;
  const buyerBottom = partyBlock(lab(W.buyer, L), buyerRows, MARGIN, buyerTop, 300);
  y = buyerBottom - 14;

  /* ---- the table ---- */
  const headLines = L === "ru" ? 3 : 2;
  const headH = 10 + headLines * 9;
  const drawTableHead = (): void => {
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4_WIDTH - MARGIN, y: y + 2 }, thickness: 1, color: INK });
    const cols: Array<[Tri, "left" | "right", number, number?]> = [
      [W.desc, "left", COL.descX],
      [W.qty, "right", COL.qty],
      [W.unit, "right", COL.unit],
      [W.net, "right", COL.net],
      [W.vatCol, "right", COL.vat, rate],
      [W.total, "right", COL.total],
    ];
    for (const [word, align, x, r] of cols) {
      lines3(word, L, r).forEach((line, i) => {
        const size = i === 2 ? 6.5 : 7;
        const ly = y - 9 - i * 9;
        if (align === "left") page.drawText(line, { x, y: ly, size, font: faces.body, color: i === 2 ? MUTED : INK });
        else drawRight(page, line, x, ly, faces.body, size, i === 2 ? MUTED : INK);
      });
    }
    y -= headH;
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: A4_WIDTH - MARGIN, y: y + 4 }, thickness: 0.6, color: RULE });
    y -= 12;
  };

  const footer = (): void => {
    page.drawText(clean([s.name, s.address, s.email, "rempireshop.com"].filter(Boolean).join(" · "), 200), {
      x: MARGIN,
      y: 20,
      size: 7.5,
      font: faces.body,
      color: MUTED,
    });
  };

  const continueOnNewPage = (): void => {
    footer();
    page = newPage();
    y = A4_HEIGHT - MARGIN;
    page.drawText(`${lab(W.number, L)}: ${number}`, { x: MARGIN, y, size: 9, font: faces.body, color: MUTED });
    y -= 22;
    drawTableHead();
  };

  drawTableHead();
  for (const line of data.totals.lines) {
    const title = clean(line.title, 200);
    const descLines = wrapText(title, faces.body, 9, COL.descW, 2);
    const rowH = Math.max(1, descLines.length) * 12 + 4;
    if (y - rowH < 90) continueOnNewPage();
    descLines.forEach((t, i) => page.drawText(t, { x: COL.descX, y: y - i * 12, size: 9, font: faces.body, color: INK }));
    drawRight(page, qtyText(line.qty), COL.qty, y, faces.body, 9);
    drawRight(page, amount(line.unitGross), COL.unit, y, faces.body, 9);
    drawRight(page, amount(line.net), COL.net, y, faces.body, 9);
    drawRight(page, amount(line.vat), COL.vat, y, faces.body, 9);
    drawRight(page, amount(line.gross), COL.total, y, faces.body, 9);
    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: A4_WIDTH - MARGIN, y: y + 6 }, thickness: 0.4, color: RULE });
  }

  /* ---- the payment box, measured before anything under the table is drawn ---- */
  const boxX = MARGIN;
  const payRows: Array<[string, string, PDFFont]> = [
    [lab(W.beneficiary, L), clean(s.name, 120), faces.body],
    ["IBAN", s.iban ? clean(s.iban, 42) : `— (${lab(W.notSet, L)})`, faces.mono],
    [lab(W.bank, L), s.bankName ? clean(s.bankName, 60) : `— (${lab(W.notSet, L)})`, faces.body],
    [lab(W.reference, L), `${clean(data.orderNumber, 20)}, ${number}`, faces.mono],
    [lab(W.amount, L), euro(data.totals.total), faces.body],
    [lab(W.due, L), humanDate(data.dueAt), faces.body],
  ];
  /* The labels are bilingual, and trilingual on a Russian order — «Selgitus /
     Reference / Пояснение платежа» runs to some 165 pt at 8 pt — so the value
     column cannot sit at a fixed offset from the box's edge: it starts one
     gap after the widest label, the box grows to hold the widest value, and a
     value even the full-width box cannot hold wraps onto more lines. With the
     column pinned at +128, «Rempire Store OÜ» printed on top of «Saaja /
     Beneficiary / Получатель» on every Russian invoice (Dim's phone,
     10.09.2026). */
  const inset = 14;
  const labelSize = 8;
  const valueSize = 9.5;
  const labelW = Math.max(...payRows.map(([label]) => faces.body.widthOfTextAtSize(label, labelSize)));
  const valueX = boxX + inset + labelW + 12;
  const widestValue = Math.max(...payRows.map(([, value, font]) => font.widthOfTextAtSize(value, valueSize)));
  // the room a value gets: the widest one, as far as the page has it. The wrap
  // width is this very number, not read back off the box — re-derived through
  // the box's width it came out a rounding error narrower than the IBAN that
  // had set it, and the IBAN wrapped
  const valueW = Math.max(330 - (valueX - boxX) - inset, Math.min(widestValue, A4_WIDTH - MARGIN - valueX - inset));
  const boxW = valueX - boxX + valueW + inset;
  const payLines = payRows.map(([label, value, font]) => {
    const lines = wrapText(value, font, valueSize, valueW, 3);
    return { label, font, lines: lines.length ? lines : [""] };
  });
  const boxH = 24 + payLines.reduce((h, r) => h + r.lines.length * 14, 0) + 10;

  /* ---- totals and the payment box: together, and never split off the last line ---- */
  // 132 pt is what sits around the box: the totals above it, the note and the
  // footer's clearance below — a wrapped value makes the box taller, and the
  // break has to know, or the note lands on the footer
  if (y < 132 + boxH) {
    footer();
    page = newPage();
    y = A4_HEIGHT - MARGIN;
    page.drawText(`${lab(W.number, L)}: ${number}`, { x: MARGIN, y, size: 9, font: faces.body, color: MUTED });
    y -= 30;
  }
  y -= 6;
  const cur = clean(data.currency || "EUR", 3) || "EUR";
  const totalsRows: Array<[string, string, boolean]> = [
    [lab(W.netTotal, L), euro(data.totals.net), false],
    [lab(W.vatTotal, L, rate), euro(data.totals.vat), false],
    [`${lab(W.dueTotal, L)} (${cur})`, euro(data.totals.total), true],
  ];
  for (const [label, value, strong] of totalsRows) {
    if (strong) {
      page.drawLine({ start: { x: COL.net - 60, y: y + 12 }, end: { x: A4_WIDTH - MARGIN, y: y + 12 }, thickness: 1, color: INK });
      y -= 4;
    }
    drawRight(page, value, COL.total, y, strong ? faces.display : faces.body, strong ? 13 : 10);
    drawRight(page, label, COL.total - (strong ? 90 : 80), y, faces.body, strong ? 9 : 8.5, strong ? INK : MUTED);
    y -= strong ? 22 : 16;
  }

  /* ---- how to pay ---- */
  y -= 6;
  const boxTop = y;
  page.drawRectangle({ x: boxX, y: boxTop - boxH, width: boxW, height: boxH, borderColor: INK, borderWidth: 1, color: PAPER });
  let by = boxTop - 16;
  page.drawText(lab(W.payment, L).toUpperCase(), { x: boxX + inset, y: by, size: 7.5, font: faces.body, color: MUTED });
  by -= 16;
  for (const { label, font, lines } of payLines) {
    page.drawText(label, { x: boxX + inset, y: by, size: labelSize, font: faces.body, color: MUTED });
    for (const line of lines) {
      if (line) page.drawText(line, { x: valueX, y: by, size: valueSize, font, color: INK });
      by -= 14;
    }
  }
  y = boxTop - boxH - 14;
  wrapText(W.payNote[L === "ru" ? "ru" : L], faces.body, 8.5, A4_WIDTH - 2 * MARGIN, 3).forEach((line, i) => {
    page.drawText(line, { x: MARGIN, y: y - i * 12, size: 8.5, font: faces.body, color: MUTED });
  });
  if (L === "ru") {
    // the Estonian note under the Russian one, for the accountant who reads the file
    wrapText(W.payNote.et, faces.body, 8, A4_WIDTH - 2 * MARGIN, 2).forEach((line, i) => {
      page.drawText(line, { x: MARGIN, y: y - 14 - i * 11, size: 8, font: faces.body, color: MUTED });
    });
  }
  footer();

  if (pages.length > 1) {
    pages.forEach((p, i) => {
      drawRight(p, `${lab(W.page, L)} ${i + 1} / ${pages.length}`, A4_WIDTH - MARGIN, 20, faces.body, 7.5, MUTED);
    });
  }

  return doc.save();
}

/* ---------- the wrapper the app calls ------------------------------------- */

export interface BuildInvoiceOptions {
  seller?: InvoiceSeller;
  totals?: InvoiceTotals;
  lang?: string | null;
}

/**
 * The order's invoice with the shop's live details — what the letter attaches
 * and the admin downloads. The buyer falls back to the order's own name and
 * e-mail when a row somehow has no company block, so an old order can still
 * be printed rather than refused.
 */
export async function buildInvoicePdf(
  order: Order,
  invoice?: InvoiceRecord | null,
  opts: BuildInvoiceOptions = {},
): Promise<Uint8Array> {
  const record = invoice ?? invoiceOf(order);
  if (!record) throw new Error("no_invoice");
  const lang = invoicePdfLang(opts.lang ?? order.lang);
  const seller = opts.seller ?? (await invoiceSeller());
  const totals = opts.totals ?? invoiceLines(order, record.vatRate, lang);
  const buyer: OrderCompany = companyOf(order.company) ?? {
    name: order.name || order.email,
    regCode: "",
    vatNumber: "",
    address: "",
    email: order.email,
  };
  return renderInvoicePdf({
    number: record.number,
    issueDate: record.issueDate,
    dueAt: record.dueAt,
    orderNumber: order.number,
    lang,
    seller,
    buyer,
    totals,
    currency: order.currency || "EUR",
  });
}
