/**
 * The three automatic letters — «Брошенная корзина», «Снова в наличии»,
 * «С днём рождения» — and the switches in the admin that turn them on.
 *
 * Until now `settings.flows` was written by the panel and read by nothing
 * (docs/audit/features-admin-assistant.md, top-15 #12). This module is the
 * reader. Every send goes through one rule: **the switch decides, the row
 * remembers**. `carts.reminded_at`, `stock_alerts.sent_at` and
 * `customers.birthday_sent_year` are set the moment a letter leaves, so the
 * scheduler can run every hour, twice, or be replayed by hand without anybody
 * getting the same letter twice.
 *
 * Nothing in here throws. A flow that fails is a flow that did not send; the
 * shop keeps selling.
 *
 * Deliberately imports `@/lib/db` and not `@/lib/orders`: orders.ts calls back
 * into this file (the back-in-stock hook in `upsertOverride`), and a top-level
 * cycle between the two would be a live hazard for a rarely-exercised path.
 */
import { renderAbandonedCart } from "@/emails/abandoned-cart";
import { renderBackInStock } from "@/emails/back-in-stock";
import { renderBirthday } from "@/emails/birthday";
import { baseUrl, normalizeLang } from "@/emails/layout";
import { cleanMailTexts, setMailTextsOverride } from "@/emails/texts";
import { query } from "@/lib/db";
import { sendRendered } from "@/lib/mail";
import {
  markStockAlertSent,
  normalizeLangCode,
  pendingStockAlerts,
  productsForAlerts,
  type AlertProduct,
  type CartLine,
  type LangCode,
  type StockAlertRow,
} from "@/lib/customers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* ---------- settings.flows ------------------------------------------------ */

export interface Flows {
  /** «Брошенная корзина» — a reminder 3 h after the cart went quiet. */
  abandoned: boolean;
  /** «Скидка ко дню рождения» — a personal promo on the day. */
  birthday: boolean;
  /** «Товар снова в наличии» — to everybody waiting for that product. */
  backstock: boolean;
  /** «Заказ принят, ждём оплату» — off by default, see docs/mail.md. */
  pending: boolean;
  /**
   * «Заказ ждёт оплаты» — the reminder, and the automatic cancellation that
   * follows it (Dim, 07.09.2026: «нужны напоминания, а через семь дней
   * отменяем и сообщаем»). One switch for the pair: a shop that reminds but
   * never lets go, or lets go without warning, is neither of the two things
   * he asked for.
   */
  unpaid: boolean;
  /** Days after an unpaid order before the reminder. */
  unpaidRemindDays: number;
  /** Days after an unpaid order before it cancels itself. */
  unpaidCancelDays: number;
  /** Static promo code for the birthday letter when there is no promo module. */
  birthdayCode: string;
  /** Percent shown in the birthday letter. */
  birthdayPercent: number;
  /**
   * How many days BEFORE the birthday the letter goes out (Dim, 07.09.2026:
   * «the days before need to be a setting»). 0 — on the day itself, which is
   * what runBirthdays() has always done and what the panel now says by
   * default. The daily cron is what makes any other number honest: one run a
   * day means «за 3 дня» really is three days, not three days and some hours.
   */
  birthdayDays: number;
}

/** The most warning that still reads as a birthday letter rather than a random promo. */
export const BIRTHDAY_MAX_DAYS = 30;

export const FLOW_DEFAULTS: Flows = {
  abandoned: false,
  birthday: false,
  backstock: false,
  pending: false,
  unpaid: false,
  unpaidRemindDays: 3,
  unpaidCancelDays: 7,
  birthdayCode: "",
  birthdayPercent: 10,
  birthdayDays: 0,
};

/** 1–60 whole days, or the default. The panel clamps too; this is the door. */
function days(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(1|true|on|yes|да)$/i.test(v.trim());
  if (typeof v === "number") return v !== 0;
  return fallback;
}

/**
 * Reads `settings.flows`. A missing row, a missing table or a missing database
 * all mean the same thing: every flow is off. That is the safe direction — a
 * shop with no settings must not start mailing people.
 */
