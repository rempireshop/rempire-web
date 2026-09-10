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
 */
export interface ShipPref {
  /** The storefront's zone code — EE, LV, LT, FI, or EU for «другая страна». */
  country: string;
  method: "pickup" | "parcel" | "courier";
  carrier: string;
  machine: string;
}

const SHIP_METHODS: ReadonlyArray<ShipPref["method"]> = ["pickup", "parcel", "courier"];

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
  return { country, method, carrier, machine };
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

/**
 * «Хочу получать новости и скидки» at the checkout.
 *
 * The tick has been on that screen for as long as the checkout has: it was
 * collected into S.newsletter and read by nothing — no row, no list, no
 * letter (QA sweep 06.09 §5.3). Dim, 07.09.2026: «Wire». So the order carries
 * it and it lands here, on `customers.marketing` — the same column the
 * account screen's own checkbox writes and the same one the birthday and
 * abandoned-cart jobs read. A guest gets a row created for the address they
 * just ordered from, which is what makes their consent storable at all.
 *
 * Consent only ever goes ON here. Not ticking a box at a checkout is not a
 * withdrawal — the shopper may have said yes in their account last month, and
 * an order is no place to revoke that silently. Turning it off stays where it
 * belongs: the account screen, and the owner's own panel.
 *
 * Never throws: a consent that could not be written must not fail an order
 * that has already been paid for.
 */
export async function recordMarketingConsent(email: string, lang?: unknown): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr || !isEmail(addr)) return false;
  try {
    await query(
      `insert into customers (email, lang, marketing) values ($1, $2, true)
       on conflict (email) do update set marketing = true`,
      [addr, normalizeLangCode(lang)],
    );
    return true;
  } catch (err) {
    console.error("[customers] newsletter consent not stored:", err);
    return false;
  }
}

export interface CustomerPatch {
  name?: unknown;
  phone?: unknown;
  birthday?: unknown;
  marketing?: unknown;
  lang?: unknown;
  /** «Доставка по умолчанию» — a ShipPref-shaped object, or null to clear it. */
  shipPref?: unknown;
}

/** Only the keys present are touched; `null`/`""` clears one. */
export async function updateCustomer(email: string, patch: CustomerPatch): Promise<Customer | null> {
  const addr = normalizeEmail(email);
  const cols: Record<string, unknown> = {};
  if ("name" in patch) cols.name = text(patch.name, 120);
  if ("phone" in patch) cols.phone = text(patch.phone, 40);
  if ("birthday" in patch) cols.birthday = normalizeBirthday(patch.birthday);
  if ("marketing" in patch) cols.marketing = patch.marketing === true || patch.marketing === "true" || patch.marketing === 1;
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
  /* The printable gift cards this order bought, if any — code plus the signed
     link to /api/giftcards/<code>/pdf/. Until 07.09.2026 that link existed
     only on the receipt screen, so closing the tab left the buyer with the
     code in an e-mail and no card to print. Dim: «If possible also add it for
     download through the account page.» The token is the same HMAC the
     receipt and the letter carry, and it is only ever handed to a request
     that already proved it owns this mailbox (the signed rmp_cust cookie in
     /api/account/me), so nothing new is exposed. */
  giftCards: Array<{ code: string; amount: number; pdfUrl: string }>;
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
  const rows = await query<{
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
  }>(
    `select id, number, status, total, currency, created_at, updated_at, items, payment, shipping
       from orders where lower(email) = $1 order by created_at desc limit $2`,
    [normalizeEmail(email), Math.min(Math.max(Number(limit) || 20, 1), 50)],
  );

  /* The cards these orders issued, in one query rather than one per order.
     Loaded through a dynamic import for the same reason src/lib/orders.ts
     loads its neighbours that way: a deployment without the PDF fonts, or a
     gift_cards table an older migration has not created yet, must cost the
     account screen its cards and not its orders. */
  const cardsByOrder = await giftCardsForOrders(rows.map((r) => r.id));

  return rows.map((r) => {
    const items = parseJson<Array<Record<string, unknown>>>(r.items, []);
    const payment = parseJson<Record<string, unknown>>(r.payment, {});
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
      giftCards: cardsByOrder.get(r.id) ?? [],
      returnable: canRequestReturn(ret),
      returnRequestedAt: returnRequestedAt(ret),
    };
  });
}

/**
 * `order_id → [{code, amount, pdfUrl}]` for a batch of orders. Empty for every
 * order when anything at all goes wrong — a customer's order list must not
 * fail because a card could not be looked up.
 */
async function giftCardsForOrders(
  orderIds: string[],
): Promise<Map<string, Array<{ code: string; amount: number; pdfUrl: string }>>> {
  const out = new Map<string, Array<{ code: string; amount: number; pdfUrl: string }>>();
  const ids = orderIds.filter((id) => typeof id === "string" && id);
  if (!ids.length) return out;
  try {
    const { giftPdfPath } = await import("@/lib/giftcard-pdf");
    const rows = await query<{ code: string; amount: string | number; order_id: string }>(
      `select code, amount, order_id from gift_cards
        where order_id = any($1::uuid[]) order by created_at asc`,
      [ids],
    );
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

/**
 * Turns the browser's `[{id, size|variant, qty}]` into a snapshot with names
 * and prices taken from the catalogue and the owner's overrides — never from
 * the request. Unknown ids are dropped rather than refused: this is a
 * reminder letter, not an order.
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
  let prices: Record<string, number | null> = {};
  if (ids.size) {
    try {
      const holes = [...ids].map((_, i) => `$${i + 1}`).join(",");
      const rows = await query<{ product_id: string; price: string | number | null }>(
        `select product_id, price from product_overrides where product_id in (${holes})`,
        [...ids],
      );
      for (const r of rows) prices[r.product_id] = r.price == null ? null : Number(r.price);
    } catch {
      /* No database, or the overrides table is not there yet: catalogue prices
         are still the honest answer for a reminder letter. */
      prices = {};
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
    const v = VARIANTS[id] ?? own?.variants ?? undefined;
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
    const override = prices[id];
    const base = override != null && Number.isFinite(override) ? override : Number.isFinite(sized as number) ? (sized as number) : p.p;
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

/** An order was placed — the cart is no longer abandoned. */
export async function markCartRecovered(email: string): Promise<void> {
  const addr = normalizeEmail(email);
  if (!isEmail(addr)) return;
  // reminded_at is cleared too: the next cart this person abandons is a new
  // story and deserves its own single reminder.
  await query("update carts set recovered_at = now(), reminded_at = null where email = $1", [addr]);
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

export async function markStockAlertSent(id: string): Promise<void> {
  await query("update stock_alerts set sent_at = now() where id = $1", [id]);
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
  return out;
}
