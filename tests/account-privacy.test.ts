/**
 * «Скачать мои данные» and «Удалить аккаунт» (Dim, 28.09.2026) — GET
 * /api/account/export/, GET + POST /api/account/delete/ and
 * src/lib/account-privacy.ts behind them.
 *
 * What this file exists to catch is a deletion that says «удалён» and is not,
 * or that takes what the law says must stay:
 *   · a customers row, a login code, a saved basket, a subscription or a
 *     points line surviving the deletion;
 *   · an order DELETED (the Accounting Act keeps them seven years) — or kept
 *     but still showing in an account, even a new one on the same mailbox;
 *   · a review deleted instead of anonymised, or still carrying the address;
 *   · the address missing from the stop list, or losing its «account
 *     deleted» mark to a later click on an old letter's link;
 *   · the journal row carrying the address in clear;
 *   · the deletion going through while an order is still on its way;
 *   · a second request (a double tap, another device's leftover cookie)
 *     deleting twice, writing twice, or re-creating the account;
 *   · an export that leaks another customer's data or an internal id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { resetRateLimits } from "@/lib/auth";
import { ANON_REVIEW_NAME, ERASED_OPTOUT_KIND, OPEN_ORDER_DAYS } from "@/lib/account-privacy";
import { optOut, recordMarketingConsent } from "@/lib/consent";
import {
  addStockAlert,
  allowGuestCartWrite,
  CUSTOMER_COOKIE,
  customerTokenIssuedAt,
  getCustomer,
  issueLoginCode,
  listCustomerOrders,
  makeCustomerToken,
  recordLogin,
  saveCart,
  updateCustomer,
} from "@/lib/customers";
import { query } from "@/lib/db";
import { customerOrdersAdmin, getCustomerAdminByEmail } from "@/lib/loyalty";
import { createOrder, setSetting } from "@/lib/orders";
import { addReview } from "@/lib/reviews";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; s: string };
const VARIANTS = variants as Record<string, unknown>;
/* A single-size product in stock: the order is not what is under test. */
const PRODUCT = (catalogueMin as Min[]).find((p) => p.s === "in" && !VARIANTS[p.id])!.id;

const BUYER = "mari.tamm@example.com";
const OTHER = "somebody-else@example.com";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const COMPANY = { name: "Salong Näidis OÜ", regCode: "16123456", vatNumber: "EE101234567", address: "Pärnu mnt 10, 10148 Tallinn", email: "raamatupidaja@example.com" };

function orderInput(email: string, over: Record<string, unknown> = {}) {
  return {
    lang: "ru",
    items: [{ id: PRODUCT, qty: 2 }],
    customer: { name: "Mari Tamm", email, phone: "+372 5555 5555" },
    shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
    ...over,
  } as Parameters<typeof createOrder>[0];
}

/** An order in a given status, paid by bank link, created `daysAgo` days ago. */
async function order(email: string, status: string, opts: { daysAgo?: number; channel?: string; customerId?: string } = {}) {
  const o = await createOrder(orderInput(email), opts.customerId ? { customerId: opts.customerId } : {});
  await query(
    `update orders set status = $2, channel = $3,
            payment = '{"provider":"montonio","method":"bank","ref":"secret-provider-ref-42","status":"paid"}'::jsonb,
            created_at = now() - ($4 || ' days')::interval
      where id = $1`,
    [o.id, status, opts.channel ?? "web", String(opts.daysAgo ?? 1)],
  );
  return o;
}

/** A session cookie signed `agoMs` before now (negative: after now). */
function token(email: string, agoMs = 60_000) {
  return makeCustomerToken(email, Date.now() - agoMs);
}