export async function getFlows(): Promise<Flows> {
  let raw: unknown = null;
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = 'flows'");
    raw = rows.length ? rows[0].value : null;
  } catch {
    return { ...FLOW_DEFAULTS };
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const percent = Number(f.birthdayPercent);
  const cancelDays = days(f.unpaidCancelDays, FLOW_DEFAULTS.unpaidCancelDays);
  /* The reminder must come BEFORE the cancellation, whatever the two numbers
     say. A remind-after that is not shorter than the cancel-after would mean a
     letter warning about something that already happened, so it is pulled back
     to the day before rather than refused — the panel refuses it too, and this
     is the door that cannot be walked round. */
  const remindDays = Math.min(days(f.unpaidRemindDays, FLOW_DEFAULTS.unpaidRemindDays), Math.max(1, cancelDays - 1));
  const birthdayN = Math.trunc(Number(f.birthdayDays));
  return {
    birthdayDays: Number.isFinite(birthdayN) && birthdayN > 0 ? Math.min(birthdayN, BIRTHDAY_MAX_DAYS) : 0,
    abandoned: bool(f.abandoned, FLOW_DEFAULTS.abandoned),
    birthday: bool(f.birthday, FLOW_DEFAULTS.birthday),
    backstock: bool(f.backstock, FLOW_DEFAULTS.backstock),
    pending: bool(f.pending, FLOW_DEFAULTS.pending),
    unpaid: bool(f.unpaid, FLOW_DEFAULTS.unpaid),
    unpaidRemindDays: remindDays,
    unpaidCancelDays: cancelDays,
    birthdayCode: typeof f.birthdayCode === "string" ? f.birthdayCode.trim().toUpperCase().slice(0, 40) : "",
    birthdayPercent: Number.isFinite(percent) && percent > 0 && percent <= 90 ? Math.round(percent) : FLOW_DEFAULTS.birthdayPercent,
  };
}

/**
 * «Письма»: the owner's own subject / intro / signature for these three
 * letters (`settings.mail_texts`, src/emails/texts.ts). Loaded once at the
 * top of each run — the same thing loadBrand() does before an order letter,
 * and the reason the admin preview and the real send never disagree.
 *
 * Best effort: no row, no table, a malformed blob ⇒ the built-in defaults.
 */
async function loadTexts(): Promise<void> {
  try {
    const rows = await query<{ value: unknown }>(
      "select value from settings where key = 'mail_texts'",
    );
    setMailTextsOverride(cleanMailTexts(rows.length ? rows[0].value : null));
  } catch {
    setMailTextsOverride(null);
  }
}

/* ---------- the resume link ----------------------------------------------- */

const RESUME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resumeKey(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : "rempire-resume-cart";
}

function sign(payload: string): string {
  return createHmac("sha256", resumeKey()).update(`resume.${payload}`).digest("base64url");
}

/**
 * `<base64url(payload)>.<hmac>` for `/shop2/checkout/?resume=…`.
 *
 * The payload carries product ids, sizes and quantities and **no e-mail** — a
 * reminder link travels through mail servers and browser history, and a
 * customer's address has no business in a query string. The signature is what
 * the server checks; the storefront treats the payload as untrusted anyway and
 * only accepts catalogue ids at a capped quantity, which is exactly what a
 * shopper could type into their own basket by hand.
 */
export function makeResumeToken(items: CartLine[], now: number = Date.now()): string {
  const payload = JSON.stringify({
    v: 1,
    exp: now + RESUME_TTL_MS,
    i: items.slice(0, 50).map((l) => ({ id: l.id, s: l.size, q: l.qty })),
  });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export interface ResumePayload {
  items: Array<{ id: string; size: number | null; qty: number }>;
}

/** Verifies a resume token. Null for anything forged, stale or malformed. */
export function readResumeToken(token: string | null | undefined, now: number = Date.now()): ResumePayload | null {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const want = Buffer.from(sign(parts[0]));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const raw = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    if (Number(raw.exp) <= now) return null;
    const list = Array.isArray(raw.i) ? raw.i : [];
    return {
      items: list.slice(0, 50).map((l) => {
        const it = l as Record<string, unknown>;
        // `null` means "the product has no sizes"; Number(null) is 0, which
        // would silently pin every such line to the first variant.
        const size = it.s == null ? Number.NaN : Number(it.s);
        return {
          id: String(it.id ?? "").slice(0, 120),
          size: Number.isFinite(size) ? size : null,
          qty: Math.max(1, Math.min(99, Math.round(Number(it.q) || 1))),
        };
      }).filter((l) => l.id),
    };
  } catch {
    return null;
  }
}

