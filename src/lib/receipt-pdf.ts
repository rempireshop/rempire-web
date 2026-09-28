/**
 * «Скачать чек (PDF)» — the receipt of a paid order, one A4 page (more when
 * an order is long), for «Мой кабинет → Мои заказы» (Dim, 28.09.2026).
 *
 * The invoice's machinery, not a second one: the same pdf-lib + fontkit pair,
 * the same three faces, the tower and the wordmark, the same margin and inks
 * (src/lib/invoice-pdf.ts), and — above all — the same money. The lines and
 * the VAT come from invoiceLines() in src/lib/invoices.ts: every figure is
 * VAT-inclusive and the VAT is backed out PER LINE, rounded to the cent, so a
 * receipt, an invoice and the accountant's export can never disagree about
 * what an order cost or what tax was in it.
 *
 * What differs is who reads it. An invoice is a demand for money made out to
 * a company, bilingual for its accountant; a receipt is a private customer's
 * record of a purchase already paid. So it is written in ONE language — the
 * page's, handed over by the account link (?lang=) — with the Estonian and
 * English names of the document under its title, as the invoice keeps them
 * in its heading; it carries no payment box and no due date; and it says how
 * the order was paid.
 *
 * The reference is the order number. There is no receipt counter: the order
 * number is already unique, sequential and what the customer, the letters
 * and the shop all quote.
 *
 * VAT rate: the one the order was sold under — `orders.vat_rate`, stamped by
 * createOrder() since db/migrations/190 — read exactly as the accountant's
 * export reads it (src/lib/reports.ts rateFor): the invoice's frozen rate
 * first, then the order's, then DEFAULT_VAT_RATE (24 %). It is NOT
 * date-aware: an order older than migration 190 carries no rate and prints
 * 24 % whatever day it was sold, which is right for everything since
 * 01.07.2025 (22 → 24 %) and the same number the export files for it.
 *
 * A refunded order's receipt still shows the sale as it was paid — that is
 * what happened at the till — and lists the refunds under it: each with its
 * date, where it went (the bank account or the gift card that paid) and
 * whether the bank has confirmed it yet, and the sum the bank confirmed.
 *
 * Pure at the core: renderReceiptPdf() prints only what it is handed, so a
 * test can read the text back without a database. buildReceiptPdf() is the
 * wrapper the route calls — it fetches the seller from settings and the rate
 * from the order row.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { deliveryLine } from "@/emails/common";
import type { OrderShipping as MailShipping } from "@/emails/types";
import { maskGiftCode, paymentOf, refundsOf, type CustomerPayment, type CustomerRefund } from "@/lib/account-orders";
import { query } from "@/lib/db";
import { giftPdfFonts, humanDate, wrapText } from "@/lib/giftcard-pdf";
import {
  A4_HEIGHT,
  A4_WIDTH,
  amount,
  clean,
  drawRight,
  drawTower,
  drawWordmark,
  euro,
  INK,
  invoicePdfLang,
  MARGIN,
  MUTED,
  PAPER,
  qtyText,
  RULE,
  type PdfLang,
} from "@/lib/invoice-pdf";
import { invoiceLines, invoiceOf, invoiceSeller, type InvoiceSeller, type InvoiceTotals } from "@/lib/invoices";
import { shopDay } from "@/lib/day";
import type { Order, OrderItem } from "@/lib/orders";
import { isPosNoName } from "@/lib/pos-name";
import { looksLikeGiftCode } from "@/lib/promos";
import { DEFAULT_VAT_RATE, resolveVatRate } from "@/lib/reports";

/* ---------- names ---------------------------------------------------------- */

/** `rempire-receipt-R-100042.pdf` — the download's name. */
export function receiptPdfFilename(orderNumber: string): string {
  return `rempire-receipt-${String(orderNumber || "receipt").replace(/[^A-Za-z0-9-]+/g, "_")}.pdf`;
}

/* ---------- copy ----------------------------------------------------------- */

type Tri = { ru: string; et: string; en: string };