function req(method: string, path: string, opts: { token?: string | null; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `${CUSTOMER_COOKIE}=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`https://rempireshop.com${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

const cleared = (res: Response) => {
  const c = res.headers.get("set-cookie") ?? "";
  return c.startsWith(`${CUSTOMER_COOKIE}=;`) && /Max-Age=0/.test(c);
};

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await query<{ n: number | string }>(sql, params);
  return Number(rows[0]?.n) || 0;
}

/**
 * A customer with one of everything the account holds: a profile, marketing
 * consent, a default delivery, a login code in flight, a saved basket and its
 * write counter, a «сообщить о наличии» subscription, a review, points, a
 * newsletter row and two orders — one delivered with a return asked for, one
 * cancelled. And a stranger with the same kinds of things, who must come out
 * of every test exactly as he went in.
 */
async function seed() {
  const cust = await recordLogin(BUYER, "ET");
  await updateCustomer(BUYER, {
    name: "Mari Tamm",
    phone: "+372 5555 5555",
    birthday: "1990-04-12",
    shipPref: { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
  });
  await recordMarketingConsent(BUYER, "ET", "account");
  await issueLoginCode(BUYER);
  await saveCart({ email: BUYER, items: [{ id: PRODUCT, qty: 1 }] });
  await allowGuestCartWrite(BUYER);
  await addStockAlert({ email: BUYER, productId: PRODUCT, lang: "ET" });
  const rev = await addReview({ productId: PRODUCT, name: "Mari T.", rating: 5, text: "Väga hea šampoon, soovitan kõigile.", lang: "ET" }, "iphash-1", BUYER);
  await query("update reviews set status = 'approved' where id = $1", [rev.id]);

  const delivered = await order(BUYER, "delivered", { daysAgo: 10, customerId: cust.id });
  await query(
    `update orders set shipping = shipping || '{"returnRequest":{"at":"2026-09-20T10:00:00.000Z"},"montonio":{"trackingCode":"EE123456789"}}'::jsonb where id = $1`,
    [delivered.id],
  );
  const cancelled = await order(BUYER, "cancelled", { daysAgo: 5 });
  await query("insert into loyalty_ledger (customer_id, delta, reason, order_id) values ($1, 7, 'earn', $2)", [cust.id, delivered.id]);
  await query("insert into loyalty_ledger (customer_id, delta, reason, note) values ($1, 5, 'adjust', 'Tere tulemast')", [cust.id]);
  const nl = await query<{ id: string }>(
    `insert into newsletters (title, status, subject) values ('Sügis — sisemine nimi', 'sent', '{"RU":"Осенние предложения","ET":"Sügise pakkumised"}'::jsonb) returning id`,
  );
  await query("insert into newsletter_sends (newsletter_id, email, lang, status, sent_at) values ($1, $2, 'ET', 'sent', now())", [nl[0].id, BUYER]);
  // the thread under the delivered order, and the journal row the return tick wrote with the address as actor
  await query("insert into order_messages (order_id, direction, body) values ($1, 'in', 'Kas saab tagastada?')", [delivered.id]);
  await query(
    `insert into order_messages (order_id, direction, body, meta) values ($1, 'out', 'Jah, loomulikult.', '{"subject":"Re: tagastus","resendId":"re_123"}'::jsonb)`,
    [delivered.id],
  );
  await query("insert into admin_audit (actor, action, payload) values ($1, 'order.return_request', $2::jsonb)", [
    BUYER,
    JSON.stringify({ number: delivered.number }),
  ]);
  await query("insert into admin_audit (actor, action, payload) values ($1, 'order.return_request', '{}'::jsonb)", [OTHER]);

  // the stranger
  const other = await recordLogin(OTHER, "RU");
  await updateCustomer(OTHER, { name: "Иван" });
  await saveCart({ email: OTHER, items: [{ id: PRODUCT, qty: 3 }] });
  await addStockAlert({ email: OTHER, productId: PRODUCT });
  await addReview({ productId: PRODUCT, name: "Иван", rating: 4, text: "Хороший шампунь, пользуюсь давно.", lang: "RU" }, null, OTHER);
  const theirs = await order(OTHER, "delivered", { daysAgo: 3, customerId: other.id });
  await query("insert into loyalty_ledger (customer_id, delta, reason) values ($1, 9, 'adjust')", [other.id]);

  return { cust, other, delivered, cancelled, theirs, newsletterId: nl[0].id };
}

const ENV_KEYS = ["RESEND_API_KEY", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.RESEND_API_KEY;
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
  await query(
    "truncate customers, login_codes, carts, cart_writes, stock_alerts, reviews, mail_optouts, loyalty_ledger, newsletter_sends, newsletters, invoice_counters restart identity cascade",
  );
  await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
});

/* ---------- export ---------------------------------------------------------- */

describe("GET /api/account/export/", () => {
  it("answers 401 without a session — there is nothing in the request to name somebody else's file", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    const res = await GET(req("GET", "/api/account/export/"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("hands the signed-in customer their own data as a JSON attachment, readable and without internal ids", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    const s = await seed();
    const res = await GET(req("GET", "/api/account/export/", { token: token(BUYER) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="rempire-mydata-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).toContain('\n  "profile": {'); // pretty-printed — a person reads this file

    // nothing internal: no uuid (order, customer, review, ledger ids), no provider reference, no login secret
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("secret-provider-ref-42");
    expect(text).not.toContain("code_hash");
    // …and nothing of the stranger's
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain("Иван");
    expect(text).not.toContain(s.theirs.number);

    const data = JSON.parse(text);
    expect(data.format).toBe("rempire-account-data");
    expect(data.email).toBe(BUYER);
    expect(data.profile).toMatchObject({
      email: BUYER,
      name: "Mari Tamm",
      phone: "+372 5555 5555",
      birthday: "1990-04-12",
      language: "ET",
      marketingConsent: { given: true, where: "account", withdrawnAt: null },
      defaultDelivery: { country: "EE", method: "courier", address: { street: "Testitänav 1", postcode: "10111", city: "Tallinn" } },
      partner: { status: "retail" },
    });
    expect(data.profile.marketingConsent.givenAt).toMatch(/^\d{4}-/);

    expect(data.orders.map((o: { number: string }) => o.number).sort()).toEqual([s.cancelled.number, s.delivered.number].sort());
    const d = data.orders.find((o: { number: string }) => o.number === s.delivered.number);
    expect(d).toMatchObject({
      status: "delivered",
      placed: "online",
      payment: "bank link",
      currency: "EUR",
      buyer: { name: "Mari Tamm", email: BUYER, phone: "+372 5555 5555" },
      delivery: { method: "courier", country: "EE", address: { street: "Testitänav 1", postcode: "10111", city: "Tallinn" }, tracking: "EE123456789" },
      returnRequestedAt: "2026-09-20T10:00:00.000Z",
    });
    expect(d.items).toHaveLength(1);
    expect(d.items[0].quantity).toBe(2);
    expect(d.total).toBeGreaterThan(0);
    expect(data.orders.find((o: { number: string }) => o.number === s.cancelled.number).status).toBe("cancelled");

    expect(data.loyaltyPoints.balance).toBe(12);
    expect(data.loyaltyPoints.history.map((h: { reason: string; points: number; order: string | null }) => [h.reason, h.points, h.order]))
      .toEqual(expect.arrayContaining([["earned", 7, s.delivered.number], ["adjustment", 5, null]]));
    expect(data.stockAlerts).toEqual([expect.objectContaining({ productId: PRODUCT, language: "ET", notifiedAt: null })]);
    expect(data.stockAlerts[0].product).not.toBe(PRODUCT); // the product's name, not its id alone
    expect(data.reviews).toEqual([expect.objectContaining({ productId: PRODUCT, name: "Mari T.", rating: 5, status: "approved" })]);
    expect(data.returnRequests).toEqual([{ order: s.delivered.number, requestedAt: "2026-09-20T10:00:00.000Z" }]);
    expect(data.savedCart.items).toHaveLength(1);
    expect(data.marketingOptOut).toBeNull();
    // the correspondence under the order — the customer's words and the reply, without the mail provider's id
    expect(d.messages).toEqual([
      { from: "you", subject: null, text: "Kas saab tagastada?", date: expect.any(String) },
      { from: "the shop", subject: "Re: tagastus", text: "Jah, loomulikult.", date: expect.any(String) },
    ]);
    expect(text).not.toContain("re_123");
    // the newsletters sent, by the subject they went out with — never the owner's internal title
    expect(data.newsletters).toEqual([{ subject: "Sügise pakkumised", status: "sent", sentAt: expect.any(String) }]);
    expect(text).not.toContain("sisemine nimi");
  });

  it("puts an invoice order's company and invoice number in, and never a gift recipient's data", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    await recordLogin(BUYER);
    const inv = await createOrder(orderInput(BUYER, { payment: { method: "invoice" }, company: COMPANY }));
    const res = await GET(req("GET", "/api/account/export/", { token: token(BUYER) }));
    const data = JSON.parse(await res.text());
    const o = data.orders.find((x: { number: string }) => x.number === inv.number);
    expect(o.payment).toBe("invoice (bank transfer)");
    expect(o.company).toMatchObject({ name: COMPANY.name, registryCode: COMPANY.regCode, vatNumber: COMPANY.vatNumber });
    expect(o.invoiceNumber).toMatch(/\S/);
  });

  it("is rate-limited like the other account routes", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    await recordLogin(BUYER);
    const t = token(BUYER);
    for (let i = 0; i < 10; i++) expect((await GET(req("GET", "/api/account/export/", { token: t }))).status).toBe(200);
    expect((await GET(req("GET", "/api/account/export/", { token: t }))).status).toBe(429);
  });
});

/* ---------- delete ---------------------------------------------------------- */

describe("POST /api/account/delete/ — who may", () => {
  it("answers 401 without a session and deletes nothing", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    const res = await POST(req("POST", "/api/account/delete/", { body: { confirm: BUYER } }));
    expect(res.status).toBe(401);
    expect(await getCustomer(BUYER)).not.toBeNull();
  });

  it("refuses a confirmation that is not the account's own e-mail", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    for (const confirm of ["", "mari@example.com", OTHER, null]) {
      const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm } }));
      expect(res.status, String(confirm)).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "confirm_mismatch" });
    }
    // the typed address is compared the way the shop keys it: case and spaces do not matter
    const ok = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: "  Mari.Tamm@Example.com " } }));
    expect(ok.status).toBe(200);
  });

  it("refuses a request another site's page sent, even with the cookie", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER }, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await getCustomer(BUYER)).not.toBeNull();
    // the shop's own page sends its own origin
    const own = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER }, origin: "https://rempireshop.com" }));
    expect(own.status).toBe(200);
  });
});

