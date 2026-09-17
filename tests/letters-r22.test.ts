/**
 * Six answers about letters and consent — Dim, 17.09.2026.
 *
 * Every one was confirmed deliberately, so what is pinned here is the
 * DECISION, not the implementation that carries it:
 *
 *   1. a guest order must not take a stranger off the stop list;
 *   2. the abandoned-cart snapshot is bounded per address, in the database;
 *   3. an unpaid order lets itself go after seven days;
 *   4. turning that switch on must not post the backlog;
 *   5. «Снова в наличии» must not contradict the counter;
 *   6. a partner is welcomed once.
 *
 * tests/flows-unpaid.test.ts holds the unpaid clock's own behaviour and is
 * deliberately left untouched by all of this — 4 is a floor on the LETTER,
 * never a precondition on the cancellation, which is what that file pins.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { isOptedOut, optOut } from "@/lib/consent";
import {
  CART_WRITES_PER_DAY,
  CUSTOMER_COOKIE,
  addStockAlert,
  allowGuestCartWrite,
  getCart,
  makeCustomerToken,
  pruneCartWrites,
  recordLogin,
} from "@/lib/customers";
import { addShopDays, shopDay } from "@/lib/day";
import { exec, query } from "@/lib/db";
import { FLOW_DEFAULTS, getFlows, runUnpaidOrders, stampUnpaidFloor } from "@/lib/flows";
import { move } from "@/lib/inventory";
import { approveProCustomer, getCustomerAdminByEmail, setCustomerTier, upsertPartner } from "@/lib/loyalty";
import { createOrder, getOrder, setSetting, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[] }>;
/* No size ladder: `byProduct` says «out» for a counted product only when the
   whole ladder is counted (src/lib/inventory.ts), and a product with one
   nameless variant is the whole ladder in one move. */
const PLAIN = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const OTHER_PLAIN = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id] && p.id !== PLAIN.id)!;

const ORIGIN = "https://rempireshop.com";
const DAY = 24 * 60 * 60 * 1000;
const VICTIM = "victim@example.com";
const SHOPPER = "shopper@example.com";

/** Every letter Resend was asked for since the last reset. */
const sent: Array<{ subject: string; to: string[] }> = [];
let admin = "";
let ip = 0;

