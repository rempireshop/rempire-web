/**
 * «Скачать чек (PDF)» — the receipt as a file (src/lib/receipt-pdf.ts), a
 * pure function of what it is handed, read back off the page the way the
 * invoice's test reads its own (tests/pdf-text.ts). A receipt that prints
 * the wrong total, loses the VAT line, backs the VAT out at a rate the order
 * was not sold at, or prints a gift card's whole code fails here.
 *
 * The VAT arithmetic is the invoice's own — invoiceLines() in
 * src/lib/invoices.ts, per line, rounded to the cent — so the receipt, the
 * invoice and the accountant's export can never disagree about an order.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { giftPdfFonts } from "@/lib/giftcard-pdf";
import { A4_HEIGHT, A4_WIDTH } from "@/lib/invoice-pdf";
import { invoiceLines, type InvoiceSeller } from "@/lib/invoices";
import { DEFAULT_VAT_RATE } from "@/lib/reports";
import {
  receiptLines,
  receiptPaymentText,
  receiptPdfFilename,
  receiptVatRate,
  renderReceiptPdf,
  type ReceiptOrder,
  type ReceiptPdfData,
} from "@/lib/receipt-pdf";
import { pdfBaselines, pdfRuns, pdfText, type PdfRun } from "./pdf-text";

let faces: { display: PDFFont; body: PDFFont; mono: PDFFont };
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = giftPdfFonts();
  faces = { display: await doc.embedFont(f.display), body: await doc.embedFont(f.body), mono: await doc.embedFont(f.mono) };
});
function widthOf(run: PdfRun): number {
  const face = /oswald/i.test(run.font) ? faces.display : /mono/i.test(run.font) ? faces.mono : faces.body;
  return face.widthOfTextAtSize(run.text, run.size);
}

const SELLER: InvoiceSeller = {
  name: "Rempire Store OÜ",
  regCode: "12216136",
  vatNumber: "EE102723858",
  address: "Mardi 1, 10145 Tallinn",
  email: "info@rempireshop.com",
  phone: "+372 5623 7237",
  iban: "EE38 2200 2210 2014 5685",
  bankName: "Swedbank",
};

const ORDER: ReceiptOrder = {
  items: [{ id: "a", kind: "product", brand: "Kevin.Murphy", title: "Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 }],
  subtotal: 54,
  shippingPrice: 3.19,
  discount: 5,
  discountCode: "SUVI5",
  loyaltyDiscount: 0,
  total: 52.19,
  shipping: { method: "parcel", country: "EE", carrier: "omniva", pointName: "Kristiine keskus", pointType: "parcel_machine", price: 3.19 },
};

function data(over: Partial<ReceiptPdfData> = {}, lang: ReceiptPdfData["lang"] = "ru", order: ReceiptOrder = ORDER, rate = 24): ReceiptPdfData {
  return {
    orderNumber: "R-100042",
    date: "2026-09-12",
    lang,
    seller: SELLER,
    buyer: { name: "Mari Tamm", email: "mari@example.com" },
    totals: receiptLines(order, rate, lang),
    payment: receiptPaymentText({ method: "bank", bank: "Swedbank" }, lang),
    refunds: [],
    currency: "EUR",
    ...over,
  };
}

describe("receipt PDF — the page", () => {
  it("is an A4 portrait a PDF reader opens, named after the order", async () => {
    const bytes = await renderReceiptPdf(data());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(Math.round(A4_WIDTH));
    expect(Math.round(doc.getPage(0).getHeight())).toBe(Math.round(A4_HEIGHT));
    expect(doc.getTitle()).toContain("R-100042");
    expect(bytes.length).toBeLessThan(150_000);
    expect(receiptPdfFilename("R-100042")).toBe("rempire-receipt-R-100042.pdf");
    expect(receiptPdfFilename("R-1/../x")).toBe("rempire-receipt-R-1_x.pdf");
  });

  it("prints the seller, the order as its reference, the lines, the total and the VAT in it", async () => {
    const text = pdfText(await renderReceiptPdf(data())).join("\n");
    expect(text).toContain("ЧЕК");
    expect(text).toContain("Kviitung / Receipt");
    // the seller, as on the invoice: name, address, registry code, KMKR
    expect(text).toContain("Rempire Store OÜ");
    expect(text).toContain("Mardi 1, 10145 Tallinn");
    expect(text).toContain("12216136");
    expect(text).toContain("EE102723858");
    // the order number is the receipt's reference — there is no second counter
    expect(text).toContain("R-100042");
    expect(text).toContain("12.09.2026");
    expect(text).toContain("Mari Tamm");
    // the lines: quantity, unit price with VAT, line total
    expect(text).toContain("Kevin.Murphy Fresh.Hair · 250 мл");
    expect(text).toContain("27,00");
    expect(text).toContain("54,00");
    // delivery names the machine, the promo code its code
    expect(text).toContain("Доставка: Пакомат Omniva — Kristiine keskus");
    expect(text).toContain("3,19");
    expect(text).toContain("Скидка (SUVI5)");
    expect(text).toContain("-5,00");
    // totals: 54 → 43,55 + 10,45; 3,19 → 2,57 + 0,62; −5 → −4,03 − 0,97 (per line, as the invoice)
    expect(text).toContain("Сумма без НДС");
    expect(text).toContain("42,09 €");
    expect(text).toContain("НДС 24 %");
    expect(text).toContain("10,10 €");
    expect(text).toContain("Итого (EUR)");
    expect(text).toContain("52,19 €");
    // how it was paid
    expect(text).toContain("Оплата: Банковская ссылка · Swedbank");
    expect(text).toContain("Все цены включают НДС.");
    // a receipt is not a demand for money: no IBAN box, no due date
    expect(text).not.toContain("EE38 2200");
    expect(text).not.toMatch(/Срок оплаты|Maksetähtaeg/);
    expect(text).not.toContain("�");
  });

  it("foots to the order's own total at the order's own rate — the invoice's arithmetic", async () => {
    const lines = receiptLines(ORDER, 24, "ru");
    const inv = invoiceLines(ORDER, 24, "ru");
    expect({ net: lines.net, vat: lines.vat, total: lines.total }).toEqual({ net: inv.net, vat: inv.vat, total: inv.total });
    expect(lines.total).toBe(52.19);
    // sold at 22 %: backed out at 22 %, and says so
    const at22 = receiptLines(ORDER, 22, "ru");
    expect(at22.vatRate).toBe(22);
    expect(at22.vat).toBe(invoiceLines(ORDER, 22, "ru").vat);
    const text = pdfText(await renderReceiptPdf(data({ totals: at22 }))).join("\n");
    expect(text).toContain("НДС 22 %");
    expect(text).toContain(`${at22.vat.toFixed(2).replace(".", ",")} €`);
  });

  it("reads the rate the way the accountant's export does: the invoice's, then the order's, then 24 %", () => {
    expect(receiptVatRate(22, null)).toBe(22);
    expect(receiptVatRate("24.00", null)).toBe(24);
    expect(receiptVatRate(null, null)).toBe(DEFAULT_VAT_RATE);
    expect(receiptVatRate(undefined, { vatRate: 22 })).toBe(22);
    expect(receiptVatRate(24, { vatRate: 22 })).toBe(22);
    expect(DEFAULT_VAT_RATE).toBe(24);
  });

  it("names a gift card as a gift card, masked, and points as points", async () => {
    const order: ReceiptOrder = { ...ORDER, discount: 20, discountCode: "RMP-ACDE-4679", loyaltyDiscount: 4, total: 33.19 };
    const text = pdfText(await renderReceiptPdf(data({ payment: receiptPaymentText({ method: "card", bank: null }, "ru") }, "ru", order))).join("\n");
    expect(text).toContain("Подарочная карта RMP-••••-4679");
    expect(text).toContain("-20,00");
    expect(text).toContain("Баллы");
    expect(text).toContain("-4,00");
    expect(text).toContain("33,19 €");
    expect(text).toContain("Оплата: Банковская карта");
    expect(text).not.toContain("ACDE");
    expect(text).not.toContain("Скидка");
  });

  it("shows a free delivery as a line of its own, and none on an all-gift-card order", async () => {
    const free = receiptLines({ ...ORDER, shippingPrice: 0, discount: 0, discountCode: null, total: 54 }, 24, "ru");
    const ship = free.lines.find((l) => l.kind === "shipping");
    expect(ship).toMatchObject({ title: "Доставка: Пакомат Omniva — Kristiine keskus", gross: 0, net: 0, vat: 0 });
    expect(free.total).toBe(54);
    const digital = receiptLines(
      { ...ORDER, items: [{ id: "gift:50", kind: "gift", title: "Подарочная карта 50 €", qty: 1, price: 50, sum: 50 }], subtotal: 50, shippingPrice: 0, discount: 0, discountCode: null, total: 50, shipping: { method: "digital", country: "EE", price: 0 } },
      24,
      "ru",
    );
    expect(digital.lines.map((l) => l.kind)).toEqual(["item"]);
  });

  it("prints a courier's address and a pickup at the salon", () => {
    const courier = receiptLines({ ...ORDER, shipping: { method: "courier", country: "EE", carrier: "dpd", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" }, price: 6.89 }, shippingPrice: 6.89 }, 24, "et");
    expect(courier.lines.find((l) => l.kind === "shipping")!.title).toBe("Tarne: Kuller DPD — Testitänav 1, 10111, Tallinn");
    const pickup = receiptLines({ ...ORDER, shipping: { method: "pickup", country: "EE", price: 0 }, shippingPrice: 0 }, 24, "en", "Mardi 1, 10145 Tallinn");
    expect(pickup.lines.find((l) => l.kind === "shipping")!.title).toBe("Delivery: Pickup — Mardi 1, 10145 Tallinn");
  });

  it("is written in the page's language — Estonian and English carry no Russian headings", async () => {
    const et = pdfText(await renderReceiptPdf(data({}, "et"))).join("\n");
    expect(et).toContain("KVIITUNG");
    expect(et).toContain("Receipt");
    expect(et).toContain("MÜÜJA");
    expect(et).toContain("Käibemaks 24 %");
    expect(et).toContain("Makseviis: Pangalink · Swedbank");
    expect(et).toContain("Tarne: Pakiautomaat Omniva — Kristiine keskus");
    expect(et).toContain("250 ml");
    expect(et).not.toMatch(/Продавец|Чек|Доставка|Скидка|Итого|НДС/);

    const en = pdfText(await renderReceiptPdf(data({}, "en"))).join("\n");
    expect(en).toContain("RECEIPT");
    expect(en).toContain("Kviitung");
    expect(en).toContain("SELLER");
    expect(en).toContain("VAT 24 %");
    expect(en).toContain("Payment: Bank link · Swedbank");
    expect(en).toContain("Delivery: Omniva parcel locker — Kristiine keskus");
    expect(en).not.toMatch(/Продавец|Чек|Доставка|Скидка|Итого|НДС/);
  });

  it("names every way the shop takes money, in all three languages", () => {
    const words = (m: string, bank: string | null = null) =>
      (["ru", "et", "en"] as const).map((l) => receiptPaymentText({ method: m as never, bank }, l));
    expect(words("card")).toEqual(["Банковская карта", "Pangakaart", "Bank card"]);
    expect(words("wallet")).toEqual(["Apple Pay / Google Pay", "Apple Pay / Google Pay", "Apple Pay / Google Pay"]);
    expect(words("giftcard")).toEqual(["Подарочная карта", "Kinkekaart", "Gift card"]);
    expect(words("points")).toEqual(["Баллы", "Boonuspunktid", "Loyalty points"]);
    expect(words("cash")).toEqual(["Наличные", "Sularaha", "Cash"]);
    expect(words("terminal")).toEqual(["Терминал", "Kaardimakse", "Card terminal"]);
    // a BIC is named from the shop's own list of banks; an unknown one stays a code
    expect(words("bank", "LHVBEE22")[0]).toBe("Банковская ссылка · LHV");
    expect(words("bank", "RVUALT2V")[2]).toBe("Bank link · Revolut");
    expect(words("bank", "ZZZZEE22")[0]).toBe("Банковская ссылка · ZZZZEE22");
    expect(receiptPaymentText(null, "ru")).toBe("");
  });

  it("lists the refunds under the sale — what went back, what is on its way, and the sum", async () => {
    const text = pdfText(
      await renderReceiptPdf(
        data({
          refunds: [
            { amount: 10, status: "done", toGiftCard: false, at: "2026-09-15T10:00:00.000Z" },
            { amount: 7, status: "done", toGiftCard: true, at: "2026-09-16T10:00:00.000Z" },
            { amount: 5, status: "pending", toGiftCard: false, at: "2026-09-17T10:00:00.000Z" },
          ],
        }),
      ),
    ).join("\n");
    expect(text).toContain("ВОЗВРАТЫ");
    expect(text).toContain("15.09.2026");
    expect(text).toContain("Возвращено");
    expect(text).toContain("Возвращено на подарочную карту");
    expect(text).toContain("Возврат в обработке");
    expect(text).toContain("-10,00 €");
    expect(text).toContain("-7,00 €");
    expect(text).toContain("-5,00 €");
    // what the bank or the card ledger confirmed — a pending refund is not in it yet
    expect(text).toContain("Итого возвращено");
    expect(text).toContain("-17,00 €");
    expect(text).toContain("Чек показывает покупку так, как она была оплачена; возвраты перечислены ниже.");
    // the sale itself is untouched
    expect(text).toContain("52,19 €");
  });

  it("says a whole order went back even when the refund left no line of its own", async () => {
    const text = pdfText(await renderReceiptPdf(data({ refundedWhole: true }))).join("\n");
    expect(text).toContain("ВОЗВРАТЫ");
    expect(text).toContain("Заказ возвращён полностью");
    expect(text).toContain("-52,19 €");
  });

  it("keeps every baseline inside the printable inset and never draws two runs over each other", async () => {
    const heavy = data({
      refunds: [{ amount: 10, status: "done", toGiftCard: false, at: "2026-09-15T10:00:00.000Z" }],
    });
    for (const lang of ["ru", "et", "en"] as const) {
      const d = { ...heavy, lang, totals: receiptLines(ORDER, 24, lang), payment: receiptPaymentText({ method: "bank", bank: "Swedbank" }, lang) };
      const bytes = await renderReceiptPdf(d);
      for (const { x, y } of pdfBaselines(bytes)) {
        expect(y).toBeGreaterThanOrEqual(18);
        expect(y).toBeLessThanOrEqual(A4_HEIGHT - 18);
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(A4_WIDTH - 40);
      }
      const runs = pdfRuns(bytes);
      const lines = new Map<string, PdfRun[]>();
      for (const r of runs) {
        const key = `${r.stream}:${Math.round(r.y)}`;
        lines.set(key, [...(lines.get(key) ?? []), r]);
      }
      for (const row of lines.values()) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          // the wordmark is drawn letter by letter with its own tracking
          if (prev.text.length === 1 && sorted[i].text.length === 1) continue;
          expect(sorted[i].x, `${lang}: «${sorted[i].text}» starts inside «${prev.text}»`).toBeGreaterThanOrEqual(prev.x + widthOf(prev) - 0.5);
        }
      }
    }
  });

  it("goes onto a second page when an order is long, and numbers the pages", async () => {
    const many: ReceiptOrder = {
      ...ORDER,
      items: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, kind: "product" as const, brand: "Davines", title: `Товар номер ${i + 1}`, variant: "100 мл", qty: 1, price: 10, sum: 10 })),
      subtotal: 400,
      discount: 0,
      discountCode: null,
      total: 403.19,
    };
    const bytes = await renderReceiptPdf(data({ refunds: [{ amount: 10, status: "done", toGiftCard: false, at: "2026-09-15T10:00:00.000Z" }] }, "ru", many));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = pdfText(bytes).join("\n");
    expect(text).toContain("Товар номер 40");
    expect(text).toContain("403,19 €");
    expect(text).toContain(`стр. 1 / ${doc.getPageCount()}`);
    for (const { y } of pdfBaselines(bytes)) expect(y).toBeGreaterThanOrEqual(18);
  });
});
