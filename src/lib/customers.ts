/**
 * Customer accounts — passwordless, e-mail only.
 *
 * There is no password and no customer table full of secrets: a shopper types
 * an address, gets a six-digit code, and the code is traded for a signed
 * cookie. The code lives fifteen minutes, is stored as an HMAC (a stolen
 * database dump is not a set of logins), and dies after five wrong guesses.
 *
 * The cookie is `rmp_cust` = `v1.<expiry-ms>.<base64url(email)>.<hmac>`, signed
 * with SESSION_SECRET like the admin cookie in src/lib/auth.ts — but under its
 * own domain prefix, so an admin token can never be replayed as a customer one
 * and the other way round. It is httpOnly, SameSite=Lax, Secure everywhere
 * except plain-http localhost, and lasts 90 days.
 *
 * Nothing in here is allowed to be a hard dependency of the shop: the
 * storefront works signed out, and every route that uses this file answers
 * `{ok:false}` rather than throwing when the database is missing.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { jsonbParam, query } from "@/lib/db";
// The cart-write counter below is a per-DAY counter, and a day in this shop is
// the Tallinn calendar day — never the database's zone and never the machine's
// (src/lib/day.ts carries the whole reasoning). day.ts imports nothing, so
// this keeps the module the leaf it has always been.
import { addShopDays, shopDay } from "@/lib/day";
// «Хочу вернуть заказ» — the window and the stamps, in one place for the
// account screen and the route alike. src/lib/returns.ts imports nothing but
// the database, which is what keeps this module the leaf it has always been.
import { canRequestReturn, returnRequestedAt } from "@/lib/returns";

export const CUSTOMER_COOKIE = "rmp_cust";
export const CUSTOMER_SESSION_DAYS = 90;
const SESSION_MS = CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;

/** How long a login code is good for, and how many guesses it survives. */
export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const LANGS = ["RU", "ET", "EN"] as const;
export type LangCode = (typeof LANGS)[number];

/* ---------- small shared bits -------------------------------------------- */

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : null;
}

function hmac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Lower-cased, trimmed, capped. Everything in this module keys on the result. */
export function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().slice(0, 160);
}

export function isEmail(v: unknown): boolean {
  const s = normalizeEmail(v);
  return s.length >= 5 && EMAIL_RE.test(s);
}

/** "ru", "et-EE", "EN" → "RU" | "ET" | "EN". Russian is the fallback. */
export function normalizeLangCode(v: unknown): LangCode {
  const s = String(v ?? "").trim().slice(0, 5).toUpperCase();
  for (const l of LANGS) if (s.startsWith(l)) return l;
  return "RU";
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s || null;
}

/** `YYYY-MM-DD` or nothing. A birthday nobody can parse is not stored. */
export function normalizeBirthday(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject 31 February and friends rather than storing a date Postgres refuses.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * «Доставка по умолчанию» — the account's standing delivery choice, in the
 * checkout's own words (db/migrations/051_customer_ship_pref.sql). Until
 * 10.09.2026 it lived in the shopper's browser only, so it never followed
 * the owner from his phone to his laptop and he could not tell whether it
 * had been kept at all.
 *
 * `carrier` and `machine` mean something only for a parcel; for the other two
 * they are stored empty so the checkout never inherits a machine from a
 * choice that no longer involves one. The machine is a NAME, not a carrier
 * id: the list is the carrier's live one and ids change under it, while «the
 * machine round the corner» is what the shopper actually chose (app.js
 * matchAcctPoint matches by name).
 *
 * `address` is the courier's, and only the courier's (Dim, 23.09.2026: «the
 * user who always uses courier should still have the option to set a
 * default/standard address»). It is the checkout's own three fields, in the
 * order's own words (`shipping.address` — {addr, zip, city}), cleaned the way
 * createOrder() cleans them (shipText in src/lib/orders.ts: control
 * characters out, spaces folded, 160 characters), and kept only whole: the
 * checkout will not take a courier order short of any of the three, so half
 * an address is not something to fill in. Absent — not empty — otherwise, so
 * every preference stored before it reads exactly as it did.
 */
export interface ShipAddress {
  /** Street and house (and flat) — the checkout's «Адрес». */
  addr: string;
  zip: string;
  city: string;
}
export interface ShipPref {
  /** The storefront's zone code — EE, LV, LT, FI, or EU for «другая страна». */
  country: string;
  method: "pickup" | "parcel" | "courier";
  carrier: string;
  machine: string;
  address?: ShipAddress;
}

const SHIP_METHODS: ReadonlyArray<ShipPref["method"]> = ["pickup", "parcel", "courier"];

/** A courier address the checkout would take — all three fields — or null. */
export function normalizeShipAddress(v: unknown): ShipAddress | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const addr = text(o.addr, 160);
  const zip = text(o.zip, 160);
  const city = text(o.city, 160);
  return addr && zip && city ? { addr, zip, city } : null;
}

