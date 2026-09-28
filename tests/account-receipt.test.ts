/**
 * «Скачать чек (PDF)» in «Кабинет → Мои заказы» — GET
 * /api/account/orders/<id>/receipt/. The same door as the invoice's
 * (tests/account-invoice.test.ts) and the same rules at it:
 *
 *   · the signed `rmp_cust` cookie is the credential — no cookie, or a forged
 *     one, is 401 and nothing is rendered;
 *   · somebody else's order answers `not_found`, exactly like a number that
 *     does not exist, so the route confirms nothing to a guesser;
 *   · only the customer's OWN order may say `no_receipt` — one that was never
 *     paid, and one paid «По счёту», whose document is the invoice;
 *   · a 200 is the receipt of THAT order, read back off the page: its number,
 *     its total and the VAT at the rate the order was sold under.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { CUSTOMER_COOKIE, makeCustomerToken } from "@/lib/customers";
import { query } from "@/lib/db";
import { setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";
import { pdfText } from "./pdf-text";

const BUYER = "mari@example.com";
const OTHER = "somebody-else@example.com";

const ITEM = { id: "kevin-murphy-fresh-hair", kind: "product", brand: "Kevin.Murphy", title: "Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 };
const LOCKER = { method: "parcel", country: "EE", carrier: "omniva", pointId: "PT-1", pointName: "Kristiine keskus", pointType: "parcel_machine", price: 3.19 };
const CARD = { provider: "montonio", method: "card", status: "paid", ref: "REF-1" };

async function put(email: string, over: { status?: string; payment?: unknown; invoice?: unknown; vatRate?: number | null; lang?: string } = {}) {
  const rows = await query<{ id: string; number: string }>(
    `insert into orders (lang, email, name, status, items, subtotal, shipping_price, discount, loyalty_discount, total, shipping, payment, invoice, vat_rate)
     values ($1, $2, 'Mari Tamm', $3, $4::jsonb, 54, 3.19, 0, 0, 57.19, $5::jsonb, $6::jsonb, $7::jsonb, $8)
     returning id, number`,
    [
      over.lang ?? "RU",
      email,
      over.status ?? "paid",
      JSON.stringify([ITEM]),
      JSON.stringify(LOCKER),
      JSON.stringify(over.payment ?? CARD),
      over.invoice ? JSON.stringify(over.invoice) : null,
      over.vatRate === undefined ? 24 : over.vatRate,
    ],
  );
  return rows[0];
}

function get(id: string, cookieEmail: string | null = BUYER, qs = "") {
  const headers: Record<string, string> = {};
  if (cookieEmail) headers.cookie = `${CUSTOMER_COOKIE}=${makeCustomerToken(cookieEmail)}`;
  return new Request(`https://rempireshop.com/api/account/orders/${encodeURIComponent(id)}/receipt/${qs}`, { headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const route = () => import("@/app/api/account/orders/[id]/receipt/route");

let savedSecret: string | undefined;
beforeAll(async () => {
  savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(async () => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  await teardownDb();
});
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
  await setSetting("content", { company: { legalName: "Rempire Store OÜ", regCode: "12216136", vatNumber: "EE102723858", address: "Mardi 1, 10145 Tallinn" } });
});

describe("GET /api/account/orders/<id>/receipt/", () => {
  it("hands the signed-in customer the receipt of their own paid order — by number, by uuid, as typed", async () => {
    const { GET } = await route();
    const order = await put(BUYER);

    const res = await GET(get(order.number), ctx(order.number));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="rempire-receipt-${order.number}.pdf"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(res.headers.get("content-length")).toBe(String(bytes.length));

    // the receipt of THIS order: its number, its lines, its total, its VAT, the seller from the settings
    const text = pdfText(bytes).join("\n");
    expect(text).toContain("ЧЕК");
    expect(text).toContain(order.number);
    expect(text).toContain("Kevin.Murphy Fresh.Hair · 250 мл");
    expect(text).toContain("57,19 €");
    expect(text).toContain("НДС 24 %");
    expect(text).toContain("11,07 €"); // 54 → 10,45 and 3,19 → 0,62
    expect(text).toContain("Rempire Store OÜ");
    expect(text).toContain("EE102723858");
    expect(text).toContain("Оплата: Банковская карта");

    expect((await GET(get(order.id), ctx(order.id))).status).toBe(200);
    const typed = order.number.toLowerCase().replace(/^r-/, "");
    expect((await GET(get(typed), ctx(typed))).status).toBe(200);
  });

  it("prints in the page's language when asked, else in the order's", async () => {
    const { GET } = await route();
    const order = await put(BUYER, { lang: "EN" });
    const text = async (qs: string) => pdfText(new Uint8Array(await (await GET(get(order.number, BUYER, qs), ctx(order.number))).arrayBuffer())).join("\n");
    expect(await text("")).toContain("RECEIPT");
    expect(await text("?lang=et")).toContain("KVIITUNG");
    expect(await text("?lang=ru")).toContain("ЧЕК");
    expect(await text("?lang=zz")).toContain("ЧЕК"); // an unknown word is the shop's own fallback, not an error
  });

  it("backs the VAT out at the rate the order was sold under, not today's setting", async () => {
    const { GET } = await route();
    await setSetting("vat_rate", 24);
    const old = await put(BUYER, { vatRate: 22 });
    const text = pdfText(new Uint8Array(await (await GET(get(old.number), ctx(old.number))).arrayBuffer())).join("\n");
    expect(text).toContain("НДС 22 %");
    expect(text).not.toContain("НДС 24 %");
    // an order from before the rate was stamped: the accountant export's fallback, 24 %
    const unstamped = await put(BUYER, { vatRate: null });
    const t2 = pdfText(new Uint8Array(await (await GET(get(unstamped.number), ctx(unstamped.number))).arrayBuffer())).join("\n");
    expect(t2).toContain("НДС 24 %");
  });

  it("lists a refunded order's refunds under the sale", async () => {
    const { GET } = await route();
    const order = await put(BUYER, {
      status: "refunded",
      payment: { ...CARD, refunds: [{ ref: "rf-1", amount: 57.19, status: "done", at: "2026-09-20T10:00:00.000Z" }] },
    });
    const res = await GET(get(order.number), ctx(order.number));
    expect(res.status).toBe(200);
    const text = pdfText(new Uint8Array(await res.arrayBuffer())).join("\n");
    expect(text).toContain("ВОЗВРАТЫ");
    expect(text).toContain("20.09.2026");
    expect(text).toContain("-57,19 €");
  });

  it("answers «not_found» for another customer's order — the same as for a number that does not exist", async () => {
    const { GET } = await route();
    const theirs = await put(OTHER);
    for (const id of [theirs.number, theirs.id, "R-999999", "not-an-order", "00000000-0000-0000-0000-000000000000"]) {
      const res = await GET(get(id, BUYER), ctx(id));
      expect(res.status, id).toBe(404);
      expect(await res.json(), id).toEqual({ ok: false, error: "not_found" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect((await GET(get(theirs.number, OTHER), ctx(theirs.number))).status).toBe(200);
  });

  it("says «no_receipt» on the customer's own order that was never paid, or was paid «По счёту»", async () => {
    const { GET } = await route();
    for (const status of ["new", "failed", "cancelled"]) {
      const order = await put(BUYER, { status, payment: { ...CARD, status: "pending" } });
      const res = await GET(get(order.number), ctx(order.number));
      expect(res.status, status).toBe(404);
      expect(await res.json(), status).toEqual({ ok: false, error: "no_receipt" });
    }
    const invoiced = await put(BUYER, {
      status: "paid",
      payment: { provider: "invoice", method: "invoice", status: "paid", ref: "A-2026-0001" },
      invoice: { number: "A-2026-0001", issueDate: "2026-09-01", dueAt: "2026-09-08", vatRate: 24 },
    });
    const res = await GET(get(invoiced.number), ctx(invoiced.number));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "no_receipt" });
  });

  it("turns away a guest and a forged cookie", async () => {
    const { GET } = await route();
    const order = await put(BUYER);
    const anon = await GET(get(order.number, null), ctx(order.number));
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ ok: false, error: "unauthorized" });
    const forged = new Request(`https://rempireshop.com/api/account/orders/${order.number}/receipt/`, {
      headers: { cookie: `${CUSTOMER_COOKIE}=v1.${Date.now() + 60_000}.${BUYER}.notasignature` },
    });
    expect((await GET(forged, ctx(order.number))).status).toBe(401);
  });

  it("429s a caller that hammers it, after 30 in a minute", async () => {
    const { GET } = await route();
    // an unpaid order: the limiter answers before the lookup, so nothing is rendered 35 times over
    const order = await put(BUYER, { status: "new", payment: { ...CARD, status: "pending" } });
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await GET(get(order.number), ctx(order.number))).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
  });
});
