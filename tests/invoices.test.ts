/**
 * «По счёту — для компаний» — src/lib/invoices.ts.
 *
 * The numbering (sequential, unique under concurrency, per year), the company
 * block's door, the VAT arithmetic (24 % backed out of VAT-inclusive prices,
 * lines footing to the order's total), the settings clamp, and then the whole
 * flow on a real PGlite database: createOrder() with the invoice method
 * stores the company, numbers the order, records a pending «invoice» payment,
 * sends the letter with the PDF attached (the e2e sink sees it) and sends NO
 * pending-payment letter; «Отметить оплаченным» settles the order exactly
 * once, however many times it is pressed.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { renderInvoice } from "@/emails/invoice";
import { demoInvoice, demoOrder } from "@/emails/index";
import { query } from "@/lib/db";
import { issueGiftCards } from "@/lib/giftcards";
import {
  addDays,
  cleanCompany,
  cleanInvoiceSettings,
  companyOf,
  formatInvoiceNumber,
  INVOICE_DEFAULTS,
  invoiceLines,
  invoiceOf,
  invoiceOverdueDays,
  invoiceSendBlock,
  isInvoiceMethod,
  markInvoicePaid,
  nextInvoiceNumber,
  resendInvoice,
  sellerGaps,
  splitGross,
  tallinnDate,
} from "@/lib/invoices";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, OrderError, setOrderPayment, setOrderStatus, setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;
const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;

const COMPANY = {
  name: "Salong Näidis OÜ",
  regCode: "16123456",
  vatNumber: "EE101234567",
  address: "Pärnu mnt 10, 10148 Tallinn",
  email: "raamatupidaja@example.com",
};

/* ---------- pure -------------------------------------------------------- */

describe("the number", () => {
  it("is prefix + year + four digits", () => {
    expect(formatInvoiceNumber("A-", 2026, 1)).toBe("A-2026-0001");
    expect(formatInvoiceNumber("A-", 2026, 12345)).toBe("A-2026-12345");
    expect(formatInvoiceNumber("", 2026, 7)).toBe("2026-0007");
  });
});

/* The checkout's own half of the 0 € door, sliced out of the storefront by
   source text the way tests/checkout-parity.test.ts slices its arithmetic:
   retyping it here would test this file instead of the shop, and the slice
   fails loudly if app.js renames either function. */
const APP_JS = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function sliceFn(name: string): string {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP_JS.indexOf("{", start); i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}" && --depth === 0) return APP_JS.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** The storefront's own PAYS list, so the indexes below are the real ones. */
const PAYS = new Function(`${/var PAYS = \[[\s\S]*?\n {2}\];/.exec(APP_JS)?.[0] ?? "throw new Error('no PAYS in app.js')"}\nreturn PAYS;`)() as Array<{ k: string }>;

/** isInvoice() over a chosen radio, an order total and the shopper's country,
 *  with total() stubbed. orderCountry() is sliced in rather than stubbed: it
 *  is what turns «Другая страна Европы» into a real ISO code, and the rule
 *  under test is about the code it hands back. */
function checkoutPicksInvoice(pay: number, orderTotal: number, country = "EE", countryIso = ""): boolean {
  const body = `${sliceFn("invoiceOffered")}\n${sliceFn("isInvoice")}\n${sliceFn("orderCountry")}\nfunction total() { return TOTAL; }\nreturn isInvoice();`;
  return new Function("PAYS", "S", "TOTAL", body)(PAYS, { pay, country, countryIso }, orderTotal) as boolean;
}