/** `/shop2/et/checkout/?resume=…`, absolute. */
function resumeUrl(lang: LangCode, items: CartLine[]): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  return `${baseUrl()}/shop2${seg}/checkout/?resume=${encodeURIComponent(makeResumeToken(items))}`;
}

function accountUrl(lang: LangCode): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  return `${baseUrl()}/shop2${seg}/account/`;
}

function productUrl(lang: LangCode, id: string): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  return `${baseUrl()}/shop2${seg}/p/${encodeURIComponent(id)}/`;
}

/* ---------- «Брошенная корзина» ------------------------------------------- */

export interface FlowRun {
  sent: number;
  skipped: number;
  reason?: string;
}

const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;
const BATCH = 100;

/**
 * One reminder per abandoned cart, three hours after the last change, and only
 * when no order has arrived from that address since.
 *
 * `reminded_at` is stamped **before** the send, not after: a crash between the
 * two costs one letter, while the other order costs the customer a second copy
 * every time the cron runs.
 */
export async function runAbandonedCarts(now: number = Date.now()): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.abandoned) return { sent: 0, skipped: 0, reason: "disabled" };
  await loadTexts();

  const cutoff = new Date(now - ABANDONED_AFTER_MS).toISOString();
  const rows = await query<{
    id: string;
    email: string;
    lang: string;
    items: unknown;
    total: string | number;
  }>(
    `select c.id, c.email, c.lang, c.items, c.total
       from carts c
      where c.reminded_at is null
        and c.recovered_at is null
        and c.updated_at <= $1
        and not exists (
          select 1 from orders o
           where lower(o.email) = c.email and o.created_at >= c.updated_at
        )
      order by c.updated_at
      limit ${BATCH}`,
    [cutoff],
  );

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const items = parseItems(row.items);
    if (!items.length) {
      await query("update carts set reminded_at = now() where id = $1", [row.id]);
      skipped += 1;
      continue;
    }
    await query("update carts set reminded_at = now() where id = $1", [row.id]);
    const lang = normalizeLangCode(row.lang);
    const mail = renderAbandonedCart(
      {
        email: row.email,
        lang,
        items,
        total: Number(row.total) || undefined,
        unsubscribeUrl: accountUrl(lang),
      },
      normalizeLang(lang),
      resumeUrl(lang, items),
    );
    const res = await sendRendered(row.email, mail, {
      tags: { template: "abandoned-cart", lang: lang.toLowerCase() },
      idempotencyKey: `cart:${row.id}`,
    });
    if (res.ok && !res.skipped) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

function parseItems(v: unknown): CartLine[] {
  const raw = typeof v === "string" ? safeJson(v) : v;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => l as Record<string, unknown>)
    .filter((l) => l && typeof l.id === "string")
    .map((l) => ({
      id: String(l.id),
      title: String(l.title ?? ""),
      brand: String(l.brand ?? ""),
      variant: l.variant == null ? null : String(l.variant),
      size: l.size == null ? null : Number(l.size),
      qty: Math.max(1, Math.round(Number(l.qty) || 1)),
      price: Number(l.price) || 0,
    }));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------- «Товар снова в наличии» --------------------------------------- */

/**
 * Everybody waiting for one product gets one letter. Called from
 * `upsertOverride` in src/lib/orders.ts the moment the owner sets stock to
 * «в наличии» — pending rows only exist for a product that was sold out, so
 * "no pending rows" is the same statement as "it was not out".
 */
export async function runBackInStock(productId: string): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.backstock) return { sent: 0, skipped: 0, reason: "disabled" };
  const alerts = await pendingStockAlerts(productId);
  return sendStockAlerts(alerts);
}

/**
 * The scheduler's safety net for the case the switch was off, or the stock
 * moved through a settings change rather than through `upsertOverride`: every
 * pending alert whose product now reads «в наличии» is sent.
 */