function post(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}`,
  };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function put(path: string, body: unknown, cookie?: string): Request {
  return new Request(post(path, body, cookie), { method: "PUT" });
}

/** The signed `rmp_cust` cookie — the only proof the shop accepts. */
function session(email: string): string {
  return `${CUSTOMER_COOKIE}=${makeCustomerToken(email)}`;
}

const ORDER = {
  lang: "RU",
  items: [{ id: PLAIN.id, qty: 1 }],
  customer: { name: "Мария Тамм", email: VICTIM, phone: "+372 5555 5555" },
  shipping: { method: "pickup", country: "EE" },
};

async function placeOrder(extra: Record<string, unknown> = {}) {
  return createOrder({ ...ORDER, ...extra } as Parameters<typeof createOrder>[0]);
}

/** Backdates an order so the cron's cutoffs can see it. */
async function age(id: string, days: number): Promise<void> {
  await query("update orders set created_at = $2 where id = $1", [id, new Date(Date.now() - days * DAY).toISOString()]);
}

async function setFlows(value: Record<string, unknown>): Promise<void> {
  await setSetting("flows", value);
}

async function optOutRows(email: string): Promise<number> {
  return (await query("select email from mail_optouts where email = $1", [email])).length;
}

async function marketingOf(email: string): Promise<boolean | null> {
  const rows = await query<{ marketing: boolean }>("select marketing from customers where email = $1", [email]);
  return rows.length ? rows[0].marketing : null;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.PUBLIC_BASE_URL = ORIGIN;
  await setupDb();
  // after setupDb: PGlite is up, so stubbing fetch cannot disturb it
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.PUBLIC_BASE_URL;
  await teardownDb();
});

beforeEach(async () => {
  sent.length = 0;
  resetRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { subject: string; to: string[] };
    sent.push({ subject: body.subject, to: body.to });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await exec(
    `truncate customers, login_codes, carts, cart_writes, stock_alerts, mail_optouts,
             orders, settings, product_overrides, admin_audit, stock_levels, stock_moves
     restart identity cascade`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- 1. the stop list is not lifted by a stranger ------------------- */

describe("1 · a guest order records the consent but does not clear the stop list", () => {
  it("leaves an opted-out address on the list when nobody proved it is theirs", async () => {
    await optOut(VICTIM, "marketing");
    expect(await isOptedOut(VICTIM)).toBe(true);

    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(post("/api/orders/", { ...ORDER, newsletter: true }));
    expect(res.status).toBe(201);

    // the shop stores what it was told — the tick is recorded, stamped «checkout»
    expect(await marketingOf(VICTIM)).toBe(true);
    // …and the stop list the real owner of that mailbox wrote is untouched
    expect(await optOutRows(VICTIM)).toBe(1);
    expect(await isOptedOut(VICTIM)).toBe(true);
  });

  it("clears it for a shopper signed in on that very mailbox", async () => {
    await optOut(VICTIM, "marketing");
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(post("/api/orders/", { ...ORDER, newsletter: true }, session(VICTIM)));
    expect(res.status).toBe(201);
    expect(await isOptedOut(VICTIM)).toBe(false);
  });

  it("does not let one signed-in shopper clear somebody else's address", async () => {
    await optOut(VICTIM, "marketing");
    const { POST } = await import("@/app/api/orders/route");
    /* Signed in as SHOPPER, ordering under VICTIM's address: a session is
       proof about one mailbox and about no other. */
    const res = await POST(post("/api/orders/", { ...ORDER, newsletter: true }, session(SHOPPER)));
    expect(res.status).toBe(201);
    expect(await isOptedOut(VICTIM)).toBe(true);
  });

  it("goes on treating the address as silent afterwards", async () => {
    await optOut(VICTIM, "marketing");
    const { POST } = await import("@/app/api/orders/route");
    await POST(post("/api/orders/", { ...ORDER, newsletter: true }));

    // the very question the two flows ask before writing to anybody
    const { optedOutSet } = await import("@/lib/consent");
    expect([...(await optedOutSet([VICTIM, SHOPPER]))]).toEqual([VICTIM]);
  });

  it("is not affected by an order placed without the tick", async () => {
    await optOut(VICTIM, "marketing");
    const { POST } = await import("@/app/api/orders/route");
    await POST(post("/api/orders/", ORDER));
    expect(await isOptedOut(VICTIM)).toBe(true);
    expect(await marketingOf(VICTIM)).not.toBe(true);
  });
});

/* ---------- 2. the cart snapshot is bounded per address -------------------- */

describe("2 · the abandoned-cart snapshot is bounded per address, not per IP", () => {
  const cart = (email: string, cookie?: string) =>
    post("/api/carts/", { email, lang: "RU", items: [{ id: PLAIN.id, qty: 1 }] }, cookie);

  it("stores the counter in the database, keyed on the address and the Tallinn day", async () => {
    const cols = await query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'cart_writes'",
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(["day", "email", "n"]);

    await allowGuestCartWrite(VICTIM);
    const [row] = await query<{ email: string; day: string; n: number | string }>("select * from cart_writes");
    expect(row.email).toBe(VICTIM);
    expect(row.day).toBe(shopDay(Date.now()));
    expect(Number(row.n)).toBe(1);
  });

  it("lets a guest through up to the day's budget and then refuses", async () => {
    const { POST } = await import("@/app/api/carts/route");
    const codes: number[] = [];
    for (let i = 0; i < CART_WRITES_PER_DAY + 3; i++) codes.push((await POST(cart(VICTIM))).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(CART_WRITES_PER_DAY);
    expect(codes.slice(CART_WRITES_PER_DAY)).toEqual([429, 429, 429]);
  });

  it("survives what the in-memory limiter forgets — a cold start and a new IP", async () => {
    const { POST } = await import("@/app/api/carts/route");
    for (let i = 0; i < CART_WRITES_PER_DAY; i++) await POST(cart(VICTIM));

    /* Exactly what a serverless cold start does to src/lib/auth.ts: the Map
       is empty again and the next request arrives from another address. The
       counter that matters is not in the Map. */
    resetRateLimits();
    const fresh = new Request(`${ORIGIN}/api/carts/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
      body: JSON.stringify({ email: VICTIM, items: [{ id: PLAIN.id, qty: 1 }] }),
    });
    expect((await POST(fresh)).status).toBe(429);
  });

  it("bounds one address without touching another", async () => {
    const { POST } = await import("@/app/api/carts/route");
    for (let i = 0; i < CART_WRITES_PER_DAY + 1; i++) await POST(cart(VICTIM));
    expect((await POST(cart(VICTIM))).status).toBe(429);
    expect((await POST(cart(SHOPPER))).status).toBe(200);
  });

  it("does not count a shopper writing their own basket", async () => {
    const { POST } = await import("@/app/api/carts/route");
    for (let i = 0; i < CART_WRITES_PER_DAY + 1; i++) await POST(cart(VICTIM));
    expect((await POST(cart(VICTIM))).status).toBe(429);

    // the same mailbox, now with the cookie that proves it: their own basket
    expect((await POST(cart(VICTIM, session(VICTIM)))).status).toBe(200);
    expect(await getCart(VICTIM)).toBeTruthy();
    // and the budget was not spent on them
    const [row] = await query<{ n: number | string }>("select n from cart_writes where email = $1", [VICTIM]);
    expect(Number(row.n)).toBe(CART_WRITES_PER_DAY + 2);
  });

  it("keeps the feature: a first-time guest who has never signed in is still filed", async () => {
    const { POST } = await import("@/app/api/carts/route");
    expect((await POST(cart("first-timer@example.com"))).status).toBe(200);
    expect(await getCart("first-timer@example.com")).toBeTruthy();
  });

  it("starts a new budget on the next Tallinn day, and forgets old ones", async () => {
    await allowGuestCartWrite(VICTIM, Date.now() - 40 * DAY);
    await allowGuestCartWrite(SHOPPER);
    expect(await query("select email from cart_writes")).toHaveLength(2);

    expect(await pruneCartWrites()).toBe(1);
    const left = await query<{ email: string; day: string }>("select email, day from cart_writes");
    expect(left.map((r) => r.email)).toEqual([SHOPPER]);
    expect(left[0].day).toBe(shopDay(Date.now()));
  });
});