describe("the 0 € door, in the checkout", () => {
  it("offers «По счёту» on a real total and drops it once a gift card covers everything", () => {
    expect(PAYS.map((p) => p.k)).toEqual(["bank", "card", "wallet", "invoice"]);
    expect(checkoutPicksInvoice(3, 61.47)).toBe(true);
    expect(checkoutPicksInvoice(3, 0)).toBe(false);
    expect(checkoutPicksInvoice(3, 0.003)).toBe(false); // rounding dust is not money to invoice
    expect(checkoutPicksInvoice(3, -2)).toBe(false); // a card bigger than the basket
    expect(checkoutPicksInvoice(1, 61.47)).toBe(false); // the card method is not an invoice
  });

  /* Estonia only (owner, 09.09.2026) — the invoice is issued at 24 % Estonian
     VAT, which is right in Estonia and wrong everywhere else. createOrder()
     refuses the rest («issues no invoice outside Estonia» below); this is the
     half a shopper meets, where the option is simply not on the list. */
  it("offers «По счёту» in Estonia and nowhere else", () => {
    expect(checkoutPicksInvoice(3, 61.47, "EE")).toBe(true);
    expect(checkoutPicksInvoice(3, 61.47, "LV")).toBe(false);
    expect(checkoutPicksInvoice(3, 61.47, "FI")).toBe(false);
    // «Другая страна Европы» keeps the real code in S.countryIso — «EU» is not one
    expect(checkoutPicksInvoice(3, 61.47, "EU", "DE")).toBe(false);
    expect(checkoutPicksInvoice(3, 61.47, "EU", "EE")).toBe(true);
  });
});

describe("the settings clamp", () => {
  /* Dim's confirmed defaults, in one place: «A-», a seven-day term, one
     reminder two days before it runs out, cancellation a week after it has.
     A change to any of these four is a change to what a company is promised
     in the checkout and in the letters, so it fails here first. */
  it("defaults to «A-», 7 days, a reminder on day −2 and auto-cancel on day +7", () => {
    expect(INVOICE_DEFAULTS).toEqual({ prefix: "A-", dueDays: 7, remindBeforeDays: 2, cancelAfterDays: 7 });
    expect(cleanInvoiceSettings(null)).toEqual(INVOICE_DEFAULTS);
  });

  it("refuses nonsense in every field", () => {
    expect(cleanInvoiceSettings({ prefix: "arve/", dueDays: 14 })).toEqual({ ...INVOICE_DEFAULTS, prefix: "ARVE", dueDays: 14 });
    expect(cleanInvoiceSettings({ prefix: "", dueDays: 0 })).toEqual({ ...INVOICE_DEFAULTS, prefix: "" });
    expect(cleanInvoiceSettings({ prefix: "ABCDEFGHIJK", dueDays: "30" })).toEqual({ ...INVOICE_DEFAULTS, prefix: "ABCDEFGH", dueDays: 30 });
    expect(cleanInvoiceSettings({ dueDays: 400 }).dueDays).toBe(7);
    // the two dunning intervals: 0 is «off» and stands, anything past the cap falls back
    expect(cleanInvoiceSettings({ remindBeforeDays: 0, cancelAfterDays: 0 })).toMatchObject({ remindBeforeDays: 0, cancelAfterDays: 0 });
    expect(cleanInvoiceSettings({ remindBeforeDays: 5, cancelAfterDays: 30 })).toMatchObject({ remindBeforeDays: 5, cancelAfterDays: 30 });
    expect(cleanInvoiceSettings({ remindBeforeDays: 90 }).remindBeforeDays).toBe(2);
    expect(cleanInvoiceSettings({ cancelAfterDays: -3 }).cancelAfterDays).toBe(7);
    expect(cleanInvoiceSettings({ cancelAfterDays: "ждать" }).cancelAfterDays).toBe(7);
  });
});

