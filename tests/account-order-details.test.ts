/**
 * «Мой кабинет → Мои заказы» — what one order row carries since Dim's
 * decision of 28.09.2026: the parcel in words, the order's own details
 * behind a tap, and the receipt link on every paid order.
 *
 * All three come from listCustomerOrders() (src/lib/customers.ts), which
 * reads the order row as it was stored at purchase — the prices, the
 * delivery, the codes — and hands the browser a small, whitelisted shape.
 * The bugs this file exists to catch:
 *
 *   · a price read off today's catalogue instead of the order (the customer
 *     paid 27 €, the row must say 27 € a year later);
 *   · a parcel state invented for a word Montonio never promised, or a
 *     parcel shown for a label still on the shelf;
 *   · an internal field reaching the browser — the pickup point's id, the
 *     shipment id, the drop-off PIN, the label link, the payment reference,
 *     the full gift-card code, the owner's notes;
 *   · a receipt link on an order that was never paid, or on one paid
 *     «По счёту», whose document is the invoice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { looksDelivered, looksReturned } from "@/lib/delivery";
import { parcelStateOf, receiptAllowed } from "@/lib/account-orders";
import { accountReceiptPath, listCustomerOrders } from "@/lib/customers";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const WHO = "details.buyer@example.com";
const DAY = 24 * 60 * 60 * 1000;
let clock = Date.now() - 400 * DAY;

type Row = {
  status?: string;
  items?: unknown[];
  subtotal?: number;
  shippingPrice?: number;
  discount?: number;
  discountCode?: string | null;
  loyalty?: number;
  total?: number;
  shipping?: Record<string, unknown>;
  payment?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
  notes?: string | null;
  phone?: string;
};

/** One order row straight into the table — createOrder() is not what is under test. Each is a day newer. */
async function put(r: Row = {}): Promise<string> {
  clock += DAY;
  const rows = await query<{ number: string }>(
    `insert into orders (lang, email, phone, name, status, items, subtotal, shipping_price, discount, discount_code,
                         loyalty_discount, total, shipping, payment, invoice, notes, created_at)
     values ('RU', $1, $2, 'Mari Tamm', $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15)
     returning number`,
    [
      WHO,
      r.phone ?? "+372 5555 5555",
      r.status ?? "paid",
      JSON.stringify(r.items ?? [ITEM]),
      r.subtotal ?? 54,
      r.shippingPrice ?? 3.19,
      r.discount ?? 0,
      r.discountCode ?? null,
      r.loyalty ?? 0,
      r.total ?? 57.19,
      JSON.stringify(r.shipping ?? LOCKER),
      r.payment === undefined ? JSON.stringify(CARD) : r.payment === null ? null : JSON.stringify(r.payment),
      r.invoice ? JSON.stringify(r.invoice) : null,
      r.notes ?? null,
      new Date(clock).toISOString(),
    ],
  );
  return rows[0].number;
}
async function row(number: string) {
  const list = await listCustomerOrders(WHO);
  const o = list.find((x) => x.number === number);
  expect(o, `${number} is not in the list`).toBeTruthy();
  return o!;
}