const W = {
  title: { ru: "Чек", et: "Kviitung", en: "Receipt" },
  order: { ru: "Заказ", et: "Tellimus", en: "Order" },
  date: { ru: "Дата", et: "Kuupäev", en: "Date" },
  seller: { ru: "Продавец", et: "Müüja", en: "Seller" },
  buyer: { ru: "Покупатель", et: "Ostja", en: "Buyer" },
  regCode: { ru: "Рег. код", et: "Registrikood", en: "Reg. code" },
  vatNo: { ru: "Номер НДС (KMKR)", et: "KMKR nr", en: "VAT no" },
  desc: { ru: "Наименование", et: "Kirjeldus", en: "Description" },
  qty: { ru: "Кол-во", et: "Kogus", en: "Qty" },
  unit: { ru: "Цена с НДС", et: "Hind (km-ga)", en: "Unit (incl. VAT)" },
  sum: { ru: "Сумма", et: "Summa", en: "Amount" },
  net: { ru: "Сумма без НДС", et: "Summa ilma käibemaksuta", en: "Subtotal excl. VAT" },
  vat: { ru: "НДС {r} %", et: "Käibemaks {r} %", en: "VAT {r} %" },
  total: { ru: "Итого", et: "Kokku", en: "Total" },
  delivery: { ru: "Доставка", et: "Tarne", en: "Delivery" },
  pickup: { ru: "Самовывоз", et: "Järeletulek", en: "Pickup" },
  discount: { ru: "Скидка", et: "Allahindlus", en: "Discount" },
  giftCard: { ru: "Подарочная карта", et: "Kinkekaart", en: "Gift card" },
  points: { ru: "Баллы", et: "Boonuspunktid", en: "Loyalty points" },
  payment: { ru: "Оплата", et: "Makseviis", en: "Payment" },
  pricesNote: { ru: "Все цены включают НДС.", et: "Kõik hinnad sisaldavad käibemaksu.", en: "All prices include VAT." },
  refunds: { ru: "Возвраты", et: "Tagastused", en: "Refunds" },
  refundDone: { ru: "Возвращено", et: "Tagastatud", en: "Refunded" },
  refundGift: { ru: "Возвращено на подарочную карту", et: "Tagastatud kinkekaardile", en: "Refunded to the gift card" },
  refundPending: { ru: "Возврат в обработке", et: "Tagastus on töös", en: "Refund in progress" },
  refundWhole: { ru: "Заказ возвращён полностью", et: "Tellimus tagastati täielikult", en: "The order was refunded in full" },
  refundTotal: { ru: "Итого возвращено", et: "Kokku tagastatud", en: "Total refunded" },
  refundNote: {
    ru: "Чек показывает покупку так, как она была оплачена; возвраты перечислены ниже.",
    et: "Kviitung näitab ostu nii, nagu see tasuti; tagastused on loetletud allpool.",
    en: "The receipt shows the purchase as it was paid; refunds are listed below.",
  },
  page: { ru: "стр.", et: "lk", en: "page" },
} satisfies Record<string, Tri>;

/** How it was paid, in the words the storefront and the order card already use. */
const PAY_WORDS: Record<CustomerPayment["method"], Tri> = {
  bank: { ru: "Банковская ссылка", et: "Pangalink", en: "Bank link" },
  card: { ru: "Банковская карта", et: "Pangakaart", en: "Bank card" },
  wallet: { ru: "Apple Pay / Google Pay", et: "Apple Pay / Google Pay", en: "Apple Pay / Google Pay" },
  invoice: { ru: "По счёту", et: "Arvega", en: "By invoice" },
  giftcard: { ru: "Подарочная карта", et: "Kinkekaart", en: "Gift card" },
  points: { ru: "Баллы", et: "Boonuspunktid", en: "Loyalty points" },
  promo: { ru: "Промокод", et: "Sooduskood", en: "Promo code" },
  cash: { ru: "Наличные", et: "Sularaha", en: "Cash" },
  terminal: { ru: "Терминал", et: "Kaardimakse", en: "Card terminal" },
};

/* The banks by BIC — the storefront's own five (BANK_CODES in
   public/shop2/app.js) and the three international ones the order card knows
   (BANK_NAMES_ABROAD). Only for a payment that did not carry the bank's name
   itself; Montonio's payments do («paymentInitiation · Swedbank»). */
const BANKS: Record<string, string> = {
  HABAEE2X: "Swedbank",
  EEUHEE2X: "SEB",
  LHVBEE22: "LHV",
  RIKOEE22: "Luminor",
  EKRDEE22: "Coop",
  RVUALT2V: "Revolut",
  NTSBDEB1: "N26",
  TRWIGB2L: "Wise",
};

