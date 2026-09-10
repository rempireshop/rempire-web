/**
 * Marketing consent and the way out of it — src/lib/consent.ts,
 * GET|POST /api/mail/unsubscribe/, db/migrations/052_marketing_consent.sql.
 *
 * What this file exists to catch: a page that says «отписаны» over a row
 * that still says yes; a cart reminder to somebody who pressed «Отписаться»;
 * a back-in-stock alert blocked by a tick it never depended on; a marketing
 * letter that leaves without the RFC 8058 headers; a token that lets one
 * mailbox unsubscribe another; a consent nobody can date.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import {
  isOptedOut,
  maskEmail,
  optOut,
  optedOutSet,
  readUnsubscribeParams,
  recordMarketingConsent,
  supportAddress,
  unsubscribeHeaders,
  unsubscribeToken,
  unsubscribeUrl,
  withdrawMarketingConsent,
} from "@/lib/consent";
import { addStockAlert, getCustomer, makeCustomerToken, recordLogin, saveCart, updateCustomer } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { flowCounters, runAbandonedCarts, runBackInStock, runBirthdays } from "@/lib/flows";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; s: string };
const IN_STOCK = (catalogueMin as Min[]).filter((p) => p.s === "in").map((p) => p.id);
/* A product that really exists in src/data/catalogue.min.json, and a second one. */
const PRODUCT = "system-4-bio-botanical-shampoo";
const PRODUCT_2 = IN_STOCK.find((id) => id !== PRODUCT)!;

const EMAIL = "shopper@example.com";
const OTHER = "other@example.com";
const HOUR = 60 * 60 * 1000;
const BASE = "https://test.rempireshop.com";
const IP = "203.0.113.7";

/** Every letter Resend was asked to send since the last reset — headers included. */
interface Sent {
  subject: string;
  to: string[];
  text: string;
  html: string;
  headers?: Record<string, string>;
}
const sent: Sent[] = [];

function mockResend() {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Sent;
    sent.push({ subject: body.subject, to: body.to, text: body.text ?? "", html: body.html ?? "", headers: body.headers });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

async function setFlows(patch: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('flows', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(patch)],
  );
}

/** A request the rate limiter can bucket, from one fixed address unless told otherwise. */
function req(url: string, init: RequestInit = {}, ip = IP): Request {
  return new Request(url, { ...init, headers: { "x-forwarded-for": ip, ...((init.headers as Record<string, string>) ?? {}) } });
}

function linkOf(url: string): { u: string | null; t: string | null } {
  const parsed = new URL(url);
  return { u: parsed.searchParams.get("u"), t: parsed.searchParams.get("t") };
}

async function customerRow(email: string) {
  const rows = await query<{
    marketing: boolean;
    marketing_at: string | Date | null;
    marketing_source: string | null;
    marketing_off_at: string | Date | null;
  }>("select marketing, marketing_at, marketing_source, marketing_off_at from customers where email = $1", [email]);
  return rows[0] ?? null;
}

async function optOutRow(email: string) {
  const rows = await query<{ email: string; kind: string; source: string; at: string | Date }>(
    "select email, kind, source, at from mail_optouts where email = $1",
    [email],
  );
  return rows[0] ?? null;
}

async function abandon(email: string, ageMs: number): Promise<void> {
  await saveCart({ email, lang: "RU", items: [{ id: PRODUCT, qty: 2 }] });
  await query("update carts set updated_at = $2 where email = $1", [email, new Date(Date.now() - ageMs).toISOString()]);
}

/** A customer whose birthday is today, with the tick as asked. */
async function birthdayToday(email: string, marketing: boolean): Promise<void> {
  const today = new Date();
  const iso = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  await recordLogin(email, "RU");
  await updateCustomer(email, { birthday: iso });
  if (marketing) await recordMarketingConsent(email, "RU", "account");
}

let admin = "";

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  // After setupDb: PGlite is up, so stubbing fetch cannot disturb it.
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
  mockResend();
  resetRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec(
    "truncate customers, login_codes, carts, stock_alerts, mail_optouts, orders, settings, product_overrides restart identity cascade",
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- the migration ------------------------------------------------- */

describe("052_marketing_consent.sql", () => {
  it("stamps the customers row and creates the stop list", async () => {
    const cols = await query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'customers'",
    );
    const names = cols.map((c) => c.column_name);
    for (const c of ["marketing", "marketing_at", "marketing_source", "marketing_off_at"]) expect(names).toContain(c);

    const optouts = await query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'mail_optouts'",
    );
    expect(optouts.map((c) => c.column_name).sort()).toEqual(["at", "email", "kind", "source"]);
  });
});