describe("the company block", () => {
  it("accepts a company with a registry code and an address", () => {
    expect(cleanCompany({ ...COMPANY, regCode: "16 123 456" })).toEqual(COMPANY);
    // the VAT number is optional and upper-cased; the e-mail falls back to the order's
    expect(cleanCompany({ ...COMPANY, vatNumber: "", email: "" }, "buyer@example.com")).toMatchObject({ vatNumber: "", email: "buyer@example.com" });
    expect(cleanCompany({ ...COMPANY, vatNumber: "ee 101234567" }).vatNumber).toBe("EE101234567");
  });

  it("refuses what an invoice cannot be made out to, by field", () => {
    const code = (raw: unknown) => {
      try {
        cleanCompany(raw, "buyer@example.com");
        return "ok";
      } catch (err) {
        return err instanceof OrderError ? err.code : "other";
      }
    };
    expect(code({ ...COMPANY, name: "X" })).toBe("bad_company");
    expect(code({ ...COMPANY, regCode: "123" })).toBe("bad_reg_code");
    expect(code({ ...COMPANY, regCode: "12A45678" })).toBe("bad_reg_code");
    expect(code({ ...COMPANY, vatNumber: "12345" })).toBe("bad_vat_number");
    expect(code({ ...COMPANY, address: "Tln" })).toBe("bad_company_address");
    expect(code({ ...COMPANY, email: "not-an-email" })).toBe("bad_invoice_email");
    expect(code(null)).toBe("bad_company");
    // control characters never survive
    expect(cleanCompany({ ...COMPANY, name: "Salong\u0000 Näidis\n OÜ" }).name).toBe("Salong Näidis OÜ");
  });

  it("reads a stored block back without throwing, and knows the checkout's method flag", () => {
    expect(companyOf(COMPANY)).toEqual(COMPANY);
    expect(companyOf(JSON.stringify(COMPANY))).toEqual(COMPANY);
    expect(companyOf(null)).toBeNull();
    expect(companyOf({ regCode: "1" })).toBeNull();
    expect(isInvoiceMethod({ method: "invoice" })).toBe(true);
    expect(isInvoiceMethod({ method: "card" })).toBe(false);
    expect(isInvoiceMethod("invoice")).toBe(false);
  });
});

describe("the VAT arithmetic — 24 % out of VAT-inclusive prices", () => {
  it("backs the net out of the gross and the two foot to the gross", () => {
    expect(splitGross(124, 24)).toEqual({ net: 100, vat: 24 });
    expect(splitGross(54, 24)).toEqual({ net: 43.55, vat: 10.45 });
    expect(splitGross(0.01, 24)).toEqual({ net: 0.01, vat: 0 });
    expect(splitGross(-5, 24)).toEqual({ net: -4.03, vat: -0.97 });
  });

  it("turns an order into lines whose sums equal the order's own total", () => {
    const order = {
      items: [
        { id: "a", kind: "product" as const, brand: "Kevin.Murphy", title: "Fresh.Hair", variant: "250 мл", qty: 3, price: 9.99, sum: 29.97 },
        { id: "b", kind: "product" as const, brand: "Proraso", title: "Wood & Spice", variant: null, qty: 1, price: 17, sum: 17 },
        { id: "gift:50", kind: "gift" as const, title: "Подарочная карта 50 €", variant: null, qty: 1, price: 50, sum: 50 },
      ],
      subtotal: 96.97,
      shippingPrice: 5.47,
      discount: 10,
      loyaltyDiscount: 3,
      total: 89.44,
      discountCode: "SUVI10",
    };
    const t = invoiceLines(order, 24, "ru");
    expect(t.lines.map((l) => l.kind)).toEqual(["item", "item", "item", "shipping", "discount", "discount"]);
    expect(t.lines[0]).toMatchObject({ title: "Kevin.Murphy Fresh.Hair · 250 мл", qty: 3, unitGross: 9.99, gross: 29.97, net: 24.17, vat: 5.8 });
    expect(t.lines[3]).toMatchObject({ title: "Tarne / Delivery / Доставка", gross: 5.47 });
    expect(t.lines[4]).toMatchObject({ title: "Allahindlus / Discount / Скидка (SUVI10)", gross: -10 });
    expect(t.lines[5]).toMatchObject({ title: "Boonuspunktid / Loyalty points / Баллы", gross: -3 });
    for (const l of t.lines) expect(Math.round((l.net + l.vat) * 100)).toBe(Math.round(l.gross * 100));
    expect(t.total).toBe(order.total);
    expect(Math.round((t.net + t.vat) * 100)).toBe(Math.round(t.total * 100));
    expect(t.net).toBe(Math.round(t.lines.reduce((s, l) => s + l.net, 0) * 100) / 100);
    expect(t.vatRate).toBe(24);
    // an Estonian order gets the two-language line words only
    expect(invoiceLines(order, 24, "et").lines[3].title).toBe("Tarne / Delivery");
  });

  it("caps a discount at the goods plus delivery, as createOrder() does", () => {
    const t = invoiceLines(
      { items: [{ id: "a", kind: "product" as const, title: "X", qty: 1, price: 10, sum: 10 }], subtotal: 10, shippingPrice: 0, discount: 50, loyaltyDiscount: 0, total: 0 },
      24,
      "en",
    );
    expect(t.total).toBe(0);
    expect(t.lines[1].gross).toBe(-10);
  });

  it("falls back to the default rate on nonsense and prices a line without a stored sum", () => {
    const t = invoiceLines({ items: [{ id: "a", kind: "product" as const, title: "X", qty: 2, price: 5 } as never], subtotal: 10, shippingPrice: 0, discount: 0, loyaltyDiscount: 0, total: 10 }, NaN);
    expect(t.vatRate).toBe(24);
    expect(t.lines[0].gross).toBe(10);
  });
});