describe("POST /api/account/delete/ — what goes, what stays", () => {
  it("deletes the account and everything that existed only for it, in one go", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const s = await seed();
    const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cleared(res)).toBe(true);

    expect(await getCustomer(BUYER)).toBeNull();
    for (const t of ["login_codes", "carts", "cart_writes", "stock_alerts", "newsletter_sends"]) {
      expect(await count(`select count(*)::int as n from ${t} where email = $1`, [BUYER]), t).toBe(0);
    }
    expect(await count("select count(*)::int as n from loyalty_ledger where customer_id = $1", [s.cust.id])).toBe(0);
  });

  it("KEEPS every order with its buyer data — detached, so no account shows it again", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const s = await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));

    const rows = await query<{ number: string; email: string; name: string; phone: string; customer_id: string | null; account_erased_at: unknown }>(
      "select number, email, name, phone, customer_id, account_erased_at from orders where lower(email) = $1 order by number",
      [BUYER],
    );
    expect(rows.map((r) => r.number)).toEqual([s.delivered.number, s.cancelled.number].sort());
    for (const r of rows) {
      expect([r.email, r.name, r.phone]).toEqual([BUYER, "Mari Tamm", "+372 5555 5555"]);
      expect(r.customer_id).toBeNull();
      expect(r.account_erased_at).not.toBeNull();
    }
    // not in «Мои заказы», not even for a new account on the same mailbox…
    expect(await listCustomerOrders(BUYER)).toEqual([]);
    await recordLogin(BUYER);
    expect(await listCustomerOrders(BUYER)).toEqual([]);
    // …nor on the owner's card of that new account
    expect((await customerOrdersAdmin(BUYER)).orders).toEqual([]);
    expect((await getCustomerAdminByEmail(BUYER))?.ordersCount).toBe(0);
    // a NEW order on that mailbox is the new account's, as usual
    const next = await order(BUYER, "paid");
    expect((await listCustomerOrders(BUYER)).map((o) => o.number)).toEqual([next.number]);
  });

  it("detaches an order a signed-in customer placed under ANOTHER address without hiding it from that address", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const cust = await recordLogin(BUYER);
    const forFriend = await order(OTHER, "delivered", { customerId: cust.id });
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    const [row] = await query<{ customer_id: string | null; account_erased_at: unknown }>(
      "select customer_id, account_erased_at from orders where id = $1",
      [forFriend.id],
    );
    expect(row.customer_id).toBeNull();
    expect(row.account_erased_at).toBeNull();
    expect((await listCustomerOrders(OTHER)).map((o) => o.number)).toEqual([forFriend.number]);
  });

  it("anonymises the reviews — the text and the stars stay, the name becomes «Покупатель», the address goes", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    const rows = await query<{ name: string; email: string | null; ip_hash: string | null; text: string; rating: number; status: string }>(
      "select name, email, ip_hash, text, rating, status from reviews where text like 'Väga hea%'",
    );
    expect(rows).toEqual([{ name: ANON_REVIEW_NAME, email: null, ip_hash: null, text: "Väga hea šampoon, soovitan kõigile.", rating: 5, status: "approved" }]);
    expect(ANON_REVIEW_NAME).toBe("Покупатель");
  });

  it("puts the address on the stop list as «account deleted», and a later unsubscribe click keeps that mark and date", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    const [before] = await query<{ kind: string; source: string; at: Date | string }>("select kind, source, at from mail_optouts where email = $1", [BUYER]);
    expect(before.kind).toBe(ERASED_OPTOUT_KIND);
    expect(before.source).toBe("account");

    await optOut(BUYER, "marketing", "one-click");
    const [after] = await query<{ kind: string; source: string; at: Date | string }>("select kind, source, at from mail_optouts where email = $1", [BUYER]);
    expect(after.kind).toBe(ERASED_OPTOUT_KIND);
    expect(new Date(after.at).getTime()).toBe(new Date(before.at).getTime());
    // an ordinary opt-out still moves as it always did
    await optOut(OTHER, "marketing");
    await optOut(OTHER, "backstock", "one-click");
    const [plain] = await query<{ kind: string; source: string }>("select kind, source from mail_optouts where email = $1", [OTHER]);
    expect(plain).toEqual({ kind: "backstock", source: "one-click" });
  });

  it("writes one journal row for the owner — the orders' numbers and counts, never the address", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const s = await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    const rows = await query<{ actor: string; action: string; payload: Record<string, unknown> }>(
      "select actor, action, payload from admin_audit where action = 'customer.account_deleted'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("customer");
    expect(rows[0].payload).toMatchObject({
      orders: [s.delivered.number, s.cancelled.number].sort(),
      reviews: 1,
      points: 12,
      alerts: 1,
    });
    expect(String(rows[0].payload.number)).toContain(s.delivered.number);
    const flat = JSON.stringify(rows);
    expect(flat).not.toContain(BUYER);
    expect(flat.toLowerCase()).not.toContain("mari");

    // the row the customer's own return tick wrote keeps its order, loses the address; the stranger's is untouched
    const ticks = await query<{ actor: string; payload: Record<string, unknown> }>(
      "select actor, payload from admin_audit where action = 'order.return_request' order by id",
    );
    expect(ticks.map((t) => t.actor)).toEqual(["customer", OTHER]);
    expect(ticks[0].payload).toEqual({ number: s.delivered.number });
    expect(await count("select count(*)::int as n from admin_audit where actor = $1", [BUYER])).toBe(0);
  });

  it("leaves another customer exactly as he was", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const s = await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    expect(await getCustomer(OTHER)).toMatchObject({ name: "Иван" });
    expect(await count("select count(*)::int as n from carts where email = $1", [OTHER])).toBe(1);
    expect(await count("select count(*)::int as n from stock_alerts where email = $1", [OTHER])).toBe(1);
    expect(await count("select count(*)::int as n from reviews where email = $1 and name = 'Иван'", [OTHER])).toBe(1);
    expect(await count("select count(*)::int as n from loyalty_ledger where customer_id = $1", [s.other.id])).toBe(1);
    expect(await count("select count(*)::int as n from mail_optouts where email = $1", [OTHER])).toBe(0);
    expect((await listCustomerOrders(OTHER)).map((o) => o.number)).toEqual([s.theirs.number]);
  });

  it("signing in again later is a new, empty account — marketing off, the stop list still there", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    const again = await recordLogin(BUYER, "RU");
    expect(again).toMatchObject({ name: "", phone: "", birthday: null, marketing: false, shipPref: null });
    expect(await count("select count(*)::int as n from mail_optouts where email = $1", [BUYER])).toBe(1);
  });
});