/* Stored at purchase: 27 € a bottle. Today's catalogue can say anything. */
const ITEM = { id: "kevin-murphy-fresh-hair", kind: "product", brand: "Kevin.Murphy", title: "Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 };
const LOCKER = {
  method: "parcel",
  country: "EE",
  carrier: "omniva",
  pointId: "PT-SECRET-9931",
  pointName: "Kristiine keskus",
  pointType: "parcel_machine",
  price: 3.19,
};
const CARD = { provider: "montonio", method: "card", status: "paid", ref: "REF-SECRET-1", at: "2026-01-01T10:00:00.000Z" };
const MONT = {
  shipmentId: "SHIP-SECRET-1",
  carrier: "omniva",
  trackingCode: "CE123456789EE",
  trackingUrl: "https://www.omniva.ee/track/CE123456789EE",
  dropOffPin: "PIN-SECRET-4411",
  labelUrl: "https://label.example/SECRET.pdf",
  status: "inTransit",
};

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(async () => {
  await teardownDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("the parcel, in words", () => {
  it("names the carrier, the machine and where the parcel is, for a shipped Montonio parcel", async () => {
    const n = await put({ status: "shipped", shipping: { ...LOCKER, montonio: MONT } });
    expect((await row(n)).parcel).toEqual({ carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: "inTransit" });
  });

  it("says a parcel waits at a counter, not at a machine, when the point is a pickup point", async () => {
    const n = await put({
      status: "shipped",
      shipping: { ...LOCKER, carrier: "dpd", pointName: "Rimi Mustamäe", pointType: "pickup_point", montonio: { ...MONT, carrier: "dpd", status: "awaitingCollection" } },
    });
    expect((await row(n)).parcel).toEqual({ carrier: "DPD", place: "counter", point: "Rimi Mustamäe", city: null, state: "awaitingCollection" });
  });

  it("gives a courier parcel the word «Курьер» and the city, never a point", async () => {
    const n = await put({
      status: "delivered",
      shipping: {
        method: "courier",
        country: "EE",
        carrier: "dpd",
        address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" },
        price: 6.89,
        montonio: { ...MONT, carrier: "dpd", status: "delivered" },
      },
    });
    expect((await row(n)).parcel).toEqual({ carrier: "DPD", place: "courier", point: null, city: "Tallinn", state: "delivered" });
  });

  it("says a parcel is on its way back, and names SmartPosti and Nova Post the way the shop does", async () => {
    const back = await put({ status: "shipped", shipping: { ...LOCKER, carrier: "smartpost", montonio: { ...MONT, carrier: "itella", status: "returned" } } });
    expect((await row(back)).parcel).toMatchObject({ carrier: "SmartPosti", state: "returned" });
    const nova = await put({ status: "shipped", shipping: { ...LOCKER, carrier: "novapost", montonio: { ...MONT, carrier: "novapost", status: "inTransit" } } });
    expect((await row(nova)).parcel).toMatchObject({ carrier: "Nova Post", state: "inTransit" });
    const uni = await put({ status: "shipped", shipping: { ...LOCKER, carrier: "unisend", montonio: { ...MONT, carrier: "unisend", status: "inTransit" } } });
    expect((await row(uni)).parcel).toMatchObject({ carrier: "Unisend" });
  });

  it("has no state word for a status it does not know — carrier and point only", async () => {
    const n = await put({ status: "shipped", shipping: { ...LOCKER, montonio: { ...MONT, status: "registered" } } });
    expect((await row(n)).parcel).toEqual({ carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: null });
  });

  it("shows no parcel for a label still on the shelf, for a pickup and for a gift card", async () => {
    const shelf = await put({ status: "paid", shipping: { ...LOCKER, montonio: MONT } });
    expect((await row(shelf)).parcel).toBeNull();
    const pickup = await put({ status: "shipped", shipping: { method: "pickup", country: "EE", price: 0 } });
    expect((await row(pickup)).parcel).toBeNull();
    const digital = await put({ status: "delivered", shipping: { method: "digital", country: "EE", price: 0 } });
    expect((await row(digital)).parcel).toBeNull();
  });

  it("does not read the state of a label the journal set aside — the order's own carrier and point stay", async () => {
    const n = await put({ status: "shipped", shipping: { ...LOCKER, montonio: { ...MONT, dismissed: true, status: "delivered" } } });
    expect((await row(n)).parcel).toEqual({ carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: null });
  });

  it("reads Montonio's vocabulary the way the nightly delivery check does", () => {
    for (const word of ["delivered", "Delivered", "delivered_to_parcel_machine", "picked_up", "collected", "handed-over", "completed", "finished"]) {
      expect(looksDelivered(word), word).toBe(true);
      expect(parcelStateOf(word), word).toBe("delivered");
    }
    for (const word of ["returned", "returning", "return_to_sender", "returned_to_sender"]) {
      expect(looksReturned(word), word).toBe(true);
      expect(parcelStateOf(word), word).toBe("returned");
    }
    expect(parcelStateOf("inTransit")).toBe("inTransit");
    expect(parcelStateOf("in_transit")).toBe("inTransit");
    expect(parcelStateOf("awaitingCollection")).toBe("awaitingCollection");
    for (const word of ["", "pending", "registered", "registrationFailed", "labelsCreated", "whatever"]) {
      expect(looksDelivered(word), word).toBe(false);
      expect(parcelStateOf(word), word).toBeNull();
    }
  });
});

describe("the order's details", () => {
  it("prints the items at the prices stored with the order — never today's catalogue", async () => {
    const n = await put({
      items: [ITEM, { id: "proraso-wood", kind: "product", brand: "Proraso", title: "Wood & Spice масло", variant: null, qty: 1, price: 17 }],
      subtotal: 71,
      total: 74.19,
    });
    const o = await row(n);
    expect(o.items).toEqual([
      { title: "Kevin.Murphy Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 },
      // a row written before `sum` existed: price × qty
      { title: "Proraso Wood & Spice масло", variant: null, qty: 1, price: 17, sum: 17 },
    ]);
  });

  it("describes a parcel-machine delivery with its carrier, machine and price", async () => {
    const o = await row(await put());
    expect(o.details.delivery).toEqual({ method: "parcel", place: "locker", carrier: "Omniva", point: "Kristiine keskus", address: null, price: 3.19 });
  });

  it("describes a courier delivery with the address it was sent to", async () => {
    const o = await row(
      await put({
        shippingPrice: 6.89,
        shipping: { method: "courier", country: "EE", carrier: "dpd", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" }, price: 6.89 },
      }),
    );
    // the order card's own spelling of it (admin: street, index, city)
    expect(o.details.delivery).toEqual({ method: "courier", place: null, carrier: "DPD", point: null, address: "Testitänav 1, 10111, Tallinn", price: 6.89 });
  });

  it("tells a promo code, a gift card and points apart, and masks the card", async () => {
    const promo = await row(await put({ discount: 5, discountCode: "SUVI5", total: 52.19 }));
    expect(promo.details.promo).toEqual({ code: "SUVI5", amount: 5 });
    expect(promo.details.giftCard).toBeNull();
    expect(promo.details.points).toBe(0);

    const gift = await row(await put({ discount: 20, discountCode: "RMP-ACDE-4679", loyalty: 4, total: 33.19 }));
    expect(gift.details.promo).toBeNull();
    expect(gift.details.giftCard).toEqual({ code: "RMP-••••-4679", amount: 20 });
    expect(gift.details.points).toBe(4);
    // the card's whole code is a bearer credential while it still holds money
    expect(JSON.stringify(gift)).not.toContain("ACDE");
  });

  it("names how it was paid — the bank by its own name, a card, a wallet, an invoice, a gift card, the till", async () => {
    const bank = await row(await put({ payment: { provider: "montonio", method: "bank", bank: "HABAEE2X", status: "paid", ref: "R1", detail: "paymentInitiation · Swedbank" } }));
    expect(bank.details.payment).toEqual({ method: "bank", bank: "Swedbank" });
    // no name from the bank itself: its BIC, which the shop names from its own list
    const bic = await row(await put({ payment: { provider: "montonio", method: "bank", bank: "LHVBEE22", status: "paid", ref: "R2" } }));
    expect(bic.details.payment).toEqual({ method: "bank", bank: "LHVBEE22" });
    expect((await row(await put({ payment: CARD }))).details.payment).toEqual({ method: "card", bank: null });
    expect((await row(await put({ payment: { ...CARD, method: "wallet" } }))).details.payment).toEqual({ method: "wallet", bank: null });
    expect((await row(await put({ payment: { provider: "none", method: "giftcard", status: "paid" } }))).details.payment).toEqual({ method: "giftcard", bank: null });
    expect((await row(await put({ payment: { provider: "pos", method: "cash", status: "paid" } }))).details.payment).toEqual({ method: "cash", bank: null });
    // «По счёту» is how it will be paid even before it is
    const inv = await row(
      await put({ status: "new", payment: { provider: "invoice", method: "invoice", status: "pending", ref: "A-2026-0001" }, invoice: { number: "A-2026-0001", issueDate: "2026-09-01", dueAt: "2026-09-08" } }),
    );
    expect(inv.details.payment).toEqual({ method: "invoice", bank: null });
    // a card payment that never went through says nothing about how it was paid
    expect((await row(await put({ status: "new", payment: { ...CARD, status: "pending" } }))).details.payment).toBeNull();
    // a word the shop does not have is not handed on
    expect((await row(await put({ payment: { ...CARD, method: "crypto" } }))).details.payment).toBeNull();
  });

  it("lists the refunds that went out or are on their way, never a failed one", async () => {
    const o = await row(
      await put({
        payment: {
          ...CARD,
          refunds: [
            { ref: "rf-1", amount: 10, status: "done", at: "2026-02-01T10:00:00.000Z", doneAt: "2026-02-03T10:00:00.000Z", by: "admin" },
            { ref: "rf-2", amount: 5, status: "pending", at: "2026-02-04T10:00:00.000Z", by: "admin" },
            { ref: "rf-3", amount: 99, status: "failed", at: "2026-02-05T10:00:00.000Z" },
            { ref: "rf-4", amount: 7, status: "done", at: "2026-02-06T10:00:00.000Z", to: "giftcard", code: "RMP-AAAA-BBBB" },
          ],
        },
      }),
    );
    expect(o.details.refunds).toEqual([
      { amount: 10, status: "done", toGiftCard: false, at: "2026-02-03T10:00:00.000Z" },
      { amount: 5, status: "pending", toGiftCard: false, at: "2026-02-04T10:00:00.000Z" },
      { amount: 7, status: "done", toGiftCard: true, at: "2026-02-06T10:00:00.000Z" },
    ]);
    expect(JSON.stringify(o)).not.toContain("rf-1");
    expect(JSON.stringify(o)).not.toContain("AAAA");
  });

  it("hands the browser nothing internal — no ids, tokens, PINs, references or notes", async () => {
    const n = await put({
      status: "shipped",
      shipping: { ...LOCKER, montonio: MONT, returnRequest: { at: "2026-01-02T00:00:00.000Z", note: "NOTE-SECRET-RET" } },
      payment: { provider: "montonio", method: "bank", bank: "HABAEE2X", status: "paid", ref: "REF-SECRET-2", detail: "paymentInitiation · Swedbank", amountMismatch: { got: 1, expected: 2 } },
      notes: "NOTE-SECRET-OWNER",
      phone: "+372 5999 1234",
    });
    const o = await row(n);
    const json = JSON.stringify(o);
    for (const secret of ["PT-SECRET", "SHIP-SECRET", "PIN-SECRET", "label.example", "REF-SECRET", "NOTE-SECRET", "5999 1234", "paymentInitiation", "amountMismatch", "montonio"]) {
      expect(json, secret).not.toContain(secret);
    }
    const [{ id }] = await query<{ id: string }>("select id from orders where number = $1", [n]);
    expect(json).not.toContain(id);
    // the exact shapes — a field added here is a field somebody has to decide may leave the server
    expect(Object.keys(o.parcel!).sort()).toEqual(["carrier", "city", "place", "point", "state"]);
    expect(Object.keys(o.details).sort()).toEqual(["delivery", "giftCard", "payment", "points", "promo", "refunds"]);
    expect(Object.keys(o.details.delivery).sort()).toEqual(["address", "carrier", "method", "place", "point", "price"]);
    for (const it of o.items) expect(Object.keys(it).sort()).toEqual(["price", "qty", "sum", "title", "variant"]);
  });
});

describe("«Скачать чек (PDF)» — which orders get one", () => {
  it("links a receipt on every order that was paid, and on a refunded one", async () => {
    for (const status of ["paid", "shipped", "delivered", "refunded"]) {
      const n = await put({ status });
      expect((await row(n)).receipt, status).toEqual({ pdfUrl: `/api/account/orders/${encodeURIComponent(n)}/receipt/` });
      expect(accountReceiptPath(n)).toBe(`/api/account/orders/${encodeURIComponent(n)}/receipt/`);
    }
  });

  it("links none on an order that was never paid", async () => {
    for (const status of ["new", "failed", "cancelled"]) {
      const n = await put({ status, payment: { ...CARD, status: "pending" } });
      expect((await row(n)).receipt, status).toBeNull();
    }
  });

  it("links none on an order paid «По счёту» — the invoice is its document", async () => {
    const n = await put({
      status: "paid",
      payment: { provider: "invoice", method: "invoice", status: "paid", ref: "A-2026-0002" },
      invoice: { number: "A-2026-0002", issueDate: "2026-09-01", dueAt: "2026-09-08", paidAt: "2026-09-03T10:00:00.000Z" },
    });
    const o = await row(n);
    expect(o.receipt).toBeNull();
    expect(o.invoice?.number).toBe("A-2026-0002");
  });

  it("is one rule for the list and the route", () => {
    expect(receiptAllowed({ status: "paid", invoice: null })).toBe(true);
    expect(receiptAllowed({ status: "refunded", invoice: undefined })).toBe(true);
    expect(receiptAllowed({ status: "new", invoice: null })).toBe(false);
    expect(receiptAllowed({ status: "cancelled", invoice: null })).toBe(false);
    expect(receiptAllowed({ status: "paid", invoice: { number: "A-2026-0001" } })).toBe(false);
    expect(receiptAllowed({ status: "paid", invoice: JSON.stringify({ number: "A-2026-0001" }) })).toBe(false);
    // an invoice record with no number is no invoice
    expect(receiptAllowed({ status: "paid", invoice: {} })).toBe(true);
  });
});