export async function sweepBackInStock(): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.backstock) return { sent: 0, skipped: 0, reason: "disabled" };
  await loadTexts();

  const alerts = await pendingStockAlerts();
  if (!alerts.length) return { sent: 0, skipped: 0 };

  const ids = [...new Set(alerts.map((a) => a.product_id))];
  const holes = ids.map((_, i) => `$${i + 1}`).join(",");
  const overrides = new Map<string, string | null>();
  try {
    const rows = await query<{ product_id: string; stock: string | null }>(
      `select product_id, stock from product_overrides where product_id in (${holes})`,
      ids,
    );
    for (const r of rows) overrides.set(r.product_id, r.stock);
  } catch {
    /* no overrides table — the catalogue's own stock is the answer */
  }

  /* The catalogue file and the owner's own rows (`c-…`) in one map: a custom
     product that is on sale reads "in" from its row and "out" from the
     override the owner switched — exactly the one this sweep is waiting on. */
  const products = await productsForAlerts(ids);
  const ready = alerts.filter((a) => {
    const p = products.get(a.product_id);
    if (!p) return false;
    const stock = overrides.get(a.product_id) ?? p.stock;
    return stock === "in";
  });
  return sendStockAlerts(ready, products);
}

async function sendStockAlerts(alerts: StockAlertRow[], known?: Map<string, AlertProduct>): Promise<FlowRun> {
  const products = known ?? (await productsForAlerts(alerts.map((a) => a.product_id)));
  let sent = 0;
  let skipped = 0;
  for (const alert of alerts.slice(0, BATCH)) {
    const p = products.get(alert.product_id);
    if (!p) {
      await markStockAlertSent(alert.id);
      skipped += 1;
      continue;
    }
    // Stamped first: a repeat is worse than a miss (see runAbandonedCarts).
    await markStockAlertSent(alert.id);
    const lang = normalizeLangCode(alert.lang);
    const mail = renderBackInStock(
      {
        id: p.id,
        brand: p.brand,
        title: p.name,
        price: p.price,
        url: productUrl(lang, p.id),
        unsubscribeUrl: accountUrl(lang),
      },
      normalizeLang(lang),
    );
    const res = await sendRendered(alert.email, mail, {
      tags: { template: "back-in-stock", lang: lang.toLowerCase() },
      idempotencyKey: `stock:${alert.id}`,
    });
    if (res.ok && !res.skipped) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

/* ---------- «С днём рождения» --------------------------------------------- */

/** How long the code is worth having AFTER the birthday itself — the two weeks
 *  the panel promises under «Скидка ко дню рождения». It is not the code's
 *  whole life: see birthdayCodeDays() for what the head start does to it. */
const BIRTHDAY_DAYS = 14;

/**
 * The code's whole life, counted from the day it is issued.
 *
 * The letter can be sent `birthdayDays` days early, and the code is written on
 * the day the letter goes out — so a fixed fourteen days meant the head start
 * ate into them: «за 14 дней» handed the customer a code that expired exactly
 * on his birthday, which is the one day it was bought for. Dim, 08.09.2026:
 * extend the code's life by the head start. The customer then always has the
 * same fourteen usable days starting on the birthday itself, whether the
 * letter arrived that morning or two weeks before it.
 */
function birthdayCodeDays(flows: Flows): number {
  return BIRTHDAY_DAYS + flows.birthdayDays;
}

/** `REM-BD-7QK4X9` — readable, unambiguous, never confused with a gift card. */
export function birthdayCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `REM-BD-${out}`;
}

/**
 * A real, single-use promo when the promo module exists (the checkout agent's
 * `src/lib/promos.ts`), otherwise the static `settings.flows.birthdayCode`.
 * Null means "there is no code to send" — and then no letter goes out, because
 * a birthday letter with a code that does nothing is worse than silence.
 */
async function promoForBirthday(flows: Flows, now: number): Promise<{ code: string; expires: Date } | null> {
  const expires = new Date(now + birthdayCodeDays(flows) * 24 * 60 * 60 * 1000);
  try {
    /* The checkout agent's module. Both spellings are accepted: `upsertPromo`
       is what it shipped with, `createPromo` is what the brief called it. The
       code shape (`REM-BD-…`) passes its own normalisePromoCode and cannot be
       mistaken for a gift card, which needs an `RMP` prefix. */
    const mod = (await import("@/lib/promos")) as unknown as {
      createPromo?: (input: Record<string, unknown>) => Promise<unknown>;
      upsertPromo?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    const code = birthdayCode();
    if (mod.upsertPromo) {
      await mod.upsertPromo({
        code,
        kind: "percent",
        value: flows.birthdayPercent,
        minSubtotal: 0,
        startsAt: null,
        endsAt: expires.toISOString(),
        maxUses: 1,
        active: true,
        note: "День рождения — код выписан автоматически",
      });
      return { code, expires };
    }
    if (mod.createPromo) {
      await mod.createPromo({
        code,
        kind: "percent",
        value: flows.birthdayPercent,
        ends_at: expires,
        max_uses: 1,
      });
      return { code, expires };
    }
  } catch (err) {
    // No module, no table, or it refused: fall through to the static code.
    console.warn("[flows] promo module unavailable:", (err as Error)?.message);
  }
  return flows.birthdayCode ? { code: flows.birthdayCode, expires } : null;
}

/**
 * Everybody whose birthday is `flows.birthdayDays` days from now, who has said
 * yes to marketing, and who has not had this year's letter.
 *
 * `birthdayDays` is 0 by default — the day itself, which is what this has
 * always done. A larger number moves the window forward: with 3, the letter
 * for a 14 March birthday goes out on 11 March, and the code it carries is
 * written to last three days longer for it (birthdayCodeDays), so the head
 * start is added to the customer's two weeks instead of taken out of them.
 * The year the guard stamps is the BIRTHDAY's year, not today's: on
 * 30 December, «за 3 дня» is looking at a birthday in January, and stamping
 * this year would let the same letter go out again a few days later.
 *
 * `birthday_sent_year` is that guard — the job may run hourly without sending
 * twice, and the daily cron is what makes «за N дней» mean N whole days.
 */
export async function runBirthdays(now: number = Date.now()): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.birthday) return { sent: 0, skipped: 0, reason: "disabled" };
  await loadTexts();

  const today = new Date(now + flows.birthdayDays * 24 * 60 * 60 * 1000);
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const year = today.getUTCFullYear();

  const rows = await query<{ id: string; email: string; name: string | null; lang: string | null }>(
    `select id, email, name, lang from customers
      where birthday is not null
        and marketing = true
        and extract(month from birthday) = $1
        and extract(day   from birthday) = $2
        and (birthday_sent_year is null or birthday_sent_year <> $3)
      order by created_at
      limit ${BATCH}`,
    [month, day, year],
  );
  if (!rows.length) return { sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;
  let reason: string | undefined;
  for (const row of rows) {
    const promo = await promoForBirthday(flows, now);
    if (!promo) {
      /* No promo module and no settings.flows.birthdayCode: a birthday letter
         whose code does nothing is worse than no letter. The row is left
         unstamped so it goes out as soon as a code exists. */
      reason = "no_promo_code";
      skipped += 1;
      continue;
    }
    await query("update customers set birthday_sent_year = $2 where id = $1", [row.id, year]);
    const lang = normalizeLangCode(row.lang);
    const mail = renderBirthday(
      { email: row.email, name: row.name ?? "", lang, unsubscribeUrl: accountUrl(lang) },
      normalizeLang(lang),
      promo.code,
      { percent: flows.birthdayPercent, expires: promo.expires },
    );
    const res = await sendRendered(row.email, mail, {
      tags: { template: "birthday", lang: lang.toLowerCase() },
      idempotencyKey: `bday:${row.id}:${year}`,
    });
    if (res.ok && !res.skipped) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped, reason };
}

/* ---------- «Заказ ждёт оплаты» → отмена ---------------------------------- */

/**
 * The unpaid order's own clock.
 *
 * An order that reached the bank page and was never paid used to sit in
 * «новый» for ever: nobody wrote to the customer, and nobody let the order go.
 * Dim, 07.09.2026: «нужны напоминания, а через семь дней отменяем и
 * сообщаем.» Both numbers are settings, not constants
 * (`settings.flows.unpaidRemindDays` / `unpaidCancelDays`, «Письма» in the
 * admin), because seven days is his answer today and not a law.
 *
 * Vercel's free plan runs the cron once a day, so everything here is designed
 * for one pass a day: whole days, one reminder per order, and a cancellation
 * that is its own stamp. A missed day catches up on the next run; two runs in
 * one day change nothing, because the reminder stamps the order before the
 * letter leaves (the rule runAbandonedCarts() already follows) and a cancelled
 * order no longer matches the query.
 *
 * What it will NOT touch: an order taken at the till («Салон», channel `pos`
 * — the money was in the drawer before the row existed), and an order whose
 * payment blob says paid whatever its status column says.
 */
export interface UnpaidRun extends FlowRun {
  /** Orders cancelled on this pass. */
  cancelled: number;
}

/** The row the two queries below share — enough to render either letter. */
interface UnpaidRow {
  id: string;
  number: string;
  email: string | null;
  name: string | null;
  lang: string | null;
  items: unknown;
  shipping: unknown;
  subtotal: string | number | null;
  shipping_price: string | number | null;
  discount: string | number | null;
  total: string | number | null;
  currency: string | null;
  status: string;
  invoice: unknown;
  created_at: string | Date;
}

const UNPAID_COLUMNS =
  "id, number, email, name, lang, items, shipping, subtotal, shipping_price, discount, total, currency, status, invoice, created_at";

/* The two statuses an order carries while its money has not arrived: «новый»
   (never left for the bank, or left and never came back) and «не оплачен»
   (the shopper pressed «Отменить» at the bank). Both are orders the customer
   may still want — which is the whole point of writing to them first. */
const UNPAID_STATUSES = "('new','failed')";
const NOT_PAID = "coalesce(payment->>'status','') <> 'paid'";
/* «По счёту» is not this loop's business. An invoice order carries its own
   clock — src/lib/invoice-dunning.ts, counted from the invoice's due date
   rather than from when the order was placed — and both loops select the
   same two statuses, so without this an invoice would draw two reminders
   and be cancelled on the day it fell due (audit 07.09.2026). */
const NOT_INVOICE = "invoice is null";

function unpaidOrderLike(row: UnpaidRow): Record<string, unknown> {
  return {
    id: row.id,
    number: row.number,
    email: row.email,
    customer_name: row.name,
    lang: row.lang,
    items: Array.isArray(row.items) ? row.items : safeJson(String(row.items ?? "[]")),
    shipping: row.shipping,
    subtotal: row.subtotal,
    shipping_price: row.shipping_price,
    discount: row.discount,
    total: row.total,
    currency: row.currency,
    status: row.status,
  };
}

/** `/shop2/et/done/?n=R-…&s=failed&o=<id>` — the screen with «Оплатить ещё раз». */
function payAgainUrl(lang: LangCode, row: UnpaidRow): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  const q = new URLSearchParams({ n: row.number, s: "failed", o: row.id });
  return `${baseUrl()}/shop2${seg}/done/?${q.toString()}`;
}