describe("POST /api/account/delete/ — an order still on its way blocks it", () => {
  for (const status of ["paid", "shipped"]) {
    it(`refuses while an online order is «${status}», names it, deletes nothing — and goes through once it is delivered`, async () => {
      const { POST, GET } = await import("@/app/api/account/delete/route");
      await seed();
      const open = await order(BUYER, status);
      const pre = await GET(req("GET", "/api/account/delete/", { token: token(BUYER) }));
      expect(await pre.json()).toEqual({ ok: true, open: [open.number] });

      const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: "open_orders", orders: [open.number] });
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await getCustomer(BUYER)).not.toBeNull();
      expect(await count("select count(*)::int as n from stock_alerts where email = $1", [BUYER])).toBe(1);
      expect(await count("select count(*)::int as n from mail_optouts where email = $1", [BUYER])).toBe(0);
      expect(await count("select count(*)::int as n from admin_audit where action = 'customer.account_deleted'")).toBe(0);

      await query("update orders set status = 'delivered' where id = $1", [open.id]);
      const after = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
      expect(after.status).toBe(200);
      expect(await getCustomer(BUYER)).toBeNull();
    });
  }

  it("refuses while an invoice is waiting to be paid", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await recordLogin(BUYER);
    const inv = await createOrder(orderInput(BUYER, { payment: { method: "invoice" }, company: COMPANY }));
    const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    expect(res.status).toBe(409);
    expect((await res.json()).orders).toEqual([inv.number]);
  });

  it("does not count what is not a delivery in progress: an unpaid card basket, a sale at the counter, a record nobody closed for months", async () => {
    const { POST, GET } = await import("@/app/api/account/delete/route");
    await recordLogin(BUYER);
    await order(BUYER, "new"); // a payment page nobody came back from
    await order(BUYER, "paid", { channel: "pos" });
    await order(BUYER, "shipped", { daysAgo: OPEN_ORDER_DAYS + 1 });
    await order(BUYER, "failed");
    await order(BUYER, "refunded");
    const pre = await GET(req("GET", "/api/account/delete/", { token: token(BUYER) }));
    expect(await pre.json()).toEqual({ ok: true, open: [] });
    const res = await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/account/delete/ — asked twice", () => {
  it("a second request from the same session deletes nothing more and writes no second journal row", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    await seed();
    const t = token(BUYER);
    expect((await POST(req("POST", "/api/account/delete/", { token: t, body: { confirm: BUYER } }))).status).toBe(200);
    const again = await POST(req("POST", "/api/account/delete/", { token: t, body: { confirm: BUYER } }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, already: true });
    expect(cleared(again)).toBe(true);
    expect(await count("select count(*)::int as n from admin_audit where action = 'customer.account_deleted'")).toBe(1);
    expect(await getCustomer(BUYER)).toBeNull();
  });

  it("a leftover cookie on another device is signed out — and cannot re-create the account by saving a field", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const me = await import("@/app/api/account/me/route");
    const exp = await import("@/app/api/account/export/route");
    const del = await import("@/app/api/account/delete/route");
    await seed();
    const laptop = token(BUYER, 5 * 60_000); // signed in five minutes before the phone deletes
    expect((await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }))).status).toBe(200);

    const got = await me.GET(req("GET", "/api/account/me/", { token: laptop }));
    expect(got.status).toBe(401);
    expect(cleared(got)).toBe(true);
    const patched = await me.PATCH(req("PATCH", "/api/account/me/", { token: laptop, body: { name: "Mari" } }));
    expect(patched.status).toBe(401);
    expect(await getCustomer(BUYER)).toBeNull();
    expect((await exp.GET(req("GET", "/api/account/export/", { token: laptop }))).status).toBe(401);
    expect((await del.GET(req("GET", "/api/account/delete/", { token: laptop }))).status).toBe(401);

    // a session signed in AFTER the deletion is an ordinary one
    const fresh = token(BUYER, -60_000);
    expect(customerTokenIssuedAt(fresh)).toBeGreaterThan(Date.now());
    const ok = await me.GET(req("GET", "/api/account/me/", { token: fresh }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.orders).toEqual([]);
  });
});