/** A well-formed preference or null — a shape the checkout cannot act on is not stored. */
export function normalizeShipPref(v: unknown): ShipPref | null {
  // pg hands jsonb back parsed; a driver that hands back text is still honoured
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const method = String(o.method ?? "").trim().toLowerCase() as ShipPref["method"];
  if (!SHIP_METHODS.includes(method)) return null;
  const country = String(o.country ?? "").trim().toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const parcel = method === "parcel";
  const carrier = parcel ? String(o.carrier ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  const machine = parcel ? text(o.machine, 120) ?? "" : "";
  const pref: ShipPref = { country, method, carrier, machine };
  const address = method === "courier" ? normalizeShipAddress(o.address) : null;
  if (address) pref.address = address;
  return pref;
}

/* ---------- the session cookie ------------------------------------------- */

function payloadOf(email: string, expiry: number): string {
  return `cust.v1.${expiry}.${Buffer.from(email, "utf8").toString("base64url")}`;
}

/** `v1.<expiry>.<email>.<signature>` — the value that goes into the cookie. */
export function makeCustomerToken(email: string, now: number = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set (needs at least 16 characters) — see docs/backend.md");
  const addr = normalizeEmail(email);
  const expiry = now + SESSION_MS;
  const b64 = Buffer.from(addr, "utf8").toString("base64url");
  return `v1.${expiry}.${b64}.${hmac(payloadOf(addr, expiry), key)}`;
}

/** The e-mail a valid, unexpired token carries, or null. Never throws. */
export function readCustomerToken(token: string | null | undefined, now: number = Date.now()): string | null {
  const key = secret();
  if (!key || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const expiry = Number(parts[1]);
  if (!Number.isFinite(expiry) || expiry <= now) return null;
  let email: string;
  try {
    email = Buffer.from(parts[2], "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!isEmail(email)) return null;
  const want = Buffer.from(hmac(payloadOf(normalizeEmail(email), expiry), key));
  const got = Buffer.from(parts[3]);
  if (want.length !== got.length) return null;
  return timingSafeEqual(want, got) ? normalizeEmail(email) : null;
}

/** Reads one cookie off a Request. A value that will not decode is no cookie. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/* A Secure cookie is dropped by the browser over plain http, which would make
   local development impossible; everywhere else it is on. Same rule as
   src/lib/auth.ts — duplicated rather than imported because auth.ts belongs to
   backend-core and this file must not edit it. */
function isLocal(req: Request): boolean {
  try {
    const u = new URL(req.url);
    return u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  } catch {
    return false;
  }
}

function cookie(req: Request, value: string, maxAge: number): string {
  const bits = [`${CUSTOMER_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (!isLocal(req)) bits.push("Secure");
  return bits.join("; ");
}

export function customerCookie(req: Request, token: string): string {
  return cookie(req, token, CUSTOMER_SESSION_DAYS * 24 * 60 * 60);
}

export function clearCustomerCookie(req: Request): string {
  return cookie(req, "", 0);
}

/** The signed-in shopper's e-mail, or null. The only guard the account routes need. */
export function sessionEmail(req: Request): string | null {
  return readCustomerToken(readCookie(req, CUSTOMER_COOKIE));
}

/* ---------- login codes --------------------------------------------------- */

/** Six digits, uniformly random — `randomInt`, not `Math.random`. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The code is never stored: this is. Falls back to a fixed key without env. */
export function hashCode(email: string, code: string): string {
  return hmac(`${normalizeEmail(email)}:${String(code).trim()}`, secret() ?? "rempire-login-code");
}

export interface LoginCodeRow {
  email: string;
  code_hash: string;
  expires_at: string | Date;
  attempts: number | string;
}

/**
 * Issues a code for an address, replacing whatever was in flight. Returns the
 * plain code — the caller mails it and forgets it.
 */
export async function issueLoginCode(email: string, now: number = Date.now()): Promise<{ code: string; expiresAt: Date }> {
  const addr = normalizeEmail(email);
  const code = generateCode();
  const expiresAt = new Date(now + CODE_TTL_MS);
  await query(
    `insert into login_codes (email, code_hash, expires_at, attempts, created_at)
     values ($1, $2, $3, 0, now())
     on conflict (email) do update set code_hash = $2, expires_at = $3, attempts = 0, created_at = now()`,
    [addr, hashCode(addr, code), expiresAt.toISOString()],
  );
  return { code, expiresAt };
}

export type LoginCheck = "ok" | "no_code" | "expired" | "too_many" | "bad_code";

/**
 * Trades a code for a verdict. A correct code is consumed (the row is deleted),
 * a wrong one costs an attempt, and five wrong ones kill the code entirely —
 * a million guesses at six digits is otherwise a weekend's work.
 */
export async function checkLoginCode(email: string, code: string, now: number = Date.now()): Promise<LoginCheck> {
  const addr = normalizeEmail(email);
  const typed = String(code ?? "").replace(/\D/g, "").slice(0, 6);
  const rows = await query<LoginCodeRow>("select * from login_codes where email = $1", [addr]);
  if (!rows.length) return "no_code";
  const row = rows[0];
  if (new Date(row.expires_at as string).getTime() <= now) {
    await query("delete from login_codes where email = $1", [addr]);
    return "expired";
  }
  if (Number(row.attempts) >= CODE_MAX_ATTEMPTS) {
    await query("delete from login_codes where email = $1", [addr]);
    return "too_many";
  }
  if (typed.length !== 6) {
    await query("update login_codes set attempts = attempts + 1 where email = $1", [addr]);
    return "bad_code";
  }
  const want = Buffer.from(row.code_hash);
  const got = Buffer.from(hashCode(addr, typed));
  const ok = want.length === got.length && timingSafeEqual(want, got);
  if (!ok) {
    await query("update login_codes set attempts = attempts + 1 where email = $1", [addr]);
    return "bad_code";
  }
  await query("delete from login_codes where email = $1", [addr]);
  return "ok";
}

/* ---------- customers ----------------------------------------------------- */

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone: string;
  lang: LangCode;
  /** `YYYY-MM-DD` or null. */
  birthday: string | null;
  marketing: boolean;
  /** «Доставка по умолчанию», or null when the shopper never set one. */
  shipPref: ShipPref | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  /* ---- wholesale (salon/pro) — db/migrations/100_tiers_loyalty.sql ------- */
  /** 'retail' | 'pro'. Flips to 'pro' only when the owner approves the request. */
  tier: "retail" | "pro";
  company: string | null;
  regCode: string | null;
  /** Set the moment «Стать партнёром» is submitted; null once decided either way. */
  proRequestedAt: string | null;
  proApprovedAt: string | null;
}

type CustomerRow = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  lang: string | null;
  birthday: string | Date | null;
  marketing: boolean | string | null;
  ship_pref: unknown;
  created_at: string | Date | null;
  last_login_at: string | Date | null;
  tier: string | null;
  company: string | null;
  reg_code: string | null;
  pro_requested_at: string | Date | null;
  pro_approved_at: string | Date | null;
};

function isoDay(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapCustomer(r: CustomerRow): Customer {
  return {
    id: String(r.id),
    email: r.email,
    name: r.name ?? "",
    phone: r.phone ?? "",
    lang: normalizeLangCode(r.lang),
    birthday: isoDay(r.birthday),
    marketing: r.marketing === true || r.marketing === "t" || r.marketing === "true",
    shipPref: normalizeShipPref(r.ship_pref),
    createdAt: iso(r.created_at),
    lastLoginAt: iso(r.last_login_at),
    tier: r.tier === "pro" ? "pro" : "retail",
    company: r.company ?? null,
    regCode: r.reg_code ?? null,
    proRequestedAt: iso(r.pro_requested_at),
    proApprovedAt: iso(r.pro_approved_at),
  };
}

export async function getCustomer(email: string): Promise<Customer | null> {
  const rows = await query<CustomerRow>("select * from customers where email = $1", [normalizeEmail(email)]);
  return rows.length ? mapCustomer(rows[0]) : null;
}

/**
 * Called when a code is accepted: the row is created on the first ever login,
 * and `last_login_at` moves every time. The language follows the shop the
 * shopper signed in from, so their letters arrive in it.
 */
export async function recordLogin(email: string, lang?: unknown): Promise<Customer> {
  const addr = normalizeEmail(email);
  const l = normalizeLangCode(lang);
  const rows = await query<CustomerRow>(
    `insert into customers (email, lang, last_login_at) values ($1, $2, now())
     on conflict (email) do update set last_login_at = now(), lang = $2
     returning *`,
    [addr, l],
  );
  return mapCustomer(rows[0]);
}

/* «Хочу получать скидки и поздравление ко дню рождения» — `customers.marketing`
   — is written by one module only, src/lib/consent.ts: recordMarketingConsent()
   from the checkout and the account form, withdrawMarketingConsent() from the
   form, optOut() from the letter's own link. The stamps beside it
   (marketing_at / marketing_source / marketing_off_at, 052_marketing_consent.sql)
   are what make the tick answerable — «когда и где» — and a second writer
   here would be a second place to forget them. This file only reads it. */

export interface CustomerPatch {
  name?: unknown;
  phone?: unknown;
  birthday?: unknown;
  lang?: unknown;
  /** «Доставка по умолчанию» — a ShipPref-shaped object, or null to clear it. */
  shipPref?: unknown;
}

/** Only the keys present are touched; `null`/`""` clears one. The consent tick is not one of them — see above. */
export async function updateCustomer(email: string, patch: CustomerPatch): Promise<Customer | null> {
  const addr = normalizeEmail(email);
  const cols: Record<string, unknown> = {};
  if ("name" in patch) cols.name = text(patch.name, 120);
  if ("phone" in patch) cols.phone = text(patch.phone, 40);
  if ("birthday" in patch) cols.birthday = normalizeBirthday(patch.birthday);
  if ("lang" in patch) cols.lang = normalizeLangCode(patch.lang);
  // a shape the checkout cannot act on clears the column rather than sitting in it
  if ("shipPref" in patch) {
    const pref = normalizeShipPref(patch.shipPref);
    cols.ship_pref = pref ? jsonbParam(pref) : null;
  }

  const keys = Object.keys(cols);
  if (!keys.length) return getCustomer(addr);
  // the jsonb column needs the cast — a text parameter is not a jsonb one to Postgres
  const sets = keys.map((k, i) => `${k} = $${i + 2}${k === "ship_pref" ? "::jsonb" : ""}`).join(", ");
  const rows = await query<CustomerRow>(
    `update customers set ${sets} where email = $1 returning *`,
    [addr, ...keys.map((k) => cols[k])],
  );
  return rows.length ? mapCustomer(rows[0]) : null;
}

export interface CustomerOrder {
  number: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string | null;
  items: Array<{ title: string; variant: string | null; qty: number }>;
  tracking: string | null;
  trackingUrl: string | null;
  /* A refund's two halves, because the shop's own screen has to tell them
     apart. Montonio answers `200 PENDING` to a refund it has merely accepted
     and confirms on a webhook up to ten days later, so between the two the
     order is still `paid` and its status says nothing has happened — while
     the «Возврат отправлен» letter is already with the customer. `refunded`
     is what the bank has confirmed, `refundPending` what is on its way. */
  refunded: number;
  refundPending: number;
  /* The printable gift cards this order bought, if any — code plus the signed
     link to /api/giftcards/<code>/pdf/. Until 07.09.2026 that link existed
     only on the receipt screen, so closing the tab left the buyer with the
     code in an e-mail and no card to print. Dim: «If possible also add it for
     download through the account page.» The token is the same HMAC the
     receipt and the letter carry, and it is only ever handed to a request
     that already proved it owns this mailbox (the signed rmp_cust cookie in
     /api/account/me), so nothing new is exposed.
     `held` rides along only while a refund of this order is pending at
     Montonio: the checkout refuses the card until the refund is confirmed
     (the card is then gone from this list) or cancelled (it works again,
     whole) — src/lib/giftcards.ts giftHoldsByOrder. */
  giftCards: Array<{ code: string; amount: number; pdfUrl: string; held?: true }>;
  /* The invoice of an order paid «По счёту — для компаний» — its number and
     the link to /api/account/orders/<number>/invoice/, the same PDF the
     «Счёт на оплату» letter attached. Null on every other order. Since
     10.09.2026 (owner: «I see my orders and statuses, but not the invoices
     that were sent by e-mail — I should be able to download them from my
     account»). No token in this link, unlike the card's: that route reads the
     same signed cookie /api/account/me does and matches the order's address
     against it, so the link is only ever good to the account it was drawn on. */
  invoice: { number: string; pdfUrl: string } | null;
  /* «Хочу вернуть заказ» (src/lib/returns.ts): whether the screen may offer
     the tick on this order, and — once it has been ticked — when. The window
     is decided here and never in the browser: the same three questions the
     route asks again before it writes anything. */
  returnable: boolean;
  returnRequestedAt: string | null;
}

/**
 * The account screen's «Мои заказы»: the last 20 orders that carry this
 * address. Orders are matched by e-mail, not by customer id — a guest checkout
 * placed before the account existed still belongs to the person who owns the
 * mailbox.
 */
export async function listCustomerOrders(email: string, limit = 20): Promise<CustomerOrder[]> {
  const addr = normalizeEmail(email);
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  /* Both at once, and the cards asked for by the ADDRESS rather than by the
     ids the orders query is about to return. Renat, 13.09.2026: «the loading
     of the user data when you go to checkout» — the checkout waits on
     /api/account/me, and this pair used to be two waits: the orders, and then
     the cards those orders issued. On an in-memory database that is a
     millisecond; on the shop's real Postgres, in another data centre, it is a
     whole extra network hop in the one request a signed-in shopper's empty
     fields are waiting for. The sub-select is the same `where`/`order by`/
     `limit` as the query beside it, so the two cannot disagree about which
     twenty orders they are talking about. */
  const [rows, cardsByOrder] = await Promise.all([
    query<{
      id: string;
      number: string;
      status: string;
      total: string | number;
      currency: string | null;
      created_at: string | Date;
      updated_at: string | Date;
      items: unknown;
      payment: unknown;
      shipping: unknown;
      invoice: unknown;
    }>(
      `select id, number, status, total, currency, created_at, updated_at, items, payment, shipping, invoice
         from orders where lower(email) = $1 order by created_at desc limit $2`,
      [addr, n],
    ),
    giftCardsForEmail(addr, n),
  ]);

  /* invoiceOf() is the one reader of the invoice record, and it lives in
     src/lib/invoices.ts with the payments and mail modules behind it. Loaded
     only when one of these orders carries an invoice at all, so a shopper who
     never paid «По счёту» — nearly everyone — costs the sign-in routes none of
     that graph. */
  const invoiceOf = rows.some((r) => r.invoice != null) ? (await import("@/lib/invoices")).invoiceOf : null;

  /* A card is HELD while the refund of the order that sold it is pending
     (src/lib/giftcards.ts giftHoldsByOrder — the same reader the checkout
     refuses it by). Asked only for an order that sold a card AND carries a
     pending refund line, so every other visit to «Мои заказы» costs nothing
     more than it did; best effort, like the cards themselves. */
  const holdIds = rows
    .filter((r) => cardsByOrder.has(r.id) && refundedMoney(parseJson<Record<string, unknown>>(r.payment, {}), "pending") > 0)
    .map((r) => r.id);
  let holds: Record<string, unknown> = {};
  if (holdIds.length) {
    try {
      holds = await (await import("@/lib/giftcards")).giftHoldsByOrder(holdIds);
    } catch (err) {
      console.error("[customers] gift-card holds unavailable:", err);
    }
  }

  return rows.map((r) => {
    const items = parseJson<Array<Record<string, unknown>>>(r.items, []);
    const payment = parseJson<Record<string, unknown>>(r.payment, {});
    const inv = invoiceOf ? invoiceOf({ invoice: r.invoice }) : null;
    const tr = payment && typeof payment === "object" ? (payment.tracking as unknown) : null;
    const code = typeof tr === "string" ? tr : tr && typeof tr === "object" ? String((tr as Record<string, unknown>).code ?? "") : "";
    const url = tr && typeof tr === "object" ? String((tr as Record<string, unknown>).url ?? "") : "";
    /* The shipping jsonb carries the two fulfilment stamps returns are read
       from — `deliveredAt` and `returnRequest` — and nothing else on this
       screen needs it, so it is unpacked here and not carried any further. */
    const ret = {
      id: r.id,
      number: r.number,
      status: r.status,
      shipping: parseJson<Record<string, unknown>>(r.shipping, {}),
      updatedAt: iso(r.updated_at) ?? "",
    };
    return {
      number: r.number,
      status: r.status,
      total: Math.round(Number(r.total) * 100) / 100 || 0,
      currency: r.currency || "EUR",
      createdAt: iso(r.created_at),
      items: (Array.isArray(items) ? items : []).slice(0, 20).map((it) => ({
        title: [it.brand, it.title ?? it.name].filter(Boolean).join(" ").trim() || "—",
        variant: it.variant == null ? null : String(it.variant),
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      })),
      tracking: code || null,
      trackingUrl: url || null,
      /* What has gone back, and what has been sent and not yet confirmed.
         Montonio answers `200 PENDING` for a refund it has merely accepted and
         the real answer arrives on a webhook up to ten days later, so between
         the shop's «Вернуть деньги» and that webhook the order is still `paid`
         and the customer's screen said nothing at all had happened — while the
         letter in their inbox said the money was on its way (Dim, 19.09.2026:
         «I can still see it in "my orders"»). Two numbers, so the screen can
         tell «отправлен» from «возвращено» instead of guessing from status. */
      refunded: refundedMoney(payment, "done"),
      refundPending: refundedMoney(payment, "pending"),
      giftCards: (cardsByOrder.get(r.id) ?? []).map((c) => (holds[r.id] ? { ...c, held: true as const } : c)),
      invoice: inv ? { number: inv.number, pdfUrl: accountInvoicePath(r.number) } : null,
      returnable: canRequestReturn(ret),
      returnRequestedAt: returnRequestedAt(ret),
    };
  });
}

/**
 * Where «Скачать счёт (PDF)» in the account points: the customer's own copy of
 * the invoice, GET /api/account/orders/<number>/invoice/. By number, not
 * uuid — the number is what the account already shows and what the
 * bookkeeper quotes, and the route takes either.
 */
export function accountInvoicePath(orderNumber: string): string {
  return `/api/account/orders/${encodeURIComponent(String(orderNumber || ""))}/invoice/`;
}

/**
 * `order_id → [{code, amount, pdfUrl}]` for the same orders listCustomerOrders
 * is about to return — named by the address and the limit rather than by their
 * ids, so the two queries leave together instead of one waiting for the other.
 * Empty for every order when anything at all goes wrong: a customer's order
 * list must not fail because a card could not be looked up.
 */
/**
 * The refunds on one order's payment blob, in one status, as a sum.
 *
 * Its own tiny reader rather than refundsOf() from src/lib/payments/refund.ts:
 * this module is imported by every signed-in route, and the payments graph is
 * not something the account list should drag in for two numbers. The shape it
 * reads is the same one settleRefund() writes — `payment.refunds[]` with
 * `amount` and `status` — and `payments-refund-account.test.ts` compares the
 * two answers so they cannot drift apart.
 */
function refundedMoney(payment: unknown, status: "done" | "pending"): number {
  const raw = (payment as { refunds?: unknown } | null | undefined)?.refunds;
  if (!Array.isArray(raw)) return 0;
  let sum = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    if (String(row.status ?? "") !== status) continue;
    const amount = Number(row.amount);
    if (Number.isFinite(amount)) sum += amount;
  }
  return Math.round(sum * 100) / 100 || 0;
}

async function giftCardsForEmail(
  addr: string,
  limit: number,
): Promise<Map<string, Array<{ code: string; amount: number; pdfUrl: string }>>> {
  const out = new Map<string, Array<{ code: string; amount: number; pdfUrl: string }>>();
  try {
    /* The query first, the module after it: `giftPdfPath` is behind a dynamic
       import (see the caller's note for why) and on a cold instance that import
       is disk work this query has no reason to wait for. */
    /* `voided_at is null` — a card the shop has bought back is not a card the
       account may keep offering. Voiding zeroes the balance and stamps the
       row (151_gift_card_refunds), redeemGiftCard() refuses it, and yet «Мои
       заказы» went on showing it and «Скачать подарочную карту (PDF)» went on
       printing its full face value: a PDF of 50 € that buys nothing, handed
       to whoever was given the card. */
    const pending = query<{ code: string; amount: string | number; order_id: string }>(
      `select code, amount, order_id from gift_cards
        where voided_at is null
          and order_id in (select id from orders where lower(email) = $1
                            order by created_at desc limit $2)
        order by created_at asc`,
      [addr, limit],
    );
    pending.catch(() => {});   // the await below still throws; this only stops an unhandled one
    const { giftPdfPath } = await import("@/lib/giftcard-pdf");
    const rows = await pending;
    for (const row of rows) {
      const url = giftPdfPath(row.code);
      // no SESSION_SECRET, no token, no honest link — better none than a 404
      if (!/[?&]t=[^&]+$/.test(url)) continue;
      const list = out.get(row.order_id) ?? [];
      list.push({ code: row.code, amount: Math.round(Number(row.amount) * 100) / 100 || 0, pdfUrl: url });
      out.set(row.order_id, list);
    }
  } catch (err) {
    console.error("[customers] gift cards for the account's orders unavailable:", err);
  }
  return out;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

/* ---------- cart snapshots ------------------------------------------------ */

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];
const BY_ID = new Map<string, MinProduct>(CATALOGUE.map((p) => [p.id, p]));
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

/* product creation: the owner's own rows (src/lib/custom-products.ts, ids
   `c-…`, db/migrations/131_custom_products.sql) are not in the file above.
   Loaded at call time, the way src/lib/orders.ts does it, so this module
   and that one never import each other at the top — and only for ids the
   file does not have, so a catalogue-only basket never pays for the query.
   A hidden row comes back with s:"out". */
type CustomMin = { min: MinProduct; variants: { sizes: string[]; prices: number[] } | null; img: string };
async function customLookup(ids: unknown[]): Promise<Map<string, CustomMin>> {
  const want = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.startsWith("c-") && !BY_ID.has(id)))];
  if (!want.length) return new Map();
  try {
    const { customMinByIds } = await import("@/lib/custom-products");
    return await customMinByIds(want);
  } catch (err) {
    console.error("[customers] custom products not loaded:", err);
    return new Map();
  }
}

export interface CartLine {
  id: string;
  title: string;
  brand: string;
  /** The size label as the shopper saw it, e.g. "250 мл". */
  variant: string | null;
  /** The index the storefront uses, so a resume link can rebuild the line. */
  size: number | null;
  qty: number;
  price: number;
}

export interface CartSnapshot {
  items: CartLine[];
  total: number;
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

type OrdersLib = typeof import("@/lib/orders");
type Overrides = Awaited<ReturnType<OrdersLib["getOverrides"]>>;

/**
 * Turns the browser's `[{id, size|variant, qty}]` into a snapshot with names
 * and prices taken from the catalogue and the owner's overrides — never from
 * the request. Unknown ids are dropped rather than refused: this is a
 * reminder letter, not an order.
 *
 * The prices are the till's prices, arrived at by the till's own rules —
 * getOverrides() and overrideLadder() out of src/lib/orders.ts, the two the
 * checkout's priceLines() uses. This file used to read `price` alone and
 * apply it flat, which got two things wrong the moment a product had sizes:
 * the ladder the owner saved in the editor (product_overrides.sizes) was
 * invisible here, and a single-value override replaced a rung's price
 * outright instead of keeping the rung's premium over the base. Both made
 * the «Итого» in the letter lower than what the customer is charged when he
 * follows the link — the one number in a reminder that must not be a guess.
 *
 * `import()` rather than a top-level import on purpose: this module is a leaf
 * (see the file header) and orders.ts reaches back to it through loyalty.ts.
 * Best effort, like every other optional neighbour — no database, no
 * overrides table, and the catalogue's own prices are still an honest answer.
 */
export async function cartSnapshot(rawItems: unknown): Promise<CartSnapshot> {
  const list = Array.isArray(rawItems) ? rawItems.slice(0, 50) : [];
  // the owner's own products in the basket, priced from their rows like the file's are from the file
  const custom = await customLookup(list.map((raw) => (raw as Record<string, unknown> | null)?.id));
  const ids = new Set<string>();
  for (const raw of list) {
    const it = raw as Record<string, unknown> | null;
    const id = typeof it?.id === "string" ? it.id.slice(0, 120) : "";
    if (id && (BY_ID.has(id) || custom.has(id))) ids.add(id);
  }
  let overrides: Overrides = {};
  let overrideLadder: OrdersLib["overrideLadder"] | null = null;
  if (ids.size) {
    try {
      const orders = await import("@/lib/orders");
      overrides = await orders.getOverrides([...ids]);
      overrideLadder = orders.overrideLadder;
    } catch {
      /* No database, or the overrides table is not there yet: catalogue prices
         are still the honest answer for a reminder letter. */
      overrides = {};
      overrideLadder = null;
    }
  }

  const items: CartLine[] = [];
  let total = 0;
  for (const raw of list) {
    const it = raw as Record<string, unknown> | null;
    const id = typeof it?.id === "string" ? it.id.slice(0, 120) : "";
    const own = custom.get(id);
    const p = BY_ID.get(id) ?? own?.min;
    if (!p) continue;
    // a custom product the owner took off sale is not something to remind anyone about
    if (own && own.min.s !== "in") continue;
    const qty = Math.max(1, Math.min(99, Math.round(Number(it?.qty) || 1)));
    const rawSize = it?.size ?? it?.variant;
    const o = overrides[id];
    // the same three ladders in the same order as priceLines(): the editor's, the owner's product's, the file's
    const ownLadder = overrideLadder ? overrideLadder(o) : null;
    const v = ownLadder ?? own?.variants ?? VARIANTS[id] ?? undefined;
    let size: number | null = null;
    let label: string | null = null;
    let sized: number | null = null;
    if (v && rawSize != null && rawSize !== "") {
      const asIndex = typeof rawSize === "number" ? rawSize : /^\d+$/.test(String(rawSize)) ? Number(rawSize) : -1;
      const idx = asIndex >= 0 && asIndex < v.sizes.length ? asIndex : v.sizes.indexOf(String(rawSize));
      if (idx >= 0) {
        size = idx;
        label = v.sizes[idx];
        sized = Number(v.prices[idx]);
      }
    }
    const rung = Number.isFinite(sized as number) ? (sized as number) : null;
    const override = o?.price;
    /* priceLines() again, rung for rung: a saved ladder already carries the
       price the owner typed on every rung; a single-value override replaces
       the base and the rung keeps its premium over it; otherwise the rung, or
       the base. */
    let base: number;
    if (ownLadder) base = rung ?? ownLadder.prices[0];
    else if (override != null && Number.isFinite(override)) base = rung == null ? override : money(override + (rung - p.p));
    else base = rung ?? p.p;
    const price = money(base);
    items.push({ id, title: p.n, brand: p.b, variant: label, size, qty, price });
    total += price * qty;
  }
  return { items, total: money(total) };
}

/* ---------- carts --------------------------------------------------------- */

export interface CartRow {
  id: string;
  email: string;
  lang: string;
  items: unknown;
  total: string | number;
  updated_at: string | Date;
  recovered_at: string | Date | null;
  reminded_at: string | Date | null;
}

/**
 * One live cart per address. An empty cart deletes the row: a shopper who
 * emptied their basket on purpose must not get a letter about it.
 *
 * `recovered_at` is cleared — this is a cart in play again — while
 * `reminded_at` is left alone, so editing a cart the reminder already went out
 * for does not earn a second letter.
 */
export async function saveCart(input: { email: string; lang?: unknown; items?: unknown }): Promise<CartSnapshot | null> {
  const addr = normalizeEmail(input.email);
  if (!isEmail(addr)) return null;
  const snap = await cartSnapshot(input.items);
  if (!snap.items.length) {
    await query("delete from carts where email = $1", [addr]);
    return snap;
  }
  await query(
    `insert into carts (email, lang, items, total, updated_at, recovered_at)
     values ($1, $2, $3::jsonb, $4, now(), null)
     on conflict (email) do update set
       lang = $2, items = $3::jsonb, total = $4, updated_at = now(), recovered_at = null`,
    [addr, normalizeLangCode(input.lang), jsonbParam(snap.items), snap.total],
  );
  return snap;
}

/* ---------- how often an unproven poster may write a cart ------------------
 *
 * Dim, 17.09.2026: the abandoned-cart reminder stays — it exists for the guest
 * who has never signed in, and a version of it that only writes to known
 * customers has no audience left — but the exposure is bounded per ADDRESS
 * instead of per IP.
 *
 * What POST /api/carts had was `rateLimit("carts", clientIp(req), 30, 60_000)`:
 * a Map in one Node process. On Vercel that is not a bound at all — a cold
 * start begins with an empty Map, two instances never see each other's counts,
 * and an IP address is the cheapest thing an abuser can change. Meanwhile the
 * thing actually at risk — somebody else's mailbox, which anybody may type
 * into the checkout — was counted by nothing.
 *
 * So the counter lives in the database, keyed on the address, and rolls over
 * on the Tallinn calendar day (db/migrations/181_cart_writes.sql). It is its
 * own table on purpose: emptying a basket deletes the `carts` row, so a
 * counter kept there could be reset through the door it is meant to bound.
 *
 * What it does NOT have to do: stop a second letter. That was already true
 * before this — `carts.email` is unique, so one address is one cart, and
 * `reminded_at` is stamped the first time a reminder goes out and is cleared
 * only by an order actually arriving from that address (markCartRecovered).
 * One letter per address is the shape of the table. This is about everything
 * else an unbounded write gives away: overwriting a real shopper's basket,
 * pushing `updated_at` forward for ever so their reminder never fires, and
 * filling the table.
 */

/** Unproven writes one address tolerates in a Tallinn day. Generous for a
 *  shopper editing a basket at the checkout (each change files a snapshot),
 *  far too small to be a tool. */
export const CART_WRITES_PER_DAY = 30;

/** How long a day's counter is kept before the flows run prunes it. */
export const CART_WRITES_KEEP_DAYS = 30;

/**
 * Counts one unproven write to `email` and says whether it may go ahead.
 *
 * One statement, so two requests racing cannot both read "29". The count is
 * incremented even when the answer is no: a client that keeps hammering keeps
 * being refused, rather than being handed a free write per attempt.
 *
 * Throws what the database throws — the caller is about to write a cart into
 * the same database, so there is nothing to fall back to and the route's own
 * 503 is the honest answer. Fails CLOSED by never having allowed the write.
 */
export async function allowGuestCartWrite(email: string, now: number = Date.now()): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!isEmail(addr)) return false;
  const rows = await query<{ n: number | string }>(
    `insert into cart_writes (email, day, n) values ($1, $2, 1)
     on conflict (email) do update set
       day = $2,
       n = case when cart_writes.day = $2 then cart_writes.n + 1 else 1 end
     returning n`,
    [addr, shopDay(now)],
  );
  return (Number(rows[0]?.n) || 0) <= CART_WRITES_PER_DAY;
}

/**
 * Drops counters for days long past. Best effort, called once a day from the
 * flows run: a bound that never forgets would be a table that only grows.
 */
export async function pruneCartWrites(now: number = Date.now()): Promise<number> {
  const before = addShopDays(shopDay(now), -CART_WRITES_KEEP_DAYS);
  if (!before) return 0;
  try {
    const rows = await query<{ email: string }>("delete from cart_writes where day < $1 returning email", [before]);
    return rows.length;
  } catch (err) {
    console.warn("[carts] old write counters not pruned:", (err as Error)?.message);
    return 0;
  }
}

/** An order was placed — the cart is no longer abandoned. */
export async function markCartRecovered(email: string): Promise<void> {
  const addr = normalizeEmail(email);
  if (!isEmail(addr)) return;
  /* reminded_at is cleared too: the next cart this person abandons is a new
     story and deserves its own single reminder — and, since 20.09.2026, its
     own single discounted follow-up. The stamp and the code it issued go
     together: a row that kept `discount_at` would let the first letter fire
     again on the next basket and silently withhold the second one for ever,
     and a `discount_code` left behind would name a code written for a basket
     this person has already bought.
     …and before `reminded_at` goes, what it said is kept: an order after the
     letter is a shopper who came back by it — «Вернулись по письму» in
     «Аналитика» (db/migrations/213_cart_returned_by_letter.sql). The row is
     joined to itself as it was, so RETURNING can hand back the old stamp. */
  const rows = await query<{ was: unknown }>(
    `update carts c set recovered_at = now(), reminded_at = null,
            discount_at = null, discount_code = null
       from (select id, reminded_at from carts where email = $1) o
      where c.id = o.id
      returning o.reminded_at as was`,
    [addr],
  );
  if (rows.some((r) => r.was != null)) {
    /* one row, a timestamp and nothing else — see the migration. A count
       that could not be written is a figure one short, never a failed order
       or a cart left unrecovered: the update above has already happened. */
    try {
      await query("insert into cart_returns default values");
    } catch (err) {
      console.warn("[carts] «вернулись по письму» not counted:", (err as Error)?.message);
    }
  }
}

export async function getCart(email: string): Promise<CartRow | null> {
  const rows = await query<CartRow>("select * from carts where email = $1", [normalizeEmail(email)]);
  return rows.length ? rows[0] : null;
}

/* ---------- stock alerts -------------------------------------------------- */

export interface StockAlertRow {
  id: string;
  email: string;
  product_id: string;
  lang: string;
  created_at: string | Date;
  sent_at: string | Date | null;
}

/**
 * «Сообщить о наличии». Asking twice is one subscription, not two letters.
 * The product is the catalogue's or one of the owner's own rows — a hidden
 * custom product is refused: it was taken off the shelf, it is not coming
 * back «в наличии».
 */
export async function addStockAlert(input: { email: string; productId: unknown; lang?: unknown }): Promise<boolean> {
  const addr = normalizeEmail(input.email);
  const productId = typeof input.productId === "string" ? input.productId.slice(0, 120) : "";
  if (!isEmail(addr) || !productId) return false;
  if (!BY_ID.has(productId)) {
    const own = (await customLookup([productId])).get(productId);
    if (!own || own.min.s !== "in") return false;
  }
  await query(
    `insert into stock_alerts (email, product_id, lang) values ($1, $2, $3)
     on conflict (email, product_id) do update set lang = $3, sent_at = null, created_at = now()`,
    [addr, productId, normalizeLangCode(input.lang)],
  );
  return true;
}

export async function pendingStockAlerts(productId?: string): Promise<StockAlertRow[]> {
  if (productId) {
    return query<StockAlertRow>(
      "select * from stock_alerts where product_id = $1 and sent_at is null order by created_at",
      [productId],
    );
  }
  return query<StockAlertRow>("select * from stock_alerts where sent_at is null order by created_at limit 500");
}

/**
 * How many people wait for each product — the unsent «Сообщить о наличии»
 * rows, by product (Dim 25.09.2026, q41: «N человек ждут — получат письмо»
 * beside «Наличие» in the panel's product card). One grouped read over the
 * pending index; a product nobody waits for is simply absent.
 */
export async function pendingStockAlertCounts(): Promise<Record<string, number>> {
  const rows = await query<{ product_id: string; n: number }>(
    "select product_id, count(*)::int as n from stock_alerts where sent_at is null group by product_id",
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.product_id] = Number(r.n) || 0;
  return out;
}

/**
 * Stamps one alert spent — and says whether THIS call stamped it. Two runs
 * can read the same pending row at the same moment (the owner's «мало» and a
 * scanner count landing together, or either of them and the daily sweep);
 * only the one whose stamp took the row from pending may send its letter, so
 * a subscription is answered once however many doors open at the same time.
 */
export async function markStockAlertSent(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "update stock_alerts set sent_at = now() where id = $1 and sent_at is null returning id",
    [id],
  );
  return rows.length > 0;
}

/** What the shop knows about a product — the back-in-stock letter's data. */
export interface AlertProduct {
  id: string;
  brand: string;
  name: string;
  price: number;
  /** The catalogue's own in/low/out, or "in"/"out" for a custom row that is on sale / hidden. */
  stock: string;
  /** The first photo, for a custom product; the catalogue's rows do not carry one here. */
  img: string | null;
}

/**
 * The products behind these ids — the catalogue file first, the owner's own
 * rows (src/lib/custom-products.ts) for the rest. An id neither knows is
 * simply absent, and the caller treats its alert as spent.
 */
export async function productsForAlerts(ids: string[]): Promise<Map<string, AlertProduct>> {
  const out = new Map<string, AlertProduct>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const p = BY_ID.get(id);
    if (p) out.set(id, { id: p.id, brand: p.b, name: p.n, price: p.p, stock: p.s, img: null });
    else missing.push(id);
  }
  for (const [id, own] of await customLookup(missing)) {
    out.set(id, { id, brand: own.min.b, name: own.min.n, price: own.min.p, stock: own.min.s, img: own.img });
  }
  /* …and the owner's own price on top, the same one the product page shows
     (renderCustomProductPage / productSpec read product_overrides.price the
     moment there is one). Without this the «снова в наличии» letter quoted the
     catalogue file and the page it links to quoted the panel, so a product
     whose price Renat had changed was advertised at a figure the shop does not
     charge. Best effort: no table, no override — the file's price stands. */
  if (out.size) {
    const keys = [...out.keys()];
    const holes = keys.map((_, i) => `$${i + 1}`).join(",");
    try {
      const rows = await query<{ product_id: string; price: number | string | null }>(
        `select product_id, price from product_overrides where product_id in (${holes}) and price is not null`,
        keys,
      );
      for (const r of rows) {
        const price = Number(r.price);
        const p = out.get(r.product_id);
        if (p && Number.isFinite(price)) p.price = price;
      }
    } catch {
      /* no overrides table — the catalogue's own price is the answer */
    }
  }
  return out;
}