/** «Банковская ссылка · Swedbank», «Pangakaart», «Apple Pay / Google Pay» — "" when nothing is known. */
export function receiptPaymentText(payment: CustomerPayment | null, lang: PdfLang): string {
  if (!payment) return "";
  const word = PAY_WORDS[payment.method]?.[lang] ?? "";
  const bank = payment.bank ? BANKS[payment.bank] ?? payment.bank : "";
  return [word, bank].filter(Boolean).join(" · ");
}

/**
 * The rate this order is printed at — the accountant export's own order of
 * authority (src/lib/reports.ts rateFor, which is private to that module):
 * the invoice's frozen rate, then `orders.vat_rate`, then the constant.
 */
export function receiptVatRate(orderRate: unknown, invoice?: unknown): number {
  const inv = invoice && typeof invoice === "object" ? (invoice as { vatRate?: unknown }).vatRate : undefined;
  if (inv != null) return resolveVatRate(inv);
  if (orderRate != null) return resolveVatRate(orderRate);
  return DEFAULT_VAT_RATE;
}

/* ---------- the lines ------------------------------------------------------ */

export type ReceiptOrder = {
  items: OrderItem[];
  subtotal: number;
  shippingPrice: number;
  discount: number;
  discountCode?: string | null;
  loyaltyDiscount: number;
  total: number;
  shipping: Record<string, unknown> | null;
};

/** «Пакомат Omniva — Kristiine keskus», «Kuller DPD — Testitänav 1, …», «Pickup — Mardi 1, …»; "" for a gift card. */
function deliveryText(shipping: Record<string, unknown> | null, lang: PdfLang, pickupAt: string): string {
  const method = String(shipping?.method ?? "");
  if (!shipping || method === "digital") return "";
  if (method === "pickup") return [W.pickup[lang], clean(pickupAt, 200)].filter(Boolean).join(" — ");
  return deliveryLine(shipping as MailShipping, lang);
}

/**
 * The receipt's lines: invoiceLines() — the items with their names in the
 * receipt's language, the delivery, the code, the points, the VAT backed out
 * per line — with the invoice's bilingual line titles («Tarne / Delivery /
 * Доставка») put into the one language this document is written in, the
 * delivery named, and the code told apart: a promo code is a discount, a gift
 * card is money the customer had already paid, named as such and masked
 * (maskGiftCode). The numbers are the invoice's, untouched.
 *
 * A delivery that cost nothing still gets its line, at 0,00: the receipt says
 * where the parcel went. An all-gift-card order has no delivery at all.
 */
export function receiptLines(order: ReceiptOrder, vatRate: number, lang: PdfLang, pickupAt = ""): InvoiceTotals {
  const base = invoiceLines(order, vatRate, lang);
  const where = deliveryText(order.shipping, lang, pickupAt);
  const shipTitle = where ? `${W.delivery[lang]}: ${where}` : W.delivery[lang];
  const code = typeof order.discountCode === "string" ? order.discountCode.trim() : "";
  const gift = !!code && looksLikeGiftCode(code);
  /* invoiceLines() writes the code's line before the points' line, and the
     code's only when the order carries a discount — so with two discount
     lines the first is the code's, and with one it is the code's exactly
     when the order has a discount at all. */
  const discounts = base.lines.filter((l) => l.kind === "discount");
  const codeLine = discounts.length === 2 || (discounts.length === 1 && Number(order.discount) > 0) ? discounts[0] : null;
  const lines = base.lines.map((l) => {
    if (l.kind === "shipping") return { ...l, title: shipTitle };
    if (l.kind !== "discount") return l;
    if (l !== codeLine) return { ...l, title: W.points[lang] };
    if (gift) return { ...l, title: `${W.giftCard[lang]} ${maskGiftCode(code)}` };
    return { ...l, title: code ? `${W.discount[lang]} (${code})` : W.discount[lang] };
  });
  if (where && !lines.some((l) => l.kind === "shipping")) {
    const at = lines.findIndex((l) => l.kind === "discount");
    const free = { kind: "shipping" as const, title: shipTitle, qty: 1, unitGross: 0, gross: 0, net: 0, vat: 0 };
    lines.splice(at < 0 ? lines.length : at, 0, free);
  }
  return { ...base, lines };
}