export async function runUnpaidOrders(now: number = Date.now()): Promise<UnpaidRun> {
  const flows = await getFlows();
  if (!flows.unpaid) return { sent: 0, skipped: 0, cancelled: 0, reason: "disabled" };
  await loadTexts();

  const day = 24 * 60 * 60 * 1000;
  const remindBefore = new Date(now - flows.unpaidRemindDays * day).toISOString();
  const cancelBefore = new Date(now - flows.unpaidCancelDays * day).toISOString();

  const { onOrderClosed, onOrderUnpaid } = await import("@/lib/mail-hooks");
  const { setOrderStatus } = await import("@/lib/orders");

  let sent = 0;
  let skipped = 0;
  let cancelled = 0;

  /* ---- 1. the reminder ------------------------------------------------- */
  /* Old enough for the reminder, not yet old enough to be let go, and never
     reminded before. `payment.unpaidRemindedAt` is the stamp: it is written
     BEFORE the letter leaves, because a missed reminder costs one letter and
     a repeated one costs the customer's patience every single day. */
  const waiting = await query<UnpaidRow>(
    `select ${UNPAID_COLUMNS} from orders
      where status in ${UNPAID_STATUSES}
        and coalesce(channel,'web') = 'web'
        and ${NOT_PAID}
        and ${NOT_INVOICE}
        and created_at <= $1
        and created_at > $2
        and (payment->>'unpaidRemindedAt') is null
      order by created_at
      limit ${BATCH}`,
    [remindBefore, cancelBefore],
  );

  for (const row of waiting) {
    await query(
      `update orders set payment = coalesce(payment,'{}'::jsonb) || jsonb_build_object('unpaidRemindedAt', $2::text),
              updated_at = now()
        where id = $1`,
      [row.id, new Date(now).toISOString()],
    );
    if (!row.email) {
      skipped += 1;
      continue;
    }
    const lang = normalizeLangCode(row.lang);
    /* How long this order really has left, not how long the settings say a
       reminder normally leaves: the cron runs once a day and can miss one, so
       an order reminded on its fifth day must not promise four more. */
    const ageDays = Math.floor((now - new Date(row.created_at).getTime()) / day);
    const daysLeft = Math.max(0, flows.unpaidCancelDays - ageDays);
    const res = await onOrderUnpaid(unpaidOrderLike(row), {
      daysLeft,
      payUrl: payAgainUrl(lang, row),
    });
    if (res.ok && !res.skipped) sent += 1;
    else skipped += 1;
  }

  /* ---- 2. the cancellation --------------------------------------------- */
  /* Old enough to be let go. setOrderStatus() writes the journal line and puts
     a counted shelf back where the order had taken any (it had not — an unpaid
     order never decremented stock), and the letter tells the customer, which
     is the half that did not exist before 07.09.2026. */
  const stale = await query<UnpaidRow>(
    `select ${UNPAID_COLUMNS} from orders
      where status in ${UNPAID_STATUSES}
        and coalesce(channel,'web') = 'web'
        and ${NOT_PAID}
        and ${NOT_INVOICE}
        and created_at <= $1
      order by created_at
      limit ${BATCH}`,
    [cancelBefore],
  );

  for (const row of stale) {
    try {
      await setOrderStatus(row.id, "cancelled", "system:unpaid");
    } catch (err) {
      console.error(`[flows] unpaid cancel failed on ${row.number}:`, err);
      skipped += 1;
      continue;
    }
    cancelled += 1;
    if (!row.email) continue;
    const res = await onOrderClosed({ ...unpaidOrderLike(row), status: "cancelled" }, { kind: "cancelled" });
    if (res.ok && !res.skipped) sent += 1;
  }

  return { sent, skipped, cancelled };
}

