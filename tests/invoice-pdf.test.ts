/**
 * The invoice as a file — src/lib/invoice-pdf.ts renderInvoicePdf(), a pure
 * function of what it is handed. "The text is on the page" is checked by
 * really reading it back (tests/pdf-text.ts), so a page that lost the KMKR
 * number, the due date or a Cyrillic heading fails here — the legal minimum
 * of VAT Act §37 is asserted field by field.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { A4_HEIGHT, A4_WIDTH, amount, invoicePdfFilename, renderInvoicePdf, type InvoicePdfData } from "@/lib/invoice-pdf";
import { invoiceLines, type InvoiceSeller, type OrderCompany } from "@/lib/invoices";
import { pdfBaselines, pdfText } from "./pdf-text";

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

const BUYER: OrderCompany = {
  name: "Salong Näidis OÜ",
  regCode: "16123456",
  vatNumber: "EE101234567",
  address: "Pärnu mnt 10, 10148 Tallinn",
  email: "raamatupidaja@example.com",
};

const ORDER = {
  items: [
    { id: "a", kind: "product" as const, brand: "Kevin.Murphy", title: "Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 },
    { id: "b", kind: "product" as const, brand: "Proraso", title: "Wood & Spice масло для бороды", variant: null, qty: 1, price: 17, sum: 17 },
  ],
  subtotal: 71,
  shippingPrice: 5.47,
  discount: 5,
  loyaltyDiscount: 0,
  total: 71.47,
  discountCode: "SUVI5",
};

function data(over: Partial<InvoicePdfData> = {}, lang: InvoicePdfData["lang"] = "ru"): InvoicePdfData {
  return {
    number: "A-2026-0007",
    issueDate: "2026-09-06",
    dueAt: "2026-09-13",
    orderNumber: "R-100042",
    lang,
    seller: SELLER,
    buyer: BUYER,
    totals: invoiceLines(ORDER, 24, lang),
    currency: "EUR",
    ...over,
  };
}

describe("invoice PDF — the page", () => {
  it("is an A4 portrait a PDF reader opens, named after the number", async () => {
    const bytes = await renderInvoicePdf(data());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(Math.round(page.getWidth())).toBe(Math.round(A4_WIDTH));
    expect(Math.round(page.getHeight())).toBe(Math.round(A4_HEIGHT));
    expect(page.getHeight()).toBeGreaterThan(page.getWidth());
    expect(doc.getTitle()).toContain("A-2026-0007");
    expect(bytes.length).toBeLessThan(150_000);
    expect(invoicePdfFilename("A-2026-0007")).toBe("rempire-invoice-A-2026-0007.pdf");
  });

  it("prints every field the VAT Act asks for", async () => {
    const text = pdfText(await renderInvoicePdf(data())).join("\n");
    // the seller: name, address, registry code, KMKR
    expect(text).toContain("Rempire Store OÜ");
    expect(text).toContain("Mardi 1, 10145 Tallinn");
    expect(text).toContain("12216136");
    expect(text).toContain("EE102723858");
    // the buyer: name, address, registry code, VAT number
    expect(text).toContain("Salong Näidis OÜ");
    expect(text).toContain("Pärnu mnt 10, 10148 Tallinn");
    expect(text).toContain("16123456");
    expect(text).toContain("EE101234567");
    // number, dates, the order as the reference
    expect(text).toContain("A-2026-0007");
    expect(text).toContain("06.09.2026");
    expect(text).toContain("13.09.2026");
    expect(text).toContain("R-100042");
    // the lines: description, quantity, unit price, net, VAT, total
    expect(text).toContain("Kevin.Murphy Fresh.Hair · 250 мл");
    expect(text).toContain("27,00");
    expect(text).toContain("54,00");
    expect(text).toContain("43,55"); // 54 / 1.24
    expect(text).toContain("10,45"); // its VAT
    // delivery and the discount as lines of their own
    expect(text).toContain("Tarne / Delivery / Доставка");
    expect(text).toContain("5,47");
    expect(text).toContain("Allahindlus / Discount / Скидка (SUVI5)");
    expect(text).toContain("-5,00");
    // the totals, in EUR
    expect(text).toContain("Kokku tasuda / Total due / Итого к оплате (EUR)");
    expect(text).toContain("71,47 €");
    expect(text).toContain("KM 24 %");
    expect(text).toContain("Käibemaks 24 % / VAT 24 % / НДС 24 %");
    // how to pay
    expect(text).toContain("EE38 2200 2210 2014 5685");
    expect(text).toContain("Swedbank");
    expect(text).toContain("R-100042, A-2026-0007");
    // no glyph came out as .notdef
    expect(text).not.toContain("�");
  });

  it("keeps the Estonian/English headings and adds Russian only on a Russian order", async () => {
    const ru = pdfText(await renderInvoicePdf(data({}, "ru"))).join("\n");
    expect(ru).toContain("ARVE");
    expect(ru).toContain("Invoice");
    expect(ru).toContain("Счёт");
    expect(ru).toContain("MÜÜJA / SELLER / ПРОДАВЕЦ");

    const et = pdfText(await renderInvoicePdf(data({ totals: invoiceLines(ORDER, 24, "et") }, "et"))).join("\n");
    expect(et).toContain("ARVE");
    expect(et).toContain("MÜÜJA / SELLER");
    // the product lines keep the catalogue's own wording («250 мл»); the headings carry no Russian
    expect(et).not.toMatch(/продавец|счёт|доставка|скидка|покупатель/i);

    const en = pdfText(await renderInvoicePdf(data({ totals: invoiceLines(ORDER, 24, "en") }, "en"))).join("\n");
    expect(en).toContain("OSTJA / BUYER");
    expect(en).not.toMatch(/покупатель|счёт/i);
  });

  it("says out loud when the bank details are not set instead of printing nothing", async () => {
    const text = pdfText(await renderInvoicePdf(data({ seller: { ...SELLER, iban: "", bankName: "" } }))).join("\n");
    expect(text).toContain("täitmata / not set / не указан");
  });

  it("keeps every baseline inside the printable inset, in all three languages", async () => {
    for (const lang of ["ru", "et", "en"] as const) {
      const spots = pdfBaselines(await renderInvoicePdf(data({ totals: invoiceLines(ORDER, 24, lang) }, lang)));
      expect(spots.length).toBeGreaterThan(30);
      for (const { x, y } of spots) {
        expect(y).toBeGreaterThanOrEqual(18);
        expect(y).toBeLessThanOrEqual(A4_HEIGHT - 18);
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(A4_WIDTH - 40);
      }
    }
  });

  it("runs a long order onto a second page and numbers the pages", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `p${i}`,
      kind: "product" as const,
      brand: "Davines",
      title: `Product number ${i + 1} with a fairly long name that wraps onto a second line`,
      variant: "250 мл",
      qty: 1,
      price: 10,
      sum: 10,
    }));
    const order = { ...ORDER, items, subtotal: 450, shippingPrice: 0, discount: 0, total: 450, discountCode: null };
    const bytes = await renderInvoicePdf(data({ totals: invoiceLines(order, 24, "et") }, "et"));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = pdfText(bytes).join("\n");
    expect(text).toContain(`lk / page 1 / ${doc.getPageCount()}`);
    expect(text).toContain("Product number 45");
    expect(text).toContain("450,00 €");
  });

  it("refuses an empty number rather than printing a blank invoice", async () => {
    await expect(renderInvoicePdf(data({ number: "" }))).rejects.toThrow(/bad_invoice_number/);
  });

  it("formats amounts with a comma and two decimals", () => {
    expect(amount(5)).toBe("5,00");
    expect(amount(71.474)).toBe("71,47");
    expect(amount(-5)).toBe("-5,00");
  });
});