/* ---------- the data ------------------------------------------------------- */

export interface ReceiptPdfData {
  orderNumber: string;
  /** `YYYY-MM-DD` on the Tallinn calendar — printed as dd.mm.yyyy. */
  date: string;
  lang: PdfLang;
  seller: InvoiceSeller;
  buyer: { name: string; email: string };
  totals: InvoiceTotals;
  /** receiptPaymentText() — "" prints no payment line. */
  payment: string;
  refunds: CustomerRefund[];
  /** A `refunded` order whose money went back without a refund entry (handed over by hand). */
  refundedWhole?: boolean;
  currency?: string;
}

/* the table's columns — the right edge of every numeric column */
const COL = {
  descX: MARGIN,
  descW: 300,
  qty: 390,
  unit: 470,
  sum: A4_WIDTH - MARGIN,
} as const;

interface Faces {
  display: PDFFont;
  body: PDFFont;
  mono: PDFFont;
}

function r(word: Tri, lang: PdfLang, rate?: number): string {
  const s = word[lang];
  return rate == null ? s : s.replace("{r}", String(rate));
}

/**
 * The receipt, as bytes. Pure: nothing here reads a database or the
 * environment, so the layout can be asserted against known input.
 */
export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const L = data.lang;
  const number = clean(data.orderNumber, 20);
  if (!number) throw new Error("bad_order_number");
  const rate = data.totals.vatRate;
  const fonts = giftPdfFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const faces: Faces = {
    display: await doc.embedFont(fonts.display, { subset: true }),
    body: await doc.embedFont(fonts.body, { subset: true }),
    mono: await doc.embedFont(fonts.mono, { subset: true }),
  };
  doc.setTitle(`${W.title[L]} ${number} — Rempire`);
  doc.setSubject(`${W.order[L]} ${number}`);
  doc.setProducer("rempireshop.com");
  doc.setCreator("rempireshop.com");

  const s = data.seller;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = (): void => {
    page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: PAPER });
    pages.push(page);
    y = A4_HEIGHT - MARGIN;
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
  /** A fresh page when fewer than `need` points are left above the footer. */
  const room = (need: number, onBreak?: () => void): void => {
    if (y - need >= 60) return;
    footer();
    newPage();
    page.drawText(`${W.order[L]} ${number}`, { x: MARGIN, y, size: 9, font: faces.body, color: MUTED });
    y -= 26;
    onBreak?.();
  };

  newPage();

  /* ---- the mark and the title: the page's word, the Estonian and English ones under it ---- */
  drawTower(page, MARGIN, y + 4, 40);
  drawWordmark(page, "REMPIRE", MARGIN + 36, y - 22, faces.display, 20, 3);
  drawRight(page, W.title[L].toUpperCase(), A4_WIDTH - MARGIN, y - 18, faces.display, 26);
  const others = (["et", "en"] as const).filter((l) => l !== L).map((l) => W.title[l]).join(" / ");
  drawRight(page, others, A4_WIDTH - MARGIN, y - 34, faces.body, 10, MUTED);
  y -= 62;

  /* ---- order and date — right column; seller and buyer — left column ---- */
  const metaTop = y;
  let my = metaTop;
  for (const [label, value, font] of [
    [W.order[L], number, faces.mono],
    [W.date[L], humanDate(data.date), faces.body],
  ] as Array<[string, string, PDFFont]>) {
    drawRight(page, value, A4_WIDTH - MARGIN, my, font, 10);
    drawRight(page, label, A4_WIDTH - MARGIN - font.widthOfTextAtSize(value, 10) - 10, my, faces.body, 8, MUTED);
    my -= 15;
  }

  const partyBlock = (title: string, rows: string[], top: number, width: number): number => {
    let py = top;
    page.drawText(title.toUpperCase(), { x: MARGIN, y: py, size: 7.5, font: faces.body, color: MUTED });
    py -= 14;
    rows.filter(Boolean).forEach((row, i) => {
      for (const line of wrapText(row, faces.body, i === 0 ? 10.5 : 9, width, 2)) {
        page.drawText(line, { x: MARGIN, y: py, size: i === 0 ? 10.5 : 9, font: faces.body, color: INK });
        py -= i === 0 ? 14 : 12;
      }
    });
    return py;
  };
  const sellerBottom = partyBlock(
    W.seller[L],
    [
      clean(s.name, 120),
      clean(s.address, 200),
      s.regCode ? `${W.regCode[L]}: ${clean(s.regCode, 20)}` : "",
      s.vatNumber ? `${W.vatNo[L]}: ${clean(s.vatNumber, 20)}` : "",
      [clean(s.email, 100), clean(s.phone, 30)].filter(Boolean).join(" · "),
    ],
    metaTop,
    300,
  );
  const buyerRows = [clean(data.buyer.name, 120), clean(data.buyer.email, 160)].filter(Boolean);
  y = Math.min(my, sellerBottom) - 8;
  if (buyerRows.length) y = partyBlock(W.buyer[L], buyerRows, y, 300);
  y -= 14;

  /* ---- the table ---- */
  const tableHead = (): void => {
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4_WIDTH - MARGIN, y: y + 2 }, thickness: 1, color: INK });
    page.drawText(W.desc[L], { x: COL.descX, y: y - 10, size: 7.5, font: faces.body, color: INK });
    drawRight(page, W.qty[L], COL.qty, y - 10, faces.body, 7.5);
    drawRight(page, W.unit[L], COL.unit, y - 10, faces.body, 7.5);
    drawRight(page, W.sum[L], COL.sum, y - 10, faces.body, 7.5);
    y -= 18;
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: A4_WIDTH - MARGIN, y: y + 4 }, thickness: 0.6, color: RULE });
    y -= 12;
  };
  tableHead();
  for (const line of data.totals.lines) {
    const desc = wrapText(clean(line.title, 240), faces.body, 9, COL.descW, 3);
    const rowH = Math.max(1, desc.length) * 12 + 4;
    room(rowH + 10, tableHead);
    desc.forEach((t, i) => page.drawText(t, { x: COL.descX, y: y - i * 12, size: 9, font: faces.body, color: INK }));
    drawRight(page, qtyText(line.qty), COL.qty, y, faces.body, 9);
    drawRight(page, amount(line.unitGross), COL.unit, y, faces.body, 9);
    drawRight(page, amount(line.gross), COL.sum, y, faces.body, 9);
    y -= rowH;
    /* 5 pt under the row's last baseline, clear of the next row's capitals
       (at +6, the invoice's offset, the hairline ran through their tops) */
    page.drawLine({ start: { x: MARGIN, y: y + 11 }, end: { x: A4_WIDTH - MARGIN, y: y + 11 }, thickness: 0.4, color: RULE });
  }

  /* ---- the totals, the payment and the VAT note: kept together ---- */
  const payLines = data.payment ? wrapText(`${W.payment[L]}: ${clean(data.payment, 120)}`, faces.body, 9.5, A4_WIDTH - 2 * MARGIN, 2) : [];
  room(96 + payLines.length * 14);
  y -= 6;
  const cur = clean(data.currency || "EUR", 3) || "EUR";
  const totalsRows: Array<[string, string, boolean]> = [
    [W.net[L], euro(data.totals.net), false],
    [r(W.vat, L, rate), euro(data.totals.vat), false],
    [`${W.total[L]} (${cur})`, euro(data.totals.total), true],
  ];
  for (const [label, value, strong] of totalsRows) {
    if (strong) {
      page.drawLine({ start: { x: COL.qty - 60, y: y + 12 }, end: { x: A4_WIDTH - MARGIN, y: y + 12 }, thickness: 1, color: INK });
      y -= 4;
    }
    drawRight(page, value, COL.sum, y, strong ? faces.display : faces.body, strong ? 13 : 10);
    drawRight(page, label, COL.sum - (strong ? 90 : 80), y, faces.body, strong ? 9 : 8.5, strong ? INK : MUTED);
    y -= strong ? 22 : 16;
  }
  for (const line of payLines) {
    page.drawText(line, { x: MARGIN, y, size: 9.5, font: faces.body, color: INK });
    y -= 14;
  }
  page.drawText(W.pricesNote[L], { x: MARGIN, y, size: 8.5, font: faces.body, color: MUTED });
  y -= 22;

  /* ---- refunds, under the sale ---- */
  const refunds = data.refunds.filter((f) => f.amount > 0);
  if (refunds.length || data.refundedWhole) {
    const rows: Array<[string, string, string]> = refunds.length
      ? refunds.map((f) => [
          f.at ? humanDate(shopDay(f.at)) : "",
          f.status === "pending" ? W.refundPending[L] : f.toGiftCard ? W.refundGift[L] : W.refundDone[L],
          euro(-f.amount),
        ])
      : [["", W.refundWhole[L], euro(-data.totals.total)]];
    const done = refunds.length
      ? Math.round(refunds.filter((f) => f.status === "done").reduce((sum, f) => sum + f.amount, 0) * 100) / 100
      : data.totals.total;
    room(40 + rows.length * 14 + 40);
    page.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: A4_WIDTH - MARGIN, y: y + 10 }, thickness: 1, color: INK });
    page.drawText(W.refunds[L].toUpperCase(), { x: MARGIN, y: y - 4, size: 7.5, font: faces.body, color: MUTED });
    y -= 20;
    for (const [date, what, value] of rows) {
      room(28);
      if (date) page.drawText(date, { x: MARGIN, y, size: 9, font: faces.body, color: INK });
      page.drawText(what, { x: MARGIN + 70, y, size: 9, font: faces.body, color: INK });
      drawRight(page, value, COL.sum, y, faces.body, 9.5);
      y -= 14;
    }
    room(40);
    y -= 4;
    drawRight(page, euro(-done), COL.sum, y, faces.display, 11);
    drawRight(page, W.refundTotal[L], COL.sum - 90, y, faces.body, 9, INK);
    y -= 18;
    for (const line of wrapText(W.refundNote[L], faces.body, 8.5, A4_WIDTH - 2 * MARGIN, 2)) {
      room(16);
      page.drawText(line, { x: MARGIN, y, size: 8.5, font: faces.body, color: MUTED });
      y -= 12;
    }
  }
  footer();

  if (pages.length > 1) {
    pages.forEach((p, i) => drawRight(p, `${W.page[L]} ${i + 1} / ${pages.length}`, A4_WIDTH - MARGIN, 20, faces.body, 7.5, MUTED));
  }
  return doc.save();
}