/* ---------- the scheduler ------------------------------------------------- */

export interface FlowsReport {
  abandoned: FlowRun;
  backstock: FlowRun;
  birthday: FlowRun;
  /** «По счёту»: the reminder and the automatic cancellation — src/lib/invoice-dunning.ts. */
  invoices: { reminded: number; cancelled: number; skipped: number; reason?: string };
  unpaid: UnpaidRun;
  /** «Доставлен» closed without anybody pressing it — src/lib/delivery.ts. */
  delivered: { closed: number; checked: number; returned?: number; reason?: string };
  ms: number;
}

/** What `GET /api/cron/flows` runs. Every branch is independently guarded. */
export async function runFlows(now: number = Date.now()): Promise<FlowsReport> {
  const started = Date.now();
  const out: FlowsReport = {
    abandoned: { sent: 0, skipped: 0, reason: "error" },
    backstock: { sent: 0, skipped: 0, reason: "error" },
    birthday: { sent: 0, skipped: 0, reason: "error" },
    invoices: { reminded: 0, cancelled: 0, skipped: 0, reason: "error" },
    unpaid: { sent: 0, skipped: 0, cancelled: 0, reason: "error" },
    delivered: { closed: 0, checked: 0, reason: "error" },
    ms: 0,
  };
  for (const [key, fn] of [
    ["abandoned", runAbandonedCarts],
    ["backstock", sweepBackInStock],
    ["birthday", runBirthdays],
  ] as const) {
    try {
      out[key] = await fn(now);
    } catch (err) {
      console.error(`[flows] ${key} failed:`, err);
      out[key] = { sent: 0, skipped: 0, reason: "error" };
    }
  }
  /* «Счета для компаний»: one reminder before the due date, then the
     automatic cancellation. Its own module (and its own dynamic import, so
     this file's static graph never reaches src/lib/orders.ts — see the note
     at the top about the cycle). */
  try {
    out.invoices = await (await import("@/lib/invoice-dunning")).runInvoiceDunning(now);
  } catch (err) {
    console.error("[flows] invoices failed:", err);
    out.invoices = { reminded: 0, cancelled: 0, skipped: 0, reason: "error" };
  }
  /* Its own loop because its report carries one more number — how many orders
     were let go — and because it is the only branch that changes an order.
     It deliberately leaves «По счёту» alone: an invoice order has its own
     clock above, counted from the invoice's due date rather than from when
     the order was placed, so letting both run over the same rows would send
     two letters and cancel a company's order on the day its invoice fell
     due. runUnpaidOrders() skips them — see the filter in its query. */
  try {
    out.unpaid = await runUnpaidOrders(now);
  } catch (err) {
    console.error("[flows] unpaid failed:", err);
    out.unpaid = { sent: 0, skipped: 0, cancelled: 0, reason: "error" };
  }
  /* Not a letter — the last step of an order, closed for the owner instead of
     by him (Dim: «we need to improve this»). It rides this job because this is
     the one thing the shop runs on a schedule, and once a day is exactly the
     right frequency for «дошла ли посылка». Loaded lazily and guarded like
     everything else: a carrier that is down must not stop the letters. */
  try {
    const { closeDeliveredOrders } = await import("@/lib/delivery");
    out.delivered = await closeDeliveredOrders(now);
  } catch (err) {
    console.error("[flows] delivered failed:", err);
    out.delivered = { closed: 0, checked: 0, reason: "error" };
  }
  out.ms = Date.now() - started;
  return out;
}