/* ---------- 3. seven days, and the goods come back ------------------------ */

describe("3 · an unpaid order cancels itself after seven days", () => {
  beforeEach(async () => {
    await setFlows({ unpaid: true });
  });

  it("is seven days by default — nobody has to type the number", async () => {
    expect(FLOW_DEFAULTS.unpaidCancelDays).toBe(7);
    expect(await getFlows()).toMatchObject({ unpaid: true, unpaidCancelDays: 7 });
  });

  it("lets an eight-day-old order go and leaves a six-day-old one alone", async () => {
    const old = await placeOrder();
    const young = await placeOrder({ customer: { ...ORDER.customer, email: SHOPPER } });
    await age(old.id, 8);
    await age(young.id, 6);

    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(1);
    expect((await getOrder(old.id))!.status).toBe("cancelled");
    expect((await getOrder(young.id))!.status).toBe("new");
  });

  it("takes nothing off the shelf, because an unpaid order never took any", async () => {
    await move({ productId: PLAIN.id, delta: 5, reason: "goods_in", actor: "test" });
    const order = await placeOrder();
    await age(order.id, 9);

    const { getLevel } = await import("@/lib/inventory");
    const before = (await getLevel(PLAIN.id))!.qty;
    expect(await runUnpaidOrders()).toMatchObject({ cancelled: 1 });
    // the count is exactly where it was: nothing left, so nothing returned
    expect((await getLevel(PLAIN.id))!.qty).toBe(before);
    expect(before).toBe(5);
  });
});

/* ---------- 4. the backlog goes quietly ----------------------------------- */