/* ---------- the wrapper the route calls ------------------------------------ */

export interface BuildReceiptOptions {
  lang?: string | null;
  seller?: InvoiceSeller;
  /** The order's own `vat_rate`; read from the row when not handed over. */
  vatRate?: number | string | null;
}

/** `orders.vat_rate` for one order — not on the Order type (mapOrder does not carry it). */
async function orderVatRate(orderId: string): Promise<unknown> {
  try {
    const rows = await query<{ vat_rate: string | number | null }>("select vat_rate from orders where id = $1", [orderId]);
    return rows[0]?.vat_rate ?? null;
  } catch {
    // a deployment one migration behind has no column — the export's fallback, the same number
    return null;
  }
}

/**
 * The order's receipt with the shop's live details. Rendered on demand like
 * the account's invoice — nothing is stored, so a corrected address in
 * «Настройки → О компании» is on the next download.
 */
export async function buildReceiptPdf(order: Order, opts: BuildReceiptOptions = {}): Promise<Uint8Array> {
  const lang = invoicePdfLang(opts.lang ?? order.lang);
  const seller = opts.seller ?? (await invoiceSeller());
  const rate = receiptVatRate(opts.vatRate !== undefined ? opts.vatRate : await orderVatRate(order.id), invoiceOf(order));
  const totals = receiptLines(
    {
      items: order.items,
      subtotal: order.subtotal,
      shippingPrice: order.shippingPrice,
      discount: order.discount,
      discountCode: order.discountCode,
      loyaltyDiscount: order.loyaltyDiscount,
      total: order.total,
      shipping: order.shipping as unknown as Record<string, unknown>,
    },
    rate,
    lang,
    seller.address,
  );
  const refunds = refundsOf(order.payment);
  return renderReceiptPdf({
    orderNumber: order.number,
    date: shopDay(order.createdAt) || order.createdAt.slice(0, 10),
    lang,
    seller,
    buyer: { name: isPosNoName(order.name) ? "" : order.name, email: order.email },
    totals,
    payment: receiptPaymentText(paymentOf(order.status, order.payment), lang),
    refunds,
    refundedWhole: order.status === "refunded" && refunds.length === 0,
    currency: order.currency || "EUR",
  });
}