/* ---------- the admin's three counters ------------------------------------ */

export interface FlowCounters {
  /** Carts waiting for a reminder — abandoned, never reminded, no order since. */
  carts: number;
  /** Addresses waiting for a «снова в наличии» letter. */
  alerts: number;
  /** Birthdays in the next seven days, marketing consent given. */
  birthdays: number;
  /** Unpaid orders old enough for the reminder and not reminded yet. */
  unpaid: number;
}

export async function flowCounters(now: number = Date.now()): Promise<FlowCounters> {
  const out: FlowCounters = { carts: 0, alerts: 0, birthdays: 0, unpaid: 0 };
  try {
    const cutoff = new Date(now - ABANDONED_AFTER_MS).toISOString();
    const [carts] = await query<{ n: string | number }>(
      `select count(*)::int as n from carts c
        where c.reminded_at is null and c.recovered_at is null and c.updated_at <= $1
          and not exists (select 1 from orders o where lower(o.email) = c.email and o.created_at >= c.updated_at)`,
      [cutoff],
    );
    out.carts = Number(carts?.n) || 0;
  } catch {
    /* no table yet — zero is the honest answer */
  }
  try {
    const [alerts] = await query<{ n: string | number }>(
      "select count(*)::int as n from stock_alerts where sent_at is null",
    );
    out.alerts = Number(alerts?.n) || 0;
  } catch {
    /* ignored */
  }
  try {
    // Seven days including today, wrapping across the New Year without a
    // calendar library: compare the month/day pair as a number.
    const days: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now + i * 24 * 60 * 60 * 1000);
      days.push((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
    }
    // Placeholders rather than an array parameter: the two drivers disagree
    // about how a JS array becomes a Postgres one, and seven holes cost nothing.
    const holes = days.map((_, i) => `$${i + 1}`).join(",");
    const [bd] = await query<{ n: string | number }>(
      `select count(*)::int as n from customers
        where birthday is not null and marketing = true
          and (extract(month from birthday) * 100 + extract(day from birthday)) in (${holes})`,
      days,
    );
    out.birthdays = Number(bd?.n) || 0;
  } catch {
    /* ignored */
  }
  try {
    const flows = await getFlows();
    const day = 24 * 60 * 60 * 1000;
    const [unpaid] = await query<{ n: string | number }>(
      `select count(*)::int as n from orders
        where status in ${UNPAID_STATUSES}
          and coalesce(channel,'web') = 'web'
          and ${NOT_PAID}
        and ${NOT_INVOICE}
          and created_at <= $1
          and (payment->>'unpaidRemindedAt') is null`,
      [new Date(now - flows.unpaidRemindDays * day).toISOString()],
    );
    out.unpaid = Number(unpaid?.n) || 0;
  } catch {
    /* ignored */
  }
  return out;
}