describe("4 · turning the switch on does not post the backlog", () => {
  it("stamps the day the switch was flipped, on the Tallinn calendar", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const res = await PUT(put("/api/admin/settings/", { flows: { unpaid: true } }, admin));
    expect(res.status).toBe(200);
    expect(await getFlows()).toMatchObject({ unpaid: true, unpaidFrom: shopDay(Date.now()) });
  });

  it("releases every old unpaid order on the first run, and writes to nobody", async () => {
    const backlog = [];
    for (const days of [200, 120, 40, 9]) {
      const o = await placeOrder();
      await age(o.id, days);
      backlog.push(o);
    }

    const { PUT } = await import("@/app/api/admin/settings/route");
    await PUT(put("/api/admin/settings/", { flows: { unpaid: true } }, admin));

    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(4);
    expect(run.sent).toBe(0);
    expect(sent).toHaveLength(0);
    for (const o of backlog) expect((await getOrder(o.id))!.status).toBe("cancelled");
  });

  it("still tells the customer about an order that was alive when the switch was flipped", async () => {
    // the switch was turned on a month ago; this order is eight days old
    await setFlows({ unpaid: true, unpaidFrom: addShopDays(shopDay(Date.now()), -30) });
    const dead = await placeOrder();
    const recent = await placeOrder({ customer: { ...ORDER.customer, email: SHOPPER } });
    await age(dead.id, 200);
    await age(recent.id, 8);

    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(2);
    // one letter, and it is about the order that was still alive a month ago
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([SHOPPER]);
    expect(sent[0].subject).toContain(recent.number);
  });

  it("carries the stamp through every later save of the same form", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    await PUT(put("/api/admin/settings/", { flows: { unpaid: true } }, admin));
    const stamped = (await getFlows()).unpaidFrom;
    expect(stamped).toBeTruthy();

    // the panel posts the whole blob back and knows nothing about this field
    await PUT(put("/api/admin/settings/", { flows: { unpaid: true, unpaidRemindDays: 2, unpaidCancelDays: 9 } }, admin));
    expect(await getFlows()).toMatchObject({ unpaidFrom: stamped, unpaidRemindDays: 2, unpaidCancelDays: 9 });
  });

  it("refuses to let the floor be moved by whoever posts the blob", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    await PUT(put("/api/admin/settings/", { flows: { unpaid: true } }, admin));
    const stamped = (await getFlows()).unpaidFrom;

    await PUT(put("/api/admin/settings/", { flows: { unpaid: true, unpaidFrom: "2020-01-01" } }, admin));
    expect((await getFlows()).unpaidFrom).toBe(stamped);
  });

  it("forgets the floor when the switch goes off, and stamps a new one when it comes back", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    await setFlows({ unpaid: true, unpaidFrom: addShopDays(shopDay(Date.now()), -30) });

    await PUT(put("/api/admin/settings/", { flows: { unpaid: false } }, admin));
    expect((await getFlows()).unpaidFrom).toBe("");

    await PUT(put("/api/admin/settings/", { flows: { unpaid: true } }, admin));
    expect((await getFlows()).unpaidFrom).toBe(shopDay(Date.now()));
  });

  it("leaves a shop that has no floor exactly as it was — letters and all", async () => {
    // no stamp: a shop that already had the flow running before this existed
    await setFlows({ unpaid: true, unpaidRemindDays: 3, unpaidCancelDays: 7 });
    expect((await getFlows()).unpaidFrom).toBe("");
    const order = await placeOrder();
    await age(order.id, 200);

    expect(await runUnpaidOrders()).toMatchObject({ cancelled: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/отменён/i);
  });

  it("stamps nothing on a shop that already had the switch on", async () => {
    await setFlows({ unpaid: true });
    const { PUT } = await import("@/app/api/admin/settings/route");
    await PUT(put("/api/admin/settings/", { flows: { unpaid: true, unpaidCancelDays: 10 } }, admin));
    expect((await getFlows()).unpaidFrom).toBe("");
  });

  it("stampUnpaidFloor leaves anything that is not a settings object alone", async () => {
    for (const junk of [null, "flows", 42, [1, 2]]) {
      expect(await stampUnpaidFloor(junk)).toEqual(junk);
    }
  });
});

/* ---------- 5. «Снова в наличии» respects the count ----------------------- */