/* ---------- the token and the link ---------------------------------------- */

describe("the unsubscribe token", () => {
  it("is one HMAC per mailbox — the same from every letter, different for every address", () => {
    const token = unsubscribeToken(EMAIL);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(unsubscribeToken("  Shopper@Example.COM ")).toBe(token);
    expect(unsubscribeToken(OTHER)).not.toBe(token);
  });

  it("round-trips through the link's u and t", () => {
    const url = unsubscribeUrl(EMAIL, "et", "marketing");
    expect(url.startsWith(`${BASE}/api/mail/unsubscribe/?u=`)).toBe(true);
    expect(url).toContain("&t=");
    // the address is not in the open — base64url, not the bare mailbox
    expect(url).not.toContain("@");
    const { u, t } = linkOf(url);
    expect(readUnsubscribeParams(u, t)).toEqual({ ok: true, email: EMAIL, kind: "marketing", lang: "ET" });

    const back = linkOf(unsubscribeUrl("Shopper@Example.com", "EN", "backstock"));
    expect(readUnsubscribeParams(back.u, back.t)).toEqual({ ok: true, email: EMAIL, kind: "backstock", lang: "EN" });
  });

  it("refuses a forged, swapped or malformed token — and still reads the language for the refusal", () => {
    const { u, t } = linkOf(unsubscribeUrl(EMAIL, "ET", "marketing"));
    const bad: Array<[string | null, string | null]> = [
      [u, `${t!.slice(0, -1)}${t!.slice(-1) === "a" ? "b" : "a"}`], // one character off
      [u, unsubscribeToken(OTHER)], // somebody else's token
      [u, ""],
      [u, null],
      [null, t],
      ["", t],
      ["not-base64url!", t],
      [Buffer.from("not-an-address|marketing|ET").toString("base64url"), t],
      [Buffer.from(`${EMAIL}|newsletter|ET`).toString("base64url"), t], // a kind we never issue
      [u, `${t}.`],
    ];
    for (const [bu, bt] of bad) expect(readUnsubscribeParams(bu, bt).ok, `${bu} / ${bt}`).toBe(false);
    // the refusal is worded in the letter's language, not in Russian for everybody
    expect(readUnsubscribeParams(u, "wrong")).toEqual({ ok: false, lang: "ET" });
    expect(readUnsubscribeParams("junk", "junk")).toEqual({ ok: false, lang: "RU" });
  });

  it("carries the RFC 8058 headers a mail client's own button needs", () => {
    const h = unsubscribeHeaders(EMAIL, "RU", "marketing");
    const url = unsubscribeUrl(EMAIL, "RU", "marketing");
    expect(h["List-Unsubscribe"]).toBe(`<${url}>, <mailto:info@rempireshop.com?subject=unsubscribe>`);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("takes the mailto address from the reply-to policy, bare", () => {
    const saved = process.env.MAIL_REPLY_TO;
    try {
      delete process.env.MAIL_REPLY_TO;
      expect(supportAddress()).toBe("info@rempireshop.com");
      process.env.MAIL_REPLY_TO = "Rempire <hello@rempireshop.com>";
      expect(supportAddress()).toBe("hello@rempireshop.com");
      expect(unsubscribeHeaders(EMAIL, "RU", "marketing")["List-Unsubscribe"]).toContain("<mailto:hello@rempireshop.com?subject=unsubscribe>");
    } finally {
      if (saved === undefined) delete process.env.MAIL_REPLY_TO;
      else process.env.MAIL_REPLY_TO = saved;
    }
  });

  it("masks an address to something recognisable and nothing more", () => {
    expect(maskEmail("Renat@Example.com")).toBe("r***@example.com");
    expect(maskEmail("x@y.z")).toBe("x***@y.z");
    expect(maskEmail("junk")).toBe("***");
  });
});

/* ---------- the tick ------------------------------------------------------ */

describe("the consent stamps", () => {
  it("the checkout tick creates the row for a guest and stamps when and where", async () => {
    expect(await getCustomer(EMAIL)).toBeNull();
    expect(await recordMarketingConsent("Shopper@Example.COM", "ET", "checkout")).toBe(true);
    const row = await customerRow(EMAIL);
    expect(row?.marketing).toBe(true);
    expect(row?.marketing_at).toBeTruthy();
    expect(row?.marketing_source).toBe("checkout");
    expect(row?.marketing_off_at).toBeNull();
    expect((await getCustomer(EMAIL))?.lang).toBe("ET");
  });

  it("keeps the original stamp on a repeat, and re-dates only a real off → on", async () => {
    await recordMarketingConsent(EMAIL, "RU", "checkout");
    const first = await customerRow(EMAIL);
    await new Promise((r) => setTimeout(r, 15));
    await recordMarketingConsent(EMAIL, "RU", "account"); // saved the form again with the tick still on
    const again = await customerRow(EMAIL);
    expect(new Date(again!.marketing_at as string).getTime()).toBe(new Date(first!.marketing_at as string).getTime());
    expect(again?.marketing_source).toBe("checkout");

    expect(await withdrawMarketingConsent(EMAIL, "account")).toBe(true);
    const off = await customerRow(EMAIL);
    expect(off?.marketing).toBe(false);
    expect(off?.marketing_off_at).toBeTruthy();
    expect(off?.marketing_at).toEqual(first?.marketing_at); // the history of the yes is kept

    await new Promise((r) => setTimeout(r, 15));
    await withdrawMarketingConsent(EMAIL, "account"); // already off: the off-stamp does not move
    expect(new Date((await customerRow(EMAIL))!.marketing_off_at as string).getTime())
      .toBe(new Date(off!.marketing_off_at as string).getTime());

    await recordMarketingConsent(EMAIL, "RU", "account");
    const on = await customerRow(EMAIL);
    expect(on?.marketing).toBe(true);
    expect(on?.marketing_source).toBe("account");
    expect(new Date(on!.marketing_at as string).getTime()).toBeGreaterThan(new Date(first!.marketing_at as string).getTime());
  });

  it("says no rather than throwing on something that is not an address", async () => {
    expect(await recordMarketingConsent("", "RU", "checkout")).toBe(false);
    expect(await recordMarketingConsent("not-an-address", "RU", "checkout")).toBe(false);
    expect(await withdrawMarketingConsent("not-an-address", "account")).toBe(false);
    // withdrawing for an address with no row is a quiet no-op
    expect(await withdrawMarketingConsent("nobody@example.com", "account")).toBe(true);
    expect(await getCustomer("nobody@example.com")).toBeNull();
  });

  it("PATCH /api/account/me stamps «account» on the way on and off, and only on a real change", async () => {
    await recordLogin(EMAIL, "RU");
    const { PATCH } = await import("@/app/api/account/me/route");
    const cookie = `rmp_cust=${makeCustomerToken(EMAIL)}`;
    const patch = (body: Record<string, unknown>) =>
      PATCH(req(`${BASE}/api/account/me/`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));

    const on = await patch({ name: "Рената", marketing: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { customer: { marketing: boolean; name: string } }).customer).toMatchObject({ marketing: true, name: "Рената" });
    const stamped = await customerRow(EMAIL);
    expect(stamped?.marketing_source).toBe("account");
    expect(stamped?.marketing_at).toBeTruthy();

    await new Promise((r) => setTimeout(r, 15));
    // the form re-sends the tick on every save — a phone change must not re-date the consent
    await patch({ phone: "+372 5555 5555", marketing: true });
    expect(new Date((await customerRow(EMAIL))!.marketing_at as string).getTime())
      .toBe(new Date(stamped!.marketing_at as string).getTime());

    const off = await patch({ marketing: false });
    expect(((await off.json()) as { customer: { marketing: boolean } }).customer.marketing).toBe(false);
    const row = await customerRow(EMAIL);
    expect(row?.marketing).toBe(false);
    expect(row?.marketing_off_at).toBeTruthy();
  });

  it("POST /api/orders with newsletter:true stamps «checkout»", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(
      req(`${BASE}/api/orders/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lang: "RU",
          items: [{ id: PRODUCT, qty: 1 }],
          customer: { name: "Test Ostja", email: "Buyer@Example.com", phone: "+372 5555 5555" },
          shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
          newsletter: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const row = await customerRow("buyer@example.com");
    expect(row?.marketing).toBe(true);
    expect(row?.marketing_source).toBe("checkout");
    expect(row?.marketing_at).toBeTruthy();
  });
});

/* ---------- «Отписаться» — the route -------------------------------------- */

describe("GET|POST /api/mail/unsubscribe/", () => {
  async function route() {
    return import("@/app/api/mail/unsubscribe/route");
  }

  it("a valid link takes the address off, turns the tick off, and says so without printing the address", async () => {
    await recordLogin(EMAIL, "RU");
    await recordMarketingConsent(EMAIL, "RU", "checkout");
    const { GET } = await route();
    const res = await GET(req(unsubscribeUrl(EMAIL, "RU", "marketing")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Вы отписаны");
    expect(html).toContain("Письма о заказах будут приходить как прежде.");
    expect(html).toContain("s***@example.com");
    expect(html).not.toContain(EMAIL);
    expect(html).toContain(`href="${BASE}/shop2/"`);
    // self-contained: nothing is loaded from anywhere
    expect(html).not.toMatch(/<script|<link|<img|@import|url\(/i);

    const row = await customerRow(EMAIL);
    expect(row?.marketing).toBe(false);
    expect(row?.marketing_off_at).toBeTruthy();
    expect(await optOutRow(EMAIL)).toMatchObject({ email: EMAIL, kind: "marketing", source: "link" });
    expect(await isOptedOut(EMAIL)).toBe(true);
    expect(await isOptedOut(OTHER)).toBe(false);
  });

  it("answers in the letter's language, and for a guest with no account", async () => {
    const { GET } = await route();
    const et = await GET(req(unsubscribeUrl(OTHER, "ET", "marketing")));
    expect(et.status).toBe(200);
    const html = await et.text();
    expect(html).toContain("Olete loobunud");
    expect(html).toContain(`href="${BASE}/shop2/et/"`);
    expect(html).toContain('lang="et"');
    // no customers row was invented for the guest — only the stop-list row
    expect(await getCustomer(OTHER)).toBeNull();
    expect(await optOutRow(OTHER)).toMatchObject({ kind: "marketing", source: "link" });

    const en = await GET(req(unsubscribeUrl(OTHER, "EN", "marketing")));
    expect(await en.text()).toContain("You are unsubscribed");
  });

  it("the one-click POST does the same in plain text, and both are idempotent", async () => {
    await recordLogin(EMAIL, "RU");
    await recordMarketingConsent(EMAIL, "RU", "checkout");
    const { GET, POST } = await route();
    const url = unsubscribeUrl(EMAIL, "RU", "marketing");
    const post = () =>
      POST(req(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));

    const first = await post();
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/plain");
    expect(await first.text()).toBe("ok");
    expect(await optOutRow(EMAIL)).toMatchObject({ kind: "marketing", source: "one-click" });
    expect((await customerRow(EMAIL))?.marketing).toBe(false);

    expect((await post()).status).toBe(200);
    expect((await GET(req(url))).status).toBe(200);
    expect(await query("select 1 from mail_optouts")).toHaveLength(1);
  });

  it("a wrong or missing token gets a 400 that says nothing but «ссылка не работает»", async () => {
    await recordLogin(EMAIL, "RU");
    await recordMarketingConsent(EMAIL, "RU", "checkout");
    const { GET, POST } = await route();
    const { u } = linkOf(unsubscribeUrl(EMAIL, "RU", "marketing"));

    const forged = await GET(req(`${BASE}/api/mail/unsubscribe/?u=${u}&t=${unsubscribeToken(OTHER)}`));
    expect(forged.status).toBe(400);
    const html = await forged.text();
    expect(html).toContain("Ссылка не работает");
    expect(html).toContain("Напишите нам:");
    expect(html).toContain("info@rempireshop.com");
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain("s***@");

    for (const q of ["", "?u=&t=", "?u=junk&t=junk", `?u=${u}`, `?t=${unsubscribeToken(EMAIL)}`]) {
      expect((await GET(req(`${BASE}/api/mail/unsubscribe/${q}`))).status, q).toBe(400);
    }
    const post = await POST(req(`${BASE}/api/mail/unsubscribe/?u=${u}&t=forged`, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(post.status).toBe(400);
    expect(await post.text()).toBe("bad_token");

    // nothing was written
    expect((await customerRow(EMAIL))?.marketing).toBe(true);
    expect(await optOutRow(EMAIL)).toBeNull();
  });

  it("the back-in-stock link cancels that address's pending alerts — and only those", async () => {
    await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "RU" });
    await addStockAlert({ email: EMAIL, productId: PRODUCT_2, lang: "RU" });
    await addStockAlert({ email: OTHER, productId: PRODUCT, lang: "RU" });
    // one of theirs already went out — history, not a subscription
    await query("update stock_alerts set sent_at = now() where email = $1 and product_id = $2", [EMAIL, PRODUCT_2]);
    await recordLogin(EMAIL, "RU");
    await recordMarketingConsent(EMAIL, "RU", "account");

    const { GET } = await route();
    const res = await GET(req(unsubscribeUrl(EMAIL, "RU", "backstock")));
    expect(res.status).toBe(200);

    const left = await query<{ email: string; product_id: string; sent_at: string | null }>(
      "select email, product_id, sent_at from stock_alerts order by email, product_id",
    );
    expect(left.map((r) => [r.email, r.product_id, r.sent_at !== null])).toEqual([
      [OTHER, PRODUCT, false],
      [EMAIL, PRODUCT_2, true],
    ]);
    expect(await optOutRow(EMAIL)).toMatchObject({ kind: "backstock", source: "link" });
    // the stop list is one list: no cart reminder or birthday letter either
    expect((await customerRow(EMAIL))?.marketing).toBe(false);
  });

  it("rate-limits an address that grinds through it", async () => {
    const { GET } = await route();
    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) last = await GET(req(`${BASE}/api/mail/unsubscribe/?u=junk&t=junk`, {}, "198.51.100.9"));
    expect(last!.status).toBe(429);
    // another address is not caught in it
    expect((await GET(req(`${BASE}/api/mail/unsubscribe/?u=junk&t=junk`, {}, "198.51.100.10"))).status).toBe(400);
  });
});

/* ---------- who gets a letter --------------------------------------------- */

describe("the stop list and the three letters", () => {
  it("the cart reminder skips an address that pressed «Отписаться», and carries the link and the headers", async () => {
    await setFlows({ abandoned: true });
    await abandon(EMAIL, 4 * HOUR);
    await abandon(OTHER, 4 * HOUR);
    await optOut(EMAIL, "marketing", "link");

    const run = await runAbandonedCarts();
    expect(run).toEqual({ sent: 1, skipped: 1, reason: "opted_out" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([OTHER]);

    // the refused cart is stamped like a sent one: never re-selected, never re-counted
    const carts = await query<{ email: string; reminded_at: string | null }>("select email, reminded_at from carts order by email");
    expect(carts.every((c) => c.reminded_at !== null)).toBe(true);
    expect(await runAbandonedCarts()).toEqual({ sent: 0, skipped: 0, reason: undefined });

    // the letter that did go out: the footer link and the one-click headers, both for this mailbox
    const url = unsubscribeUrl(OTHER, "RU", "marketing");
    expect(sent[0].text).toContain(url);
    expect(sent[0].html).toContain(`href="${url.replace(/&/g, "&amp;")}"`);
    expect(sent[0].text).not.toContain("/shop2/account/");
    expect(sent[0].headers).toEqual(unsubscribeHeaders(OTHER, "RU", "marketing"));
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("the birthday letter skips the stop list even when the tick says yes, and carries the headers", async () => {
    await setFlows({ birthday: true, birthdayCode: "REM-BD-STATIC" });
    await birthdayToday(EMAIL, true);
    await birthdayToday(OTHER, true);
    // a row written after the click — the tick was put back by hand, the stop list still stands
    await query("insert into mail_optouts (email, kind) values ($1, 'marketing')", [EMAIL]);

    const run = await runBirthdays();
    expect(run).toMatchObject({ sent: 1, skipped: 1, reason: "opted_out" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([OTHER]);
    expect(sent[0].text).toContain(unsubscribeUrl(OTHER, "RU", "marketing"));
    expect(sent[0].headers).toEqual(unsubscribeHeaders(OTHER, "RU", "marketing"));
    expect(sent[0].headers?.["List-Unsubscribe"]).toContain(`<${BASE}/api/mail/unsubscribe/?u=`);
  });

  it("the back-in-stock alert still goes to somebody on the stop list — they asked for it by name", async () => {
    await setFlows({ backstock: true });
    await addStockAlert({ email: EMAIL, productId: PRODUCT, lang: "EN" });
    await optOut(EMAIL, "marketing", "link");

    expect((await runBackInStock(PRODUCT)).sent).toBe(1);
    expect(sent[0].to).toEqual([EMAIL]);
    const url = unsubscribeUrl(EMAIL, "EN", "backstock");
    expect(sent[0].text).toContain(url);
    expect(sent[0].headers).toEqual(unsubscribeHeaders(EMAIL, "EN", "backstock"));
    // its own link is the back-in-stock kind, not the marketing one
    const { u, t } = linkOf(url);
    expect(readUnsubscribeParams(u, t)).toMatchObject({ ok: true, kind: "backstock", lang: "EN" });
  });

  it("the panel's queues do not promise a letter the run will refuse", async () => {
    await abandon(EMAIL, 5 * HOUR);
    await birthdayToday(EMAIL, true);
    expect(await flowCounters()).toMatchObject({ carts: 1, birthdays: 1 });
    await optOut(EMAIL, "marketing", "link");
    expect(await flowCounters()).toMatchObject({ carts: 0, birthdays: 0 });
  });

  it("a fresh tick puts the address back — the latest expression of will wins", async () => {
    await recordLogin(EMAIL, "RU");
    await optOut(EMAIL, "marketing", "one-click");
    expect(await isOptedOut(EMAIL)).toBe(true);
    expect((await customerRow(EMAIL))?.marketing).toBe(false);

    await recordMarketingConsent(EMAIL, "RU", "checkout");
    expect(await isOptedOut(EMAIL)).toBe(false);
    const row = await customerRow(EMAIL);
    expect(row?.marketing).toBe(true);
    expect(row?.marketing_source).toBe("checkout");

    // and the link takes it out again, a second click only moving the date
    await optOut(EMAIL, "marketing", "link");
    await optOut(EMAIL, "backstock", "link");
    expect(await query("select 1 from mail_optouts")).toHaveLength(1);
    expect(await optOutRow(EMAIL)).toMatchObject({ kind: "backstock" });
  });

  it("answers a whole batch in one go", async () => {
    await optOut(EMAIL, "marketing", "link");
    const set = await optedOutSet([EMAIL, OTHER, "Shopper@Example.COM", ""]);
    expect([...set]).toEqual([EMAIL]);
    expect(await optedOutSet([])).toEqual(new Set());
  });
});

/* ---------- «Клиенты»: the admin API and the CSV -------------------------- */

describe("the admin customers API", () => {
  it("exposes the stamps and the stop-list flag, in the list, on the card and in the CSV", async () => {
    await recordLogin(EMAIL, "RU");
    await recordMarketingConsent(EMAIL, "RU", "checkout");
    await recordLogin(OTHER, "ET");

    const list = await import("@/app/api/admin/customers/route");
    const card = await import("@/app/api/admin/customers/[id]/route");

    type Row = { id: string; email: string; marketing: boolean; marketingAt: string | null; marketingSource: string | null; marketingOffAt: string | null; optedOut: boolean };
    const before = (await (await list.GET(req(`${BASE}/api/admin/customers/`, { headers: { cookie: admin } }))).json()) as { customers: Row[] };
    const yes = before.customers.find((c) => c.email === EMAIL)!;
    const no = before.customers.find((c) => c.email === OTHER)!;
    expect(yes).toMatchObject({ marketing: true, marketingSource: "checkout", marketingOffAt: null, optedOut: false });
    expect(yes.marketingAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(no).toMatchObject({ marketing: false, marketingAt: null, marketingSource: null, marketingOffAt: null, optedOut: false });

    await optOut(EMAIL, "marketing", "one-click");
    const one = (await (await card.GET(req(`${BASE}/api/admin/customers/${yes.id}/`, { headers: { cookie: admin } }), { params: Promise.resolve({ id: yes.id }) })).json()) as { customer: Row };
    expect(one.customer).toMatchObject({ marketing: false, marketingSource: "checkout", optedOut: true });
    expect(one.customer.marketingAt).toBe(yes.marketingAt);
    expect(one.customer.marketingOffAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const csv = await list.GET(req(`${BASE}/api/admin/customers/?format=csv`, { headers: { cookie: admin } }));
    const text = await csv.text();
    const [head, ...lines] = text.trim().split(/\r\n/);
    expect(head).toContain("tier,marketing,marketing_at,marketing_source,company");
    const line = lines.find((l) => l.startsWith(EMAIL))!;
    const cells = line.split(",");
    const at = head.split(",").indexOf("marketing_at");
    expect(cells[at]).toBe(yes.marketingAt);
    expect(cells[at + 1]).toBe("checkout");
    // the "no" row has the columns, blank
    const other = lines.find((l) => l.startsWith(OTHER))!.split(",");
    expect(other[at]).toBe("");
    expect(other[at + 1]).toBe("");
  });
});
