/**
 * «Скачать счёт (PDF)» in «Кабинет → Мои заказы» — GET
 * /api/account/orders/<id>/invoice/, and the `invoice` field
 * listCustomerOrders() draws the link from.
 *
 * The bugs this file exists to catch are the ones that would make the link
 * either a leak or a lie: a stranger downloading somebody else's invoice (a
 * company's name, address and registry code), a guessed order number that
 * confirms the order exists, a link on an order that never had an invoice,
 * and a 200 that is not the invoice — the page is read back
 * (tests/pdf-text.ts), so a route that answered with the wrong document
 * fails here too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { resetRateLimits } from "@/lib/auth";
import { accountInvoicePath, CUSTOMER_COOKIE, listCustomerOrders, makeCustomerToken } from "@/lib/customers";
import { query } from "@/lib/db";
import { invoiceOf } from "@/lib/invoices";
import { createOrder, setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";
import { pdfText } from "./pdf-text";

type Min = { id: string; s: string };
const VARIANTS = variants as Record<string, unknown>;
/* A single-size product in stock: the order is not what is under test. */
const PRODUCT = (catalogueMin as Min[]).find((p) => p.s === "in" && !VARIANTS[p.id])!.id;

const BUYER = "mari@example.com";
const OTHER = "somebody-else@example.com";
const COMPANY = {
  name: "Salong Näidis OÜ",
  regCode: "16123456",
  vatNumber: "EE101234567",
  address: "Pärnu mnt 10, 10148 Tallinn",
  email: "raamatupidaja@example.com",
};

function orderInput(email: string, over: Record<string, unknown> = {}) {
  return {
    lang: "ru",
    items: [{ id: PRODUCT, qty: 1 }],
    customer: { name: "Mari Tamm", email, phone: "+372 5555 5555" },
    shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
    ...over,
  } as Parameters<typeof createOrder>[0];
}
/** An order paid «По счёту» — createOrder() issues the invoice on the spot. */
const byInvoice = (email: string) => createOrder(orderInput(email, { payment: { method: "invoice" }, company: COMPANY }));
/** The same order paid by card — no invoice on it, ever. */
const byCard = (email: string) => createOrder(orderInput(email));

function get(id: string, cookieEmail: string | null = BUYER) {
  const headers: Record<string, string> = {};
  if (cookieEmail) headers.cookie = `${CUSTOMER_COOKIE}=${makeCustomerToken(cookieEmail)}`;
  return new Request(`https://rempireshop.com/api/account/orders/${encodeURIComponent(id)}/invoice/`, { headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const ENV_KEYS = ["RESEND_API_KEY", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.RESEND_API_KEY; // the invoice letter is skipped, not sent — the file is what is under test
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await teardownDb();
});
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
  await query("truncate invoice_counters");
  await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
});

describe("listCustomerOrders — the link the account draws", () => {
  it("names the invoice and its link on an order paid «По счёту», and nothing on a card order", async () => {
    const inv = await byInvoice(BUYER);
    const card = await byCard(BUYER);
    const list = await listCustomerOrders(BUYER);
    expect(list.map((o) => o.number).sort()).toEqual([card.number, inv.number].sort());

    const invoiced = list.find((o) => o.number === inv.number)!;
    expect(invoiced.invoice).toEqual({
      number: invoiceOf(inv)!.number,
      pdfUrl: `/api/account/orders/${encodeURIComponent(inv.number)}/invoice/`,
    });
    expect(invoiced.invoice!.pdfUrl).toBe(accountInvoicePath(inv.number));
    // no token in the link, unlike the gift card's: the cookie is the credential, so there is nothing to forward
    expect(invoiced.invoice!.pdfUrl).not.toContain("?");

    expect(list.find((o) => o.number === card.number)!.invoice).toBeNull();
  });
});

describe("GET /api/account/orders/<id>/invoice/", () => {
  it("hands the signed-in customer their own invoice as a PDF — by number, by uuid, in either case", async () => {
    const { GET } = await import("@/app/api/account/orders/[id]/invoice/route");
    const order = await byInvoice(BUYER);
    const number = invoiceOf(order)!.number;

    const res = await GET(get(order.number), ctx(order.number));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="rempire-invoice-${number}.pdf"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(res.headers.get("content-length")).toBe(String(bytes.length));

    // the file is the invoice, not merely a PDF: its number, the order's number and the company are on the page
    const text = pdfText(bytes).join("\n");
    expect(text).toContain(number);
    expect(text).toContain(order.number);
    expect(text).toContain(COMPANY.name);
    expect(text).toContain(COMPANY.regCode);

    // the uuid works too, like the admin route — and so does the number as a phone would type it
    expect((await GET(get(order.id), ctx(order.id))).status).toBe(200);
    const typed = order.number.toLowerCase().replace(/^r-/, "");
    expect((await GET(get(typed), ctx(typed))).status).toBe(200);
  });

  it("answers «not_found» for another customer's order — the same as for a number that does not exist", async () => {
    const { GET } = await import("@/app/api/account/orders/[id]/invoice/route");
    const theirs = await byInvoice(OTHER);
    for (const id of [theirs.number, theirs.id, "R-999999", "not-an-order"]) {
      const res = await GET(get(id, BUYER), ctx(id));
      expect(res.status, id).toBe(404);
      expect(await res.json(), id).toEqual({ ok: false, error: "not_found" });
    }
    // …and the owner of that order still gets it: the refusal is about the address, not the order
    expect((await GET(get(theirs.number, OTHER), ctx(theirs.number))).status).toBe(200);
  });

  it("says «no_invoice» on the customer's own order that was paid another way", async () => {
    const { GET } = await import("@/app/api/account/orders/[id]/invoice/route");
    const order = await byCard(BUYER);
    const res = await GET(get(order.number), ctx(order.number));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "no_invoice" });
  });

  it("turns away a guest and a forged cookie, and stores nothing about the attempt", async () => {
    const { GET } = await import("@/app/api/account/orders/[id]/invoice/route");
    const order = await byInvoice(BUYER);

    const anon = await GET(get(order.number, null), ctx(order.number));
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ ok: false, error: "unauthorized" });

    const forged = new Request(`https://rempireshop.com/api/account/orders/${order.number}/invoice/`, {
      headers: { cookie: `${CUSTOMER_COOKIE}=v1.${Date.now() + 60_000}.${BUYER}.notasignature` },
    });
    expect((await GET(forged, ctx(order.number))).status).toBe(401);

    // no journal line for a download, refused or not — the customer's audit rows are the return tick only
    expect(await query("select 1 from admin_audit where action like 'order.%invoice%'")).toHaveLength(0);
  });

  it("429s a caller that hammers it, after the 30 a bookkeeper could plausibly need", async () => {
    const { GET } = await import("@/app/api/account/orders/[id]/invoice/route");
    // a card order: the limiter answers before the lookup, so nothing is rendered 35 times over
    const order = await byCard(BUYER);
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await GET(get(order.number), ctx(order.number))).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
  });
});