describe("5 · the back-in-stock letter does not contradict the counter", () => {
  beforeEach(async () => {
    await setFlows({ backstock: true });
  });

  async function waitFor(productId: string): Promise<void> {
    await addStockAlert({ email: SHOPPER, productId, lang: "RU" });
  }

  it("says nothing when the shelf has been counted to zero", async () => {
    await move({ productId: PLAIN.id, delta: 3, reason: "goods_in", actor: "test" });
    await move({ productId: PLAIN.id, delta: -3, reason: "sale_web", actor: "test" });
    await waitFor(PLAIN.id);

    // the owner writes «в наличии» on a shelf the scanner says is empty
    await upsertOverride(PLAIN.id, { stock: "in" });

    expect(sent).toHaveLength(0);
    // …and nobody's place in the queue was spent on a letter that never went
    const [alert] = await query<{ sent_at: string | null }>("select sent_at from stock_alerts where email = $1", [SHOPPER]);
    expect(alert.sent_at).toBeNull();
  });

  it("sends the day the shelf really has something on it", async () => {
    await move({ productId: PLAIN.id, delta: 3, reason: "goods_in", actor: "test" });
    await move({ productId: PLAIN.id, delta: -3, reason: "sale_web", actor: "test" });
    await waitFor(PLAIN.id);
    await upsertOverride(PLAIN.id, { stock: "in" });
    expect(sent).toHaveLength(0);

    await move({ productId: PLAIN.id, delta: 4, reason: "goods_in", actor: "test" });
    await upsertOverride(PLAIN.id, { stock: "in" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([SHOPPER]);
  });

  it("still sends for a product nobody has ever counted", async () => {
    await waitFor(OTHER_PLAIN.id);
    await upsertOverride(OTHER_PLAIN.id, { stock: "in" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([SHOPPER]);
  });

  it("sends when the count says «мало» — some is still some", async () => {
    await move({ productId: PLAIN.id, delta: 1, reason: "goods_in", actor: "test" });
    await waitFor(PLAIN.id);
    await upsertOverride(PLAIN.id, { stock: "in" });
    expect(sent).toHaveLength(1);
  });
});

/* ---------- 6. one welcome per partner ------------------------------------ */

describe("6 · the partner letter goes the first time only", () => {
  async function card(email: string) {
    return (await getCustomerAdminByEmail(email))!;
  }

  async function patch(id: string, body: unknown) {
    const route = await import("@/app/api/admin/customers/[id]/route");
    const res = await route.PATCH(
      new Request(`${ORIGIN}/api/admin/customers/${id}/`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: res.status, body: (await res.json()) as { ok: boolean; mail?: { sent: boolean } } };
  }

  it("welcomes a first-time partner", async () => {
    await recordLogin(SHOPPER, "RU");
    const out = await patch((await card(SHOPPER)).id, { action: "approve" });
    expect(out.body.mail).toMatchObject({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([SHOPPER]);
  });

  it("says nothing the second time, however the tier got back to retail", async () => {
    await recordLogin(SHOPPER, "RU");
    const id = (await card(SHOPPER)).id;
    await patch(id, { action: "approve" });
    expect(sent).toHaveLength(1);

    // the card's switch, back to retail and then to partner again
    await patch(id, { tier: "retail" });
    sent.length = 0;
    const again = await patch(id, { tier: "pro" });
    expect(again.body.ok).toBe(true);
    expect((await card(SHOPPER)).tier).toBe("pro");
    expect(sent).toHaveLength(0);
    /* No `mail` at all, on purpose: the panel reads a missing `mail` as «no
       letter was due» and says «Партнёр одобрен». A {sent:false} would have
       made it report a failure that did not happen. */
    expect(again.body.mail).toBeUndefined();
  });

  it("says nothing when «Одобрить Pro» comes round a second time", async () => {
    await recordLogin(SHOPPER, "RU");
    const id = (await card(SHOPPER)).id;
    await approveProCustomer(id);
    await setCustomerTier(id, "retail");
    sent.length = 0;

    const again = await patch(id, { action: "approve" });
    expect(again.body.ok).toBe(true);
    expect(sent).toHaveLength(0);
    expect(again.body.mail).toBeUndefined();
  });

  it("keeps the stamp that proves it — a demotion never clears it", async () => {
    await recordLogin(SHOPPER, "RU");
    const id = (await card(SHOPPER)).id;
    await approveProCustomer(id);
    expect((await card(SHOPPER)).proApprovedAt).toBeTruthy();
    await setCustomerTier(id, "retail");
    expect((await card(SHOPPER)).proApprovedAt).toBeTruthy();
  });

  it("holds on the «+ Партнёр» door too", async () => {
    const first = await upsertPartner({ email: SHOPPER, company: "OÜ Näidis", tier: "pro" });
    expect(first).toMatchObject({ promoted: true, welcomed: false });

    await setCustomerTier(first!.customer.id, "retail");
    const back = await upsertPartner({ email: SHOPPER, tier: "pro" });
    expect(back).toMatchObject({ promoted: true, welcomed: true });

    const route = await import("@/app/api/admin/customers/route");
    await setCustomerTier(first!.customer.id, "retail");
    sent.length = 0;
    const res = await route.POST(post("/api/admin/customers/", { email: SHOPPER, tier: "pro" }, admin));
    const body = (await res.json()) as { ok: boolean; promoted: boolean; mail: { sent: boolean } };
    expect(body).toMatchObject({ ok: true, promoted: true, mail: { sent: false } });
    expect(sent).toHaveLength(0);
  });

  it("still welcomes a brand-new partner added by e-mail", async () => {
    const route = await import("@/app/api/admin/customers/route");
    const res = await route.POST(post("/api/admin/customers/", { email: "salon@example.com", tier: "pro" }, admin));
    const body = (await res.json()) as { mail: { sent: boolean } };
    expect(body.mail.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["salon@example.com"]);
  });
});