describe("the account's per-order doors after a deletion", () => {
  it("the invoice PDF and «Хочу вернуть заказ» answer «not_found» for a detached order, as for one that does not exist", async () => {
    const { POST } = await import("@/app/api/account/delete/route");
    const invoiceRoute = await import("@/app/api/account/orders/[id]/invoice/route");
    const returnRoute = await import("@/app/api/account/return-request/route");
    await recordLogin(BUYER);
    const inv = await createOrder(orderInput(BUYER, { payment: { method: "invoice" }, company: COMPANY }));
    await query("update orders set status = 'delivered', shipping = shipping || $2::jsonb where id = $1", [
      inv.id,
      JSON.stringify({ deliveredAt: new Date().toISOString() }),
    ]);
    // the door works before the deletion…
    const before = await invoiceRoute.GET(req("GET", `/api/account/orders/${inv.number}/invoice/`, { token: token(BUYER) }), {
      params: Promise.resolve({ id: inv.number }),
    });
    expect(before.status).toBe(200);

    expect((await POST(req("POST", "/api/account/delete/", { token: token(BUYER), body: { confirm: BUYER } }))).status).toBe(200);
    await recordLogin(BUYER);
    const fresh = token(BUYER, -60_000);
    const pdf = await invoiceRoute.GET(req("GET", `/api/account/orders/${inv.number}/invoice/`, { token: fresh }), {
      params: Promise.resolve({ id: inv.number }),
    });
    expect(pdf.status).toBe(404);
    expect(await pdf.json()).toEqual({ ok: false, error: "not_found" });
    const ret = await returnRoute.POST(req("POST", "/api/account/return-request/", { token: fresh, body: { number: inv.number } }));
    expect(ret.status).toBe(404);
    expect(await ret.json()).toEqual({ ok: false, error: "not_found" });
  });
});