describe("dates", () => {
  it("counts the due date on the calendar and the overdue days after it", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(tallinnDate(new Date("2026-09-06T21:30:00.000Z"))).toBe("2026-09-07"); // UTC+3 in September
    const inv = invoiceOf({ invoice: { number: "A-2026-0001", issuedAt: "2026-09-01T10:00:00.000Z", dueAt: "2026-09-08", dueDays: 7, email: "x@example.com" } })!;
    expect(invoiceOverdueDays(inv, new Date("2026-09-08T12:00:00.000Z"))).toBe(0);
    expect(invoiceOverdueDays(inv, new Date("2026-09-11T12:00:00.000Z"))).toBe(3);
    expect(invoiceOverdueDays({ ...inv, paidAt: "2026-09-09T00:00:00.000Z" }, new Date("2026-09-30T12:00:00.000Z"))).toBe(0);
    expect(invoiceOverdueDays(null)).toBe(0);
  });
});

describe("the seller's gaps", () => {
  it("names the blank fields the admin has to fill in", () => {
    expect(
      sellerGaps({ name: "Rempire Store OÜ", regCode: "12216136", vatNumber: "EE102723858", address: "Mardi 1", email: "", phone: "", iban: "", bankName: "" }),
    ).toEqual(["iban", "bankName"]);
  });
});

describe("the letter", () => {
  it("carries the number, the due date, the bank details and the amount, in the order's language", () => {
    for (const [lang, word] of [
      ["ru", "Счёт A-2026-0042 на заказ R-100042 — Rempire"],
      ["et", "Arve A-2026-0042 tellimusele R-100042 — Rempire"],
      ["en", "Invoice A-2026-0042 for order R-100042 — Rempire"],
    ] as const) {
      const mail = renderInvoice(demoOrder(lang), demoInvoice(95), lang);
      expect(mail.subject).toBe(word);
      expect(mail.text).toContain("A-2026-0042");
      expect(mail.text).toContain("13.09.2026");
      expect(mail.text).toContain("EE00 0000 0000 0000 0000");
      expect(mail.text).toContain("Swedbank");
      expect(mail.text).toContain("R-100042, A-2026-0042");
      expect(mail.text).toContain("95 €");
      // the IBAN's groups are joined with &nbsp; in the HTML part so the number never wraps
      expect(mail.html).toContain("EE00&nbsp;0000&nbsp;0000&nbsp;0000&nbsp;0000");
      expect(mail.html).not.toContain("undefined");
      if (lang !== "ru") expect(mail.text).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});

/* ---------- on the database --------------------------------------------- */

const ENV_KEYS = ["RESEND_API_KEY", "E2E_BOOTSTRAP", "SESSION_SECRET", "MAIL_PENDING_PAYMENT"] as const;
const saved: Record<string, string | undefined> = {};

function invoiceOrderInput(over: Record<string, unknown> = {}) {
  return {
    lang: "ru",
    items: [{ id: plain.id, qty: 2 }],
    customer: { name: "Mari Tamm", email: "mari@example.com", phone: "+372 5555 5555" },
    shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
    payment: { method: "invoice" },
    company: COMPANY,
    ...over,
  } as Parameters<typeof createOrder>[0];
}

describe("on the database", () => {
  beforeAll(async () => {
    await setupDb();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.RESEND_API_KEY; // every send is skipped and recorded by the sink
    process.env.E2E_BOOTSTRAP = "1";
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.MAIL_PENDING_PAYMENT = "1"; // the pending letter is ON — and must still not go to an invoice order
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    await query("truncate invoice_counters");
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
  });

  it("hands out sequential numbers, unique under concurrency, restarting each year", async () => {
    const first = await nextInvoiceNumber("A-", new Date("2026-03-01T10:00:00.000Z"));
    expect(first).toBe("A-2026-0001");
    const batch = await Promise.all(Array.from({ length: 25 }, () => nextInvoiceNumber("A-", new Date("2026-03-01T10:00:00.000Z"))));
    const seqs = batch.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b);
    expect(new Set(batch).size).toBe(25);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
    // a new year starts a new run; the old year's counter is untouched
    expect(await nextInvoiceNumber("A-", new Date("2027-01-01T05:00:00.000Z"))).toBe("A-2027-0001");
    expect(await nextInvoiceNumber("A-", new Date("2026-12-31T22:30:00.000Z"))).toBe("A-2027-0002"); // 00:30 in Tallinn already
  });

  it("createOrder with the invoice method: company stored, numbered, letter with the PDF, no pending letter", async () => {
    await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
    const order = await createOrder(invoiceOrderInput());
    expect(order.status).toBe("new");
    expect(order.company).toEqual(COMPANY);
    const inv = invoiceOf(order)!;
    expect(inv.number).toMatch(/^A-\d{4}-0001$/);
    expect(inv.dueAt).toBe(addDays(inv.issueDate, 7));
    expect(inv.email).toBe(COMPANY.email);
    expect(inv.vatRate).toBe(24);
    expect(order.payment).toMatchObject({ provider: "invoice", method: "invoice", ref: inv.number, status: "pending", amount: order.total });
    // the row says the same
    const stored = (await getOrder(order.id))!;
    expect(invoiceOf(stored)?.number).toBe(inv.number);
    expect(stored.company).toEqual(COMPANY);
    // the sink: one «Счёт на оплату» to the company's address, the PDF named after the number — and NO pending letter
    const mails = capturedMail();
    const invoiceMails = mails.filter((m) => m.template === "invoice");
    expect(invoiceMails).toHaveLength(1);
    expect(invoiceMails[0].to).toEqual([COMPANY.email]);
    expect(invoiceMails[0].subject).toContain(inv.number);
    expect(invoiceMails[0].attachments).toEqual([`rempire-invoice-${inv.number}.pdf`]);
    expect(mails.filter((m) => m.template === "order-confirmed")).toHaveLength(0);
    // no key ⇒ nothing really went out, and the record says so rather than pretending
    expect(inv.sentAt).toBeNull();
    expect(inv.sendError).toBe("no_api_key");
    // the audit trail has the issue
    const audit = await query<{ action: string; payload: unknown }>("select action, payload from admin_audit order by id");
    expect(audit.map((a) => a.action)).toContain("invoice.issued");
  });

  it("refuses a company the invoice cannot be made out to, and a zero-total order", async () => {
    await expect(createOrder(invoiceOrderInput({ company: { ...COMPANY, regCode: "1" } }))).rejects.toMatchObject({ code: "bad_reg_code" });
    await expect(createOrder(invoiceOrderInput({ company: null }))).rejects.toMatchObject({ code: "bad_company" });
    // no row was written for either
    expect(await query("select id from orders")).toHaveLength(0);
  });

  /* «По счёту» is for Estonian companies (owner, 09.09.2026). The invoice is
     issued at 24 % Estonian VAT, which is right for a buyer in Estonia and
     wrong for anyone else: a VAT-registered company elsewhere in the EU is a
     reverse charge at 0 % with its own note on the document, and outside the
     EU it is an export. Neither is implemented, so an invoice issued there
     would be a wrong invoice rather than a missing feature. The checkout hides
     the method (invoiceOffered() in public/shop2/app.js); this is the door
     behind it, because a body is not the browser that sent it. */
  it("issues no invoice outside Estonia, whatever the body asks for", async () => {
    for (const country of ["LV", "FI", "DE", "GB"]) {
      await expect(
        createOrder(invoiceOrderInput({
          shipping: { method: "courier", country, address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
        })),
        `an invoice was issued to ${country}`,
      ).rejects.toMatchObject({ code: "invoice_country" });
    }
    // nothing was written and no invoice number was burnt on any of them
    expect(await query("select id from orders")).toHaveLength(0);
    expect(await query("select year from invoice_counters")).toHaveLength(0);
    expect(capturedMail()).toHaveLength(0);

    // …and the same basket goes through to Latvia on a payment method that works there
    const ok = await createOrder(invoiceOrderInput({
      payment: { method: "card" },
      company: undefined,
      shipping: { method: "courier", country: "LV", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
    }));
    expect(ok.number).toMatch(/^R-\d+$/);
  });

  /* The payments agent's boundary note: a basket a gift card already covers
     is settled without a payment page at all, and «По счёту» has nothing left
     to invoice — a счёт for 0 € is not a document anybody can pay or book.
     The checkout drops the method from the list once the total reaches zero
     (invoiceOffered() in public/shop2/app.js); this is the door behind it. */
  it("issues no invoice for a 0 € order — the gift card covers everything", async () => {
    const [card] = await issueGiftCards({ id: randomUUID(), items: [{ id: "gift:100", qty: 1 }] });
    await expect(createOrder(invoiceOrderInput({ discountCode: card.code }))).rejects.toMatchObject({ code: "invoice_zero_total" });
    // nothing was written, no number was burnt on it, no letter went out
    expect(await query("select id from orders")).toHaveLength(0);
    expect(await query("select year from invoice_counters")).toHaveLength(0);
    expect(capturedMail()).toHaveLength(0);
    // …and the very same basket goes through on another method, at 0 €
    const ok = await createOrder(invoiceOrderInput({ payment: { method: "card" }, company: undefined, discountCode: card.code }));
    expect(ok.total).toBe(0);
    expect(ok.invoice).toBeNull();
    expect(ok.company).toBeNull();
  });

  /* The IBAN is «later» in Dim's own list, so this is the door that makes
     «later» safe: an invoice with nowhere to pay it is not sent at all. The
     number is still allocated and the PDF still renders — the owner fills the
     field in and presses «Отправить счёт ещё раз», and the same invoice goes.
     What must never happen is a company receiving a numbered demand for money
     with a blank line where the account number belongs. */
  it("никогда не отправляет счёт без IBAN — the letter is blocked, not silently unpayable", async () => {
    await setSetting("content", { company: { iban: "", bankName: "" } });
    const order = await createOrder(invoiceOrderInput());

    // the order and its number exist; the letter does not
    const inv = invoiceOf(order)!;
    expect(inv.number).toMatch(/^A-\d{4}-\d{4}$/);
    expect(inv.sentAt).toBeNull();
    expect(inv.sendError).toBe("no_iban");
    expect(capturedMail().filter((m) => m.template === "invoice")).toHaveLength(0);

    // «Отправить счёт ещё раз» refuses for the same reason, and says which
    const again = await resendInvoice((await getOrder(order.id))!, "admin");
    expect(again.sent).toMatchObject({ ok: false, error: "no_iban", blocked: true });
    expect(capturedMail().filter((m) => m.template === "invoice")).toHaveLength(0);

    // fill the IBAN in and the very same invoice goes out
    await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
    const sent = await resendInvoice((await getOrder(order.id))!, "admin");
    expect(sent.sent.error).toBe("no_api_key"); // no key in the suite — attempted, and the sink saw it
    const mails = capturedMail().filter((m) => m.template === "invoice");
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([COMPANY.email]);
  });

  it("invoiceSendBlock names the one gap that stops a letter", () => {
    const seller = { name: "Rempire Store OÜ", regCode: "1", vatNumber: "EE1", address: "Mardi 1", email: "", phone: "", iban: "", bankName: "" };
    expect(invoiceSendBlock(seller)).toBe("no_iban");
    expect(invoiceSendBlock({ ...seller, iban: "   " })).toBe("no_iban");
    // a missing bank NAME is a gap the card warns about, never a reason to withhold the invoice
    expect(invoiceSendBlock({ ...seller, iban: "EE382200221020145685" })).toBe("");
  });

  it("a card order is untouched: no company, no invoice, the pending letter as before", async () => {
    const order = await createOrder(invoiceOrderInput({ payment: { method: "card" }, company: undefined }));
    expect(order.company).toBeNull();
    expect(order.invoice).toBeNull();
    expect(capturedMail().filter((m) => m.template === "invoice")).toHaveLength(0);
    expect(capturedMail().filter((m) => m.template === "order-confirmed")).toHaveLength(1);
  });

  it("«Отметить оплаченным» settles the order once, and a second press changes nothing", async () => {
    const order = await createOrder(invoiceOrderInput());
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
    // typed argument, so `notify.mock.calls[0][0]` below is the order and not an empty tuple
    const notify = vi.fn(async (_order: unknown) => undefined);
    const statusSpy = vi.fn(setOrderStatus);

    const first = await markInvoicePaid(order, { setOrderPayment, setOrderStatus: statusSpy, notify }, "admin");
    expect(first.status).toBe("paid");
    expect(first.alreadyPaid).toBe(false);
    expect(first.invoice?.paidAt).toBeTruthy();
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith(order.id, "paid", "payment:invoice");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ status: "paid", number: order.number });

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("paid");
    expect(after.payment).toMatchObject({ provider: "invoice", status: "paid", ref: invoiceOf(order)!.number, method: "invoice" });
    expect(invoiceOf(after)?.paidAt).toBeTruthy();

    // the second press: paid is a floor — no status write, no letter, no ping
    const second = await markInvoicePaid(after, { setOrderPayment, setOrderStatus: statusSpy, notify }, "admin");
    expect(second.alreadyPaid).toBe(true);
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await getOrder(order.id))!.status).toBe("paid");

    const audit = await query<{ action: string }>("select action from admin_audit where action = 'invoice.paid'");
    expect(audit).toHaveLength(1);
  });

  it("the real notify sends «Заказ принят» on the paid transition", async () => {
    const order = await createOrder(invoiceOrderInput());
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
    await markInvoicePaid(order, { setOrderPayment, setOrderStatus }, "admin");
    const confirmed = capturedMail().filter((m) => m.template === "order-confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].to).toEqual(["mari@example.com"]);
  });
});
