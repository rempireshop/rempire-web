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
 * Who may be written to (src/lib/consent.ts): an address on the stop list
 * `mail_optouts` — «Отписаться» from any of the letters — gets no cart
 * reminder and no birthday letter, whatever the tick on its row says; a
 * «снова в наличии» alert is something the shopper asked for by name and is
 * never blocked by it. Every marketing letter carries its own unsubscribe
 * link and the RFC 8058 headers, so the way out is one click from the letter.
 *
 * Deliberately imports `@/lib/db` and not `@/lib/orders`: orders.ts calls back
 * into this file (the back-in-stock hook in `upsertOverride`), and a top-level
 * cycle between the two would be a live hazard for a rarely-exercised path.
 */
import { renderAbandonedCart } from "@/emails/abandoned-cart";
import { renderAbandonedCartDiscount } from "@/emails/abandoned-cart-discount";
import { renderBackInStock } from "@/emails/back-in-stock";
import { renderBirthday } from "@/emails/birthday";
import { baseUrl, normalizeLang } from "@/emails/layout";
import { cleanMailTexts, setMailTextsOverride } from "@/emails/texts";
import { optedOutSet, unsubscribeHeaders, unsubscribeUrl, withdrawnSet } from "@/lib/consent";
import { query } from "@/lib/db";
/* A birthday is a calendar date, so the "today" it is compared against has to
   be a calendar day too — Tallinn's, not Greenwich's (src/lib/day.ts). The
   daily run fires at 07:00 Tallinn, but a hand-started run at half past
   midnight would otherwise still be looking at yesterday's date. */
import { addShopDays, endOfShopDay, shopDay, shopDayStart, ymdParts } from "@/lib/day";
import { sendRendered } from "@/lib/mail";
import { roomFor, warnOwnerOnce } from "@/lib/mail-budget";
import {
  markStockAlertSent,
  normalizeLangCode,
  pendingStockAlerts,
  productsForAlerts,
  pruneCartWrites,
  type AlertProduct,
  type CartLine,
  type LangCode,
  type StockAlertRow,
} from "@/lib/customers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* ---------- settings.flows ------------------------------------------------ */

export interface Flows {
  /**
   * «Брошенная корзина» — the reminder, and the discounted letter that
   * follows it when it did not work. One switch for the pair, the same way
   * `unpaid` carries the reminder and the cancellation: a shop that nudges
   * but never offers anything, or offers a discount to somebody who was
   * never reminded, is neither of the two things Renat asked for.
   */
  abandoned: boolean;
  /**
   * How long a basket has to be quiet before the FIRST letter — Renat,
   * 20.09.2026, via Dim: «add possibility to choose time when the abandoned
   * cart letter (currently 3h) goes out». Three hours is what the constant
   * said and what the shop still does out of the box.
   */
  abandonedHours: number;
  /**
   * …and how many days after that letter the DISCOUNTED one goes out. Counted
   * from `carts.reminded_at`, the day the first letter really left, not from
   * the day the basket went quiet: the cron runs once a day and can miss one,
   * and «after the first one did not work» has to mean a full wait after the
   * first one, whenever it happened to go.
   */
  abandonedDiscountDays: number;
  /** Percent off in that second letter. */
  abandonedDiscountPercent: number;
  /**
   * The basket total below which the second letter is not sent at all — the
   * gate Renat drew himself: under 100 € a plain reminder, over it five per
   * cent after three days. 0 sends it to everybody; it is also the only way
   * to switch the second letter off without switching the first one off with
   * it, so a number above every basket the shop sees is «не отправлять».
   */
  abandonedDiscountMinTotal: number;
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
  /**
   * The day the switch above was last turned ON, `YYYY-MM-DD` on the Tallinn
   * calendar — stamped by the settings route, never typed by anybody. "" for
   * a shop that has never turned it on, and for one that had it on before
   * this stamp existed.
   *
   * What it is for: the backlog. Nothing has ever cancelled an abandoned
   * «новый» order, so the day this switch is first flipped there is a list of
   * them going back to the shop's first month — and the first run releases a
   * hundred of them, each with a «Заказ отменён» letter. Dim, 17.09.2026: let
   * the whole backlog go quietly. The orders are dead either way and a
   * cancellation letter about a six-month-old basket reads as a mistake, not
   * as tidying up.
   *
   * So the stamp is a floor, and runUnpaidOrders() reads it as: an order that
   * was ALREADY past its cancel day when the switch was flipped is released
   * without a letter. Everything placed since is the shop working normally and
   * gets both letters. The cancellation itself is never suppressed — those
   * orders have to go — only the letter about it.
   */
  unpaidFrom: string;
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

/**
 * The longest wait that still makes the first cart letter a REMINDER. A week
 * is already generous — after that the basket is not something the shopper
 * has half-forgotten, it is something they decided against — and the ceiling
 * is what keeps a mistyped «72» in a box labelled «часов» from becoming a
 * letter nobody will connect to anything they did.
 */
export const ABANDONED_MAX_HOURS = 168;

/** The most a basket may have to be worth before the discounted letter goes. */
export const ABANDONED_MAX_MIN_TOTAL = 10_000;

export const FLOW_DEFAULTS: Flows = {
  abandoned: false,
  abandonedHours: 3,
  abandonedDiscountDays: 3,
  abandonedDiscountPercent: 5,
  abandonedDiscountMinTotal: 100,
  birthday: false,
  backstock: false,
  pending: false,
  unpaid: false,
  unpaidRemindDays: 3,
  unpaidCancelDays: 7,
  unpaidFrom: "",
  birthdayCode: "",
  birthdayPercent: 10,
  birthdayDays: 0,
};

/** 1–60 whole days, or the default. The panel clamps too; this is the door. */
function days(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : fallback;
}

/** 1–168 whole hours, or the default. Same door, same posture as days(). */
function hours(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= ABANDONED_MAX_HOURS ? Math.round(n) : fallback;
}

/**
 * A euro floor: 0 («всем») up to the ceiling, two decimals.
 *
 * Deliberately NOT `Number(v)`. Zero is a real answer here — «write to
 * everybody the reminder reached» — and `Number(null)`, `Number([])` and
 * `Number("")` are all 0, so a blob with the field missing, blanked or
 * mangled would silently switch the floor OFF rather than fall back to the
 * hundred euro the owner last saw. A comma is read as a decimal point for the
 * same reason validatePromo does it: the box is typed on a phone.
 */
function euro(v: unknown, fallback: number, max: number): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) return fallback;
  return Math.round(n * 100) / 100;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(1|true|on|yes|да)$/i.test(v.trim());
  if (typeof v === "number") return v !== 0;
  return fallback;
}

/** A stored `YYYY-MM-DD`, or "" for anything that is not one. The stamp is
 *  written by the shop itself (stampUnpaidFloor), but it lives in a jsonb blob
 *  the admin can PUT, so it is read like every other untrusted field here. */
function shopDayOrBlank(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return ymdParts(s) ? s : "";
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
  const cartPercent = Number(f.abandonedDiscountPercent);
  return {
    birthdayDays: Number.isFinite(birthdayN) && birthdayN > 0 ? Math.min(birthdayN, BIRTHDAY_MAX_DAYS) : 0,
    abandoned: bool(f.abandoned, FLOW_DEFAULTS.abandoned),
    abandonedHours: hours(f.abandonedHours, FLOW_DEFAULTS.abandonedHours),
    abandonedDiscountDays: days(f.abandonedDiscountDays, FLOW_DEFAULTS.abandonedDiscountDays),
    /* The same bounds the promo table itself is held to (validatePromo,
       src/lib/promos.ts): this number is written onto a real code, and a
       setting that could ask for 120 % would be a code the checkout refuses
       in front of a customer the letter has already promised a discount. */
    abandonedDiscountPercent:
      Number.isFinite(cartPercent) && cartPercent > 0 && cartPercent <= 90
        ? Math.round(cartPercent)
        : FLOW_DEFAULTS.abandonedDiscountPercent,
    abandonedDiscountMinTotal: euro(
      f.abandonedDiscountMinTotal,
      FLOW_DEFAULTS.abandonedDiscountMinTotal,
      ABANDONED_MAX_MIN_TOTAL,
    ),
    birthday: bool(f.birthday, FLOW_DEFAULTS.birthday),
    backstock: bool(f.backstock, FLOW_DEFAULTS.backstock),
    pending: bool(f.pending, FLOW_DEFAULTS.pending),
    unpaid: bool(f.unpaid, FLOW_DEFAULTS.unpaid),
    unpaidRemindDays: remindDays,
    unpaidCancelDays: cancelDays,
    unpaidFrom: shopDayOrBlank(f.unpaidFrom),
    birthdayCode: typeof f.birthdayCode === "string" ? f.birthdayCode.trim().toUpperCase().slice(0, 40) : "",
    birthdayPercent: Number.isFinite(percent) && percent > 0 && percent <= 90 ? Math.round(percent) : FLOW_DEFAULTS.birthdayPercent,
  };
}

/**
 * The writer's side of `unpaidFrom` — PUT /api/admin/settings calls this for
 * the `flows` key and stores what comes back.
 *
 * One transition matters: the «Заказ ждёт оплаты» switch going OFF → ON. That
 * is the moment the backlog exists, so that is the day stamped. While the
 * switch stays on the stamp is carried through untouched, whatever the panel
 * sent — the form posts the whole blob back on every save and knows nothing
 * about this field. Turning the switch off drops it: if it is ever turned on
 * again, everything that piled up in between is a new backlog and the new
 * day is the honest floor for it.
 *
 * A shop that already had the flow running when this shipped gets no stamp
 * (prev.unpaid is already true), which is right: its backlog was posted
 * months ago and there is nothing left to keep quiet about.
 *
 * Best effort on the READ of the previous value — a settings row that cannot
 * be read leaves the incoming blob alone rather than refusing the save. The
 * worst case is a floor that is not stamped, i.e. exactly today's behaviour.
 */
export async function stampUnpaidFloor(next: unknown, now: number = Date.now()): Promise<unknown> {
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const incoming = { ...(next as Record<string, unknown>) };
  let prev: Flows;
  try {
    prev = await getFlows();
  } catch {
    return next;
  }
  const on = bool(incoming.unpaid, FLOW_DEFAULTS.unpaid);
  if (!on) {
    delete incoming.unpaidFrom;
    return incoming;
  }
  if (prev.unpaid) {
    /* Already on. Carry the stamp the shop holds, never the one the caller
       sent: this field is the shop's own memory of a day, and a blob posted
       to /api/admin/settings must not be able to move the floor. */
    if (prev.unpaidFrom) incoming.unpaidFrom = prev.unpaidFrom;
    else delete incoming.unpaidFrom;
    return incoming;
  }
  incoming.unpaidFrom = shopDay(now);
  return incoming;
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
 *
 * `code` is the second letter's promo (`p` in the payload), and it rides
 * INSIDE the token rather than beside it in the query string for one reason:
 * the storefront strips the whole query the moment it has read the token
 * (`history.replaceState` in resumeCart(), public/shop2/app.js), so anything
 * parked next to `resume=` is gone before it could be applied. Omitted
 * entirely for the first letter, which has no code — an older reader that
 * knows nothing about `p` simply restores the basket, exactly as it does now.
 */
export function makeResumeToken(items: CartLine[], now: number = Date.now(), code?: string | null): string {
  const promo = String(code ?? "").trim().toUpperCase();
  const payload = JSON.stringify({
    v: 1,
    exp: now + RESUME_TTL_MS,
    i: items.slice(0, 50).map((l) => ({ id: l.id, s: l.size, q: l.qty })),
    ...(promo ? { p: promo } : {}),
  });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export interface ResumePayload {
  items: Array<{ id: string; size: number | null; qty: number }>;
  /** The promo code the letter offered, "" when it offered none. */
  code: string;
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
    /* The same normalisation normalisePromoCode() applies (src/lib/promos.ts),
       said here rather than imported: this module is loaded by the cron and by
       the storefront's own route, and the promo table is not a dependency of
       reading a signed link. A code that survives this is still only a
       CANDIDATE — the checkout looks it up and prices it like any other. */
    const promo = String(raw.p ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 24);
    return {
      code: /^[A-Z0-9-]+$/.test(promo) && /[A-Z0-9]/.test(promo) ? promo : "",
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

/** `/shop2/et/checkout/?resume=…`, absolute. `code` rides inside the token. */
function resumeUrl(lang: LangCode, items: CartLine[], code?: string | null): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  const token = makeResumeToken(items, Date.now(), code);
  return `${baseUrl()}/shop2${seg}/checkout/?resume=${encodeURIComponent(token)}`;
}

function productUrl(lang: LangCode, id: string): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  return `${baseUrl()}/shop2${seg}/p/${encodeURIComponent(id)}/`;
}

/* ---------- «Брошенная корзина» ------------------------------------------- */

/**
 * Every reason a row did not get its letter, and how many rows each one cost.
 *
 * Renat, 13.09.2026: «I filled out e-mail and left cart, tried to send now but
 * nothing arrived» — and the run reported «отправлено 0 · пропущено 0», which
 * is the report of a job that did nothing AND of a job that found nothing.
 * The two are different answers to the only question he was asking, so a run
 * now names what it walked past. Keys are the stable codes below; the panel
 * turns them into words.
 */
export type SkipCounts = Record<string, number>;

export interface FlowRun {
  sent: number;
  skipped: number;
  /** The single reason worth printing on one line — the biggest of `skips`, or a run-wide refusal. */
  reason?: string;
  /** Every reason, counted. Empty when a run sent everything it found. */
  skips?: SkipCounts;
}

/* The vocabulary. Nothing outside this list is ever written to
   `settings.flow_runs`, so the panel's dictionary can be complete. */
export const SKIP_REASONS = [
  /* the switch, the key, the address — nothing was even attempted */
  "disabled",
  "no_api_key",
  "no_email",
  "error",
  /* rows the run walked past */
  "opted_out",
  "empty_cart",
  "no_promo_code",
  "send_failed",
  /* rows the query never selected — why the queue looked empty */
  "too_fresh",
  "already_sent",
  "ordered_since",
  "recovered",
  "no_birthday",
  "no_marketing",
  "not_in_window",
  /* the second cart letter's own two: the first letter has not gone yet, and
     the basket is worth less than «Скидка от … €» asks for */
  "no_reminder",
  "below_min",
  /* the day's marketing allowance is spent — cap minus the reserve held for
     order letters, or Resend's own quota (src/lib/mail-budget.ts). Nothing is
     wrong and nothing is lost: the rows are not stamped, so tomorrow's run
     picks up exactly where this one stopped. */
  "no_budget",
  /* …and when not one of the counts above is anything but zero: there is
     nobody this letter could go to at all. Said out loud, because «отправлено
     0» with nothing beside it is what «the sender is broken» looks like. */
  "nobody",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export function isSkipReason(v: unknown): v is SkipReason {
  return (SKIP_REASONS as readonly string[]).includes(String(v));
}

/** A counter that also keeps the running total — the two used to drift apart. */
function counter() {
  const skips: SkipCounts = {};
  let total = 0;
  return {
    /** One row skipped for this reason. */
    add(reason: SkipReason, n = 1): void {
      if (n <= 0) return;
      skips[reason] = (skips[reason] ?? 0) + n;
      total += n;
    },
    /** A reason that explains an empty queue — counted, but not a skipped send. */
    note(reason: SkipReason, n: number): void {
      if (n > 0) skips[reason] = (skips[reason] ?? 0) + n;
    },
    get skipped(): number {
      return total;
    },
    /** The biggest reason — what the one-line «Последний запуск» says. */
    get top(): string | undefined {
      let best: string | undefined;
      let n = 0;
      for (const [k, v] of Object.entries(skips)) if (v > n) { best = k; n = v; }
      return best;
    },
    get map(): SkipCounts | undefined {
      return Object.keys(skips).length ? skips : undefined;
    },
  };
}

/** Whatever the mail layer refused with, mapped onto the vocabulary above. */
function sendSkip(res: { ok: boolean; skipped?: boolean; error?: string }): SkipReason {
  if (res.error === "no_api_key") return "no_api_key";
  if (res.error === "no_recipient" || res.error === "bad_email") return "no_email";
  return "send_failed";
}

/**
 * How many letters this run may send today — src/lib/mail-budget.ts.
 *
 * Three of the flows below are marketing (the cart reminder, its discounted
 * follow-up, the birthday greeting): nobody asked for them, so they are the
 * ones that stop when the day's allowance is down to the reserve held for
 * order letters. «Снова в наличии» is not one of them — a shopper left their
 * address against a named product and is owed the answer — and neither is the
 * unpaid reminder, which is about an order that already exists.
 *
 * The run never sends more than this many, and it never STAMPS a row it did
 * not send to: a cart with no `reminded_at` is a cart tomorrow's run still
 * owes a letter. The owner hears about it once a day, on his phone.
 */
async function marketingRoom(): Promise<number> {
  const room = await roomFor("marketing");
  if (room <= 0) await warnOwnerOnce();
  return room;
}

/** Exported so «Брошенные корзины» on «Аналитика» can count the same carts this
    letter writes to — src/lib/analytics.ts holds a copy and a test ties them.

    Since 20.09.2026 this is the DEFAULT rather than the rule: the wait is
    `settings.flows.abandonedHours` and the owner picks it (Renat: «add
    possibility to choose time when the abandoned cart letter (currently 3h)
    goes out»). Analytics still counts on three hours, because «Брошенные
    корзины» is a figure about baskets and not about letters, and a shop that
    moves the letter to twelve hours has not changed what an abandoned basket
    is. The two only have to agree out of the box, which is what the tie-test
    checks. */
export const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

/** The owner's wait in milliseconds. */
function abandonedAfterMs(flows: Flows): number {
  return flows.abandonedHours * 60 * 60 * 1000;
}

const BATCH = 100;

/**
 * One reminder per abandoned cart, `flows.abandonedHours` after the last
 * change (three by default, which is what it always was), and only when no
 * order has arrived from that address since.
 *
 * `reminded_at` is stamped **before** the send, not after: a crash between the
 * two costs one letter, while the other order costs the customer a second copy
 * every time the cron runs.
 *
 * An address on the stop list (`mail_optouts` — the person pressed
 * «Отписаться» in an earlier letter) is skipped and its cart stamped the same
 * way: it must not be re-selected and re-counted on every run, and no letter
 * is exactly what was asked for. `reason: "opted_out"` in the report says how
 * many.
 *
 * So is an address whose customer row says the tick was switched OFF by hand
 * (`marketing = false` with a `marketing_off_at` stamp — the account form or
 * the owner). The tick is not what this letter runs on: a guest who abandons
 * a basket at the checkout has no customers row at all and still gets the
 * reminder, which is what 052_marketing_consent.sql chose. But somebody who
 * went into «Кабинет» and unticked has said no to marketing mail in the only
 * place the shop offers, and this letter carries the marketing unsubscribe
 * link and the RFC 8058 headers — so «the latest expression of will wins»
 * (src/lib/consent.ts) has to hold here too. Never ticking is not saying no;
 * only the off-stamp is.
 */
export async function runAbandonedCarts(now: number = Date.now()): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.abandoned) return { sent: 0, skipped: 0, reason: "disabled", skips: { disabled: 1 } };
  await loadTexts();
  let roomLeft = await marketingRoom();
  if (roomLeft <= 0) return { sent: 0, skipped: 0, reason: "no_budget", skips: { no_budget: 1 } };

  const cutoff = new Date(now - abandonedAfterMs(flows)).toISOString();
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

  /* Read before any stamp goes down: a stop list that cannot be read means
     this run sends nothing (the throw is caught in runFlows), never "send to
     everybody and hope". */
  const blocked = await optedOutSet(rows.map((r) => r.email));
  for (const email of await withdrawnSet(rows.map((r) => r.email))) blocked.add(email);

  let sent = 0;
  const skips = counter();
  for (const row of rows) {
    /* Before the stamp, always: a row this run will not write to must stay
       exactly as it was, or tomorrow's run would skip a cart that never got
       its letter. */
    if (roomLeft <= 0) {
      skips.add("no_budget");
      continue;
    }
    const items = parseItems(row.items);
    if (!items.length) {
      await query("update carts set reminded_at = now() where id = $1", [row.id]);
      skips.add("empty_cart");
      continue;
    }
    await query("update carts set reminded_at = now() where id = $1", [row.id]);
    if (blocked.has(row.email)) {
      skips.add("opted_out");
      continue;
    }
    const lang = normalizeLangCode(row.lang);
    const mail = renderAbandonedCart(
      {
        email: row.email,
        lang,
        items,
        total: Number(row.total) || undefined,
        unsubscribeUrl: unsubscribeUrl(row.email, lang, "marketing"),
      },
      normalizeLang(lang),
      resumeUrl(lang, items),
    );
    const res = await sendRendered(row.email, mail, {
      tags: { template: "abandoned-cart", lang: lang.toLowerCase() },
      idempotencyKey: `cart:${row.id}`,
      headers: unsubscribeHeaders(row.email, lang, "marketing"),
      kind: "marketing",
    });
    if (res.ok && !res.skipped) {
      sent += 1;
      roomLeft -= 1;
    } else {
      skips.add(sendSkip(res));
      // Resend's own daily quota: nothing else is going out today, whatever
      // our counter says. The rest of the queue is left for tomorrow.
      if (res.quota) roomLeft = 0;
    }
  }
  /* The queue was empty: say what it was full of instead of reporting a bare
     zero. This is the one question «Запустить сейчас» exists to answer — Renat
     pressed it two minutes after leaving a basket and the panel said
     «отправлено 0 · пропущено 0», which reads as «the sender is broken». Only
     when nothing was walked at all: a run that already has real reasons must
     not count the same cart twice, once as skipped and once as stamped. */
  if (!sent && !skips.skipped) await explainEmptyCartQueue(skips, cutoff);
  return { sent, skipped: skips.skipped, reason: skips.top, skips: skips.map };
}

/**
 * Why the cart queue was empty — the same four conditions the query above
 * applies, counted rather than silently subtracted.
 *
 * Best effort, like every other diagnostic here: a shop with no `carts` table
 * yet must not turn a quiet run into a failed one.
 */
async function explainEmptyCartQueue(skips: ReturnType<typeof counter>, cutoff: string): Promise<void> {
  try {
    const [row] = await query<Record<string, string | number>>(
      `select
         count(*) filter (where c.reminded_at is not null)::int as already_sent,
         count(*) filter (where c.reminded_at is null and c.recovered_at is not null)::int as recovered,
         count(*) filter (where c.reminded_at is null and c.recovered_at is null
                            and c.updated_at > $1)::int as too_fresh,
         count(*) filter (where c.reminded_at is null and c.recovered_at is null
                            and c.updated_at <= $1
                            and exists (select 1 from orders o
                                         where lower(o.email) = c.email
                                           and o.created_at >= c.updated_at))::int as ordered_since
       from carts c`,
      [cutoff],
    );
    if (!row) return;
    skips.note("already_sent", Number(row.already_sent) || 0);
    skips.note("recovered", Number(row.recovered) || 0);
    skips.note("too_fresh", Number(row.too_fresh) || 0);
    skips.note("ordered_since", Number(row.ordered_since) || 0);
    if (!skips.map) skips.note("nobody", 1); // not one cart in the table
  } catch (err) {
    console.warn("[flows] cart queue could not be explained:", (err as Error)?.message);
  }
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

/* ---------- «Брошенная корзина» — письмо со скидкой ----------------------- */

/** `REM-CART-7QK4X9` — the same readable alphabet the birthday code uses, and
 *  a prefix that says at a glance which letter wrote it. */
export function cartPromoCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `REM-CART-${out}`;
}

/** What the second letter has to carry. */
interface CartPromo {
  code: string;
  expires: Date;
}

/**
 * A single-use code for ONE basket, on the `cart` scope
 * (db/migrations/197_abandoned_cart_discount.sql). Null means «there is no
 * code to send», and then no letter goes out at all: a discount letter whose
 * code does nothing is worse than silence, exactly as it is for a birthday.
 *
 * Unlike promoForBirthday() there is **no static fallback and no `createPromo`
 * spelling**. Both of those would produce a code the shop could not narrow,
 * and an unnarrowed five per cent is a five per cent off the whole shop handed
 * to everybody who ever abandoned a basket — the opposite of what Renat asked
 * for («preferably ONLY for the cart»). A database that has not run migration
 * 197 refuses the row for the same reason, and that refusal must stay a
 * refusal, so what comes back is checked rather than assumed.
 *
 * The code dies with the link that carries it (RESUME_TTL_MS), at the end of
 * that Tallinn day. Longer would be a code nobody can reach by the route the
 * letter offers; shorter would be a button that restores a basket whose
 * promise has already run out.
 */
async function promoForCart(
  flows: Flows,
  cartId: string,
  lines: CartLine[],
  now: number,
): Promise<CartPromo | null> {
  const ids = [...new Set(lines.map((l) => l.id).filter(Boolean))].slice(0, 50);
  if (!ids.length) return null;
  const expires = endOfShopDay(new Date(now + RESUME_TTL_MS));
  try {
    const mod = (await import("@/lib/promos")) as unknown as {
      upsertPromo?: (input: Record<string, unknown>) => Promise<{ scope?: string; scopeLines?: string[] | null }>;
    };
    if (!mod.upsertPromo) return null;
    const code = cartPromoCode();
    const saved = await mod.upsertPromo({
      code,
      kind: "percent",
      value: flows.abandonedDiscountPercent,
      minSubtotal: 0,
      startsAt: null,
      endsAt: expires.toISOString(),
      maxUses: 1,
      active: true,
      note: "Брошенная корзина — код выписан автоматически",
      scope: "cart",
      scopeValue: cartId,
      scopeLines: ids,
    });
    if (saved?.scope !== "cart" || !saved.scopeLines?.length) return null;
    return { code, expires };
  } catch (err) {
    console.warn("[flows] cart promo not written:", (err as Error)?.message);
    return null;
  }
}

/**
 * Take back the code this run minted for a letter that never went — the same
 * tidying dropBirthdayPromo() does, and for the same reason: a skipped send
 * (no Resend key, no address) puts the stamp back so the letter goes as soon
 * as mail works, and the next run mints another code. Best effort; deletePromo
 * refuses a code that has been used, which is exactly the one that must stay.
 */
async function dropCartPromo(code: string): Promise<void> {
  try {
    const mod = (await import("@/lib/promos")) as unknown as {
      deletePromo?: (code: string) => Promise<unknown>;
    };
    await mod.deletePromo?.(code);
  } catch (err) {
    console.warn("[flows] cart code left behind:", (err as Error)?.message);
  }
}

/**
 * The second letter: the one with the discount, for the baskets the first
 * letter did not bring back.
 *
 * Renat, 20.09.2026, via Dim: «after first one did not work we send out
 * another mail with discount.» Three questions, and the shop can answer all
 * three from its own rows:
 *
 *   · did the first letter go?      `reminded_at is not null`
 *   · was that long enough ago?     `reminded_at <= now − abandonedDiscountDays`
 *   · did it work?                  no order from that address since the basket
 *                                   went quiet, and `recovered_at` still null
 *
 * «Did it work» is deliberately NOT «did they open it» or «did they click».
 * Apple Mail Privacy Protection fetches every image in every letter from its
 * own proxy and prefetches links, so both of those columns would be full of
 * confident nonsense — and the customer this flow exists for, the one who
 * really did ignore the letter, would be the one the shop decided had read it.
 * An order is a fact.
 *
 * `discount_at` is stamped **before** the send, the rule runAbandonedCarts()
 * already follows: a crash between the two costs one letter; the other order
 * costs the customer a second five-per-cent code every day the cron runs.
 *
 * The basket floor is the owner's (`abandonedDiscountMinTotal`, 100 € out of
 * the box — Renat's own line). A basket under it is stamped and walked past:
 * it had its reminder, and the shop does not buy back a 12 € order.
 *
 * An address on the stop list, or one whose customer row says the tick was
 * switched off by hand, gets nothing — the same two sets the first letter
 * subtracts, read before any stamp goes down.
 */
/** How early the second letter may go, so a daily run lands on its day (see the cutoff below). */
export const DISCOUNT_RUN_SLACK_MS = 60 * 60 * 1000;

export async function runAbandonedCartsDiscount(now: number = Date.now()): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.abandoned) return { sent: 0, skipped: 0, reason: "disabled", skips: { disabled: 1 } };
  await loadTexts();
  let roomLeft = await marketingRoom();
  if (roomLeft <= 0) return { sent: 0, skipped: 0, reason: "no_budget", skips: { no_budget: 1 } };

  /* One hour of slack. The first letter is stamped by the daily run itself
     (10:00:55 on 25.09.2026), and the next daily run starts at the same
     minute — so a strict «N days» was a few seconds short every time and the
     discount slipped a whole extra day. With the slack, «через 1 день» is the
     next daily run, which is what the owner set. */
  const cutoff = new Date(now - flows.abandonedDiscountDays * 24 * 60 * 60 * 1000 + DISCOUNT_RUN_SLACK_MS).toISOString();
  const minTotal = flows.abandonedDiscountMinTotal;
  const rows = await query<{
    id: string;
    email: string;
    lang: string;
    items: unknown;
    total: string | number;
  }>(
    `select c.id, c.email, c.lang, c.items, c.total
       from carts c
      where c.reminded_at is not null
        and c.discount_at is null
        and c.recovered_at is null
        and c.reminded_at <= $1
        and c.total >= $2
        and not exists (
          select 1 from orders o
           where lower(o.email) = c.email and o.created_at >= c.updated_at
        )
      order by c.reminded_at
      limit ${BATCH}`,
    [cutoff, minTotal],
  );

  /* Read before any stamp goes down, exactly as the first letter does: a stop
     list that cannot be read means this run sends nothing (the throw is caught
     in runFlows), never «send to everybody and hope». */
  const blocked = await optedOutSet(rows.map((r) => r.email));
  for (const email of await withdrawnSet(rows.map((r) => r.email))) blocked.add(email);

  let sent = 0;
  const skips = counter();
  for (const row of rows) {
    /* Before the stamp and before a code is written: a basket this run cannot
       write to keeps both, and tomorrow's run makes it the same offer. */
    if (roomLeft <= 0) {
      skips.add("no_budget");
      continue;
    }
    const items = parseItems(row.items);
    if (!items.length) {
      await query("update carts set discount_at = now() where id = $1", [row.id]);
      skips.add("empty_cart");
      continue;
    }
    if (blocked.has(row.email)) {
      /* Stamped, like the first letter stamps them: the row must not be
         re-selected and re-counted on every run, and no letter is exactly
         what the person asked for. */
      await query("update carts set discount_at = now() where id = $1", [row.id]);
      skips.add("opted_out");
      continue;
    }
    const promo = await promoForCart(flows, row.id, items, now);
    if (!promo) {
      /* No code, no letter, and no stamp: this basket is still owed the offer
         the moment codes can be written again. */
      skips.add("no_promo_code");
      continue;
    }
    // Stamped first: a repeat is worse than a miss (see runAbandonedCarts).
    await query("update carts set discount_at = now(), discount_code = $2 where id = $1", [row.id, promo.code]);
    const lang = normalizeLangCode(row.lang);
    const mail = renderAbandonedCartDiscount(
      {
        email: row.email,
        lang,
        items,
        total: Number(row.total) || undefined,
        unsubscribeUrl: unsubscribeUrl(row.email, lang, "marketing"),
      },
      normalizeLang(lang),
      resumeUrl(lang, items, promo.code),
      { code: promo.code, percent: flows.abandonedDiscountPercent, expires: promo.expires },
    );
    const res = await sendRendered(row.email, mail, {
      tags: { template: "abandoned-cart-discount", lang: lang.toLowerCase() },
      idempotencyKey: `cart-discount:${row.id}`,
      headers: unsubscribeHeaders(row.email, lang, "marketing"),
      kind: "marketing",
    });
    if (res.ok && !res.skipped) {
      sent += 1;
      roomLeft -= 1;
    } else {
      skips.add(sendSkip(res));
      // Resend's own daily quota — the rest of this queue is tomorrow's.
      if (res.quota) roomLeft = 0;
      /* Skipped, not failed: the mail layer did not even try (no key, no
         address). Nothing reached anybody, so the stamp and the code both come
         off — the basket is owed this letter as soon as mail works, and the
         next run writes a fresh code. A real failure keeps both: Resend was
         asked, and a retry from here would be the second code the stamp exists
         to stop. */
      if (res.skipped) {
        await query(
          "update carts set discount_at = null, discount_code = null where id = $1 and discount_code = $2",
          [row.id, promo.code],
        );
        await dropCartPromo(promo.code);
      }
    }
  }
  /* The queue was empty: say what it was full of, the way the first letter
     does. Only when nothing was walked at all — a run that already has real
     reasons must not count the same cart twice. */
  if (!sent && !skips.skipped) await explainEmptyDiscountQueue(skips, cutoff, minTotal);
  return { sent, skipped: skips.skipped, reason: skips.top, skips: skips.map };
}

/**
 * Why nobody was due the discounted letter — the five conditions the query
 * above applies, counted rather than silently subtracted. Best effort, like
 * every other diagnostic here.
 */
async function explainEmptyDiscountQueue(
  skips: ReturnType<typeof counter>,
  cutoff: string,
  minTotal: number,
): Promise<void> {
  try {
    const [row] = await query<Record<string, string | number>>(
      `select
         count(*) filter (where c.reminded_at is null and c.recovered_at is null)::int as no_reminder,
         count(*) filter (where c.discount_at is not null)::int as already_sent,
         count(*) filter (where c.discount_at is null and c.recovered_at is not null)::int as recovered,
         count(*) filter (where c.reminded_at is not null and c.discount_at is null
                            and c.recovered_at is null and c.reminded_at > $1)::int as too_fresh,
         count(*) filter (where c.reminded_at is not null and c.discount_at is null
                            and c.recovered_at is null and c.reminded_at <= $1
                            and c.total < $2)::int as below_min,
         count(*) filter (where c.reminded_at is not null and c.discount_at is null
                            and c.recovered_at is null and c.reminded_at <= $1
                            and c.total >= $2
                            and exists (select 1 from orders o
                                         where lower(o.email) = c.email
                                           and o.created_at >= c.updated_at))::int as ordered_since
       from carts c`,
      [cutoff, minTotal],
    );
    if (!row) return;
    skips.note("no_reminder", Number(row.no_reminder) || 0);
    skips.note("already_sent", Number(row.already_sent) || 0);
    skips.note("recovered", Number(row.recovered) || 0);
    skips.note("too_fresh", Number(row.too_fresh) || 0);
    skips.note("below_min", Number(row.below_min) || 0);
    skips.note("ordered_since", Number(row.ordered_since) || 0);
    if (!skips.map) skips.note("nobody", 1); // not one cart in the table
  } catch (err) {
    console.warn("[flows] discount queue could not be explained:", (err as Error)?.message);
  }
}

/* ---------- «Товар снова в наличии» --------------------------------------- */

/**
 * Everybody waiting for one product gets one letter. Called the moment the
 * product comes BACK — from «нет в наличии» to anything the shop sells, «мало»
 * included: `upsertOverride` in src/lib/orders.ts for the owner's own
 * «Наличие» word, move()/setQty() in src/lib/inventory.ts for a size counted
 * up from zero. Deciding what a comeback is belongs to those two callers;
 * this only sends.
 *
 * …as long as the shop agrees. The owner writing «в наличии» is one of two
 * voices on that question: for a product anybody has actually counted, the
 * COUNT is what the storefront's badge reads (getOverrides() in
 * src/lib/orders.ts, and the same merge the sweep below does). So the switch
 * could be flipped on a shelf the scanner had already counted down to zero,
 * and the shop would post «Снова в наличии» over a page that says «нет в
 * наличии». Dim, 17.09.2026: do not send when the count is zero — the shop
 * must not contradict itself in writing. And the other way round: a count
 * coming up from zero may not talk past the owner's «Снять с продажи» (a
 * manual «нет в наличии»), which the page goes on showing however full the
 * shelf is. Both are one question — what does the storefront say? — asked of
 * shopStockOf(), which merges the three voices the way the page does.
 *
 * Nothing is stamped when that happens: the alerts stay pending, and the
 * daily sweep sends them the day the page really says something is there.
 */
export async function runBackInStock(productId: string): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.backstock) return { sent: 0, skipped: 0, reason: "disabled", skips: { disabled: 1 } };
  if ((await shopStockOf(productId)) === "out") return { sent: 0, skipped: 0 };
  /* The owner's own subject / intro / signature, exactly as the sweep below
     loads them. This is the PRIMARY path — the stock switch in the panel calls
     it (upsertOverride, src/lib/orders.ts) — and without this line the letter
     was rendered against whatever the process happened to be holding: the
     built-in defaults on a cold serverless start, so the text Renat saved in
     «Письма» was silently dropped from the very letter it was written for. */
  await loadTexts();
  const alerts = await pendingStockAlerts(productId);
  return sendStockAlerts(alerts);
}

/**
 * The storefront's own word for a product, from its three voices, in the
 * order getOverrides() in src/lib/orders.ts merges them for the badge and the
 * buy button: the owner's manual «нет в наличии» is «Снять с продажи» and
 * beats any count; otherwise the count, for a product anybody has counted
 * (src/lib/inventory.ts, «tracked»); otherwise the owner's manual word;
 * otherwise the catalogue file's own.
 *
 * «мало» is on sale. Only "out" is not.
 */
export function shopStock(
  manual: string | null | undefined,
  counted: string | null | undefined,
  file: string | null | undefined,
): string {
  if (manual === "out") return "out";
  return counted || manual || file || "out";
}

/**
 * shopStock() for one product, read now — null for a product neither the
 * catalogue nor the owner's own rows know (the caller treats its alerts as
 * spent, as sendStockAlerts() always has).
 *
 * Best effort on the two optional voices, exactly as sweepBackInStock() reads
 * the same numbers: no overrides table, or an inventory module that cannot
 * answer, leaves the voices that did answer in charge — which is what the
 * hook did before the question was asked at all. Dynamically imported from
 * @/lib/inventory, never statically: see this module's note on the cycle.
 */
export async function shopStockOf(productId: string): Promise<string | null> {
  const p = (await productsForAlerts([productId])).get(productId);
  if (!p) return null;
  let manual: string | null = null;
  try {
    const rows = await query<{ stock: string | null }>("select stock from product_overrides where product_id = $1", [productId]);
    manual = rows.length ? rows[0].stock : null;
  } catch {
    /* no overrides table — the catalogue's own stock is the answer */
  }
  let counted: string | undefined;
  try {
    const { productStockStates } = await import("@/lib/inventory");
    counted = (await productStockStates([productId]))[productId];
  } catch (err) {
    console.error("[flows] numeric stock unavailable, trusting the switch:", err);
  }
  return shopStock(manual, counted, p.stock);
}

/**
 * The scheduler's safety net for the case the switch was off, or the stock
 * moved through a settings change rather than through `upsertOverride`: every
 * pending alert whose product now reads «в наличии» is sent.
 */
export async function sweepBackInStock(): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.backstock) return { sent: 0, skipped: 0, reason: "disabled", skips: { disabled: 1 } };
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

  /* inventory: and the count, which is what the shop's own badge reads for a
     product anybody has actually counted (productStockStates(); the merge
     lives in getOverrides() in src/lib/orders.ts — imported dynamically from
     @/lib/inventory, never from orders.ts, see this module's own note about
     the cycle). Deciding on `product_overrides.stock` alone meant a product
     counted down to 0 whose old manual value still said «в наличии» mailed
     «снова в наличии» to everyone waiting — and marked the alert spent, so
     the letter they were owed never came. */
  const counted = new Map<string, string>();
  try {
    const { productStockStates } = await import("@/lib/inventory");
    for (const [id, state] of Object.entries(await productStockStates(ids))) counted.set(id, state);
  } catch (err) {
    console.error("[flows] numeric stock unavailable, deciding on the override:", err);
  }

  /* The catalogue file and the owner's own rows (`c-…`) in one map: a custom
     product that is on sale reads "in" from its row and "out" from the
     override the owner switched — exactly the one this sweep is waiting on. */
  const products = await productsForAlerts(ids);
  const ready = alerts.filter((a) => {
    const p = products.get(a.product_id);
    if (!p) return false;
    // the same order getOverrides() merges in: a manual «нет в наличии» is
    // «Снять с продажи» and beats any count; otherwise the count wins, and
    // an uncounted product falls back to the override, then to the file
    const stock = shopStock(overrides.get(a.product_id), counted.get(a.product_id), p.stock);
    /* «not out», not «in» — the same rule runBackInStock() applies, and the
       owner's decision of 17.09.2026 says it in those words: the letter does
       not go at a counted ZERO. «Мало» is something on the shelf, and telling
       somebody who asked to be told that the last bottle is there is exactly
       what they asked for. The two halves disagreed until 19.09.2026: the hook
       sent at «мало» and this sweep held the letter back, so whether a waiting
       customer heard anything depended on which of the two happened to notice
       the stock move first (audit F42). */
    return stock !== "out";
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
    /* Stamped first: a repeat is worse than a miss (see runAbandonedCarts).
       …and only by the run whose stamp took the row from pending: another
       run that read the same row a moment earlier — the owner's «мало» and a
       scanner count landing together, or either and the daily sweep — has
       already written, and this one says nothing. */
    if (!(await markStockAlertSent(alert.id))) continue;
    const lang = normalizeLangCode(alert.lang);
    /* Kind "backstock", not "marketing": this letter was asked for by name,
       so the stop list does not apply to it — and its own link cancels the
       person's other pending alerts rather than only the tick. */
    const mail = renderBackInStock(
      {
        id: p.id,
        brand: p.brand,
        title: p.name,
        price: p.price,
        url: productUrl(lang, p.id),
        unsubscribeUrl: unsubscribeUrl(alert.email, lang, "backstock"),
      },
      normalizeLang(lang),
    );
    const res = await sendRendered(alert.email, mail, {
      tags: { template: "back-in-stock", lang: lang.toLowerCase() },
      idempotencyKey: `stock:${alert.id}`,
      headers: unsubscribeHeaders(alert.email, lang, "backstock"),
    });
    if (res.ok && !res.skipped) sent += 1;
    else {
      skipped += 1;
      /* Skipped, not failed: the mail layer did not even try (no key, no
         address). Nothing reached anybody, so the stamp comes off — exactly
         as the birthday flow does it (runBirthdays below). Without this a
         shop whose Resend key arrives next week burns the whole waiting
         list: every «сообщите, когда появится» is marked sent and no letter
         ever goes out. A real failure keeps the stamp: Resend was asked, and
         a retry from here would be the double letter the stamp exists to
         stop. */
      if (res.skipped) {
        await query("update stock_alerts set sent_at = null where id = $1", [alert.id]);
      }
    }
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
 * The letter can be sent up to `birthdayDays` days early, and the code is
 * written on the day the letter goes out — so a fixed fourteen days meant the
 * head start ate into them: «за 14 дней» handed the customer a code that
 * expired exactly on his birthday, which is the one day it was bought for.
 * Dim, 08.09.2026: extend the code's life by the head start. `daysAhead` is
 * the REAL distance to this customer's birthday on the day the letter goes —
 * since the window became tolerant (runBirthdays) a letter set for «за 3 дня»
 * may go out two days early or on the day itself, and either way the customer
 * has the same fourteen usable days starting on the birthday.
 */
function birthdayCodeDays(daysAhead: number): number {
  return BIRTHDAY_DAYS + Math.max(0, daysAhead);
}

/** `REM-BD-7QK4X9` — readable, unambiguous, never confused with a gift card. */
export function birthdayCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `REM-BD-${out}`;
}

/** What a birthday run has to send, and whether this run created it. */
interface BirthdayPromo {
  code: string;
  expires: Date;
  /**
   * True when THIS call wrote a fresh row into `promo_codes`. The letter can
   * still be skipped afterwards (no Resend key, no address) and then the code
   * has to go with it — see dropBirthdayPromo(). False for the static
   * `settings.flows.birthdayCode`, which is the owner's own and outlives every
   * run.
   */
  minted: boolean;
}

/**
 * A real, single-use promo when the promo module exists (the checkout agent's
 * `src/lib/promos.ts`), otherwise the static `settings.flows.birthdayCode`.
 * Null means "there is no code to send" — and then no letter goes out, because
 * a birthday letter with a code that does nothing is worse than silence.
 */
async function promoForBirthday(flows: Flows, now: number, daysAhead: number): Promise<BirthdayPromo | null> {
  /* To the END of that Tallinn day, not to the o'clock the cron ran at.
     The letter prints a calendar date and says «до … включительно»
     (src/emails/birthday.ts), while the checkout refuses the code the instant
     `endsAt` passes (quoteFromPromo, src/lib/promos.ts) — so a plain
     «now + 14 days» killed the code halfway through the last day the customer
     had been promised, and the shop said «промокод истёк» on a day its own
     letter called valid. */
  const expires = endOfShopDay(new Date(now + birthdayCodeDays(daysAhead) * 24 * 60 * 60 * 1000));
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
      return { code, expires, minted: true };
    }
    if (mod.createPromo) {
      await mod.createPromo({
        code,
        kind: "percent",
        value: flows.birthdayPercent,
        ends_at: expires,
        max_uses: 1,
      });
      return { code, expires, minted: true };
    }
  } catch (err) {
    // No module, no table, or it refused: fall through to the static code.
    console.warn("[flows] promo module unavailable:", (err as Error)?.message);
  }
  return flows.birthdayCode ? { code: flows.birthdayCode, expires, minted: false } : null;
}

/**
 * Take back the code this run minted for a letter that never went.
 *
 * The code is written before the send is even attempted, and a skipped send
 * (no Resend key, no address) puts the stamp back so the customer is greeted
 * as soon as letters work again — which means the next run mints another one.
 * Without this, a shop waiting for its Resend key grew one dead `REM-BD-…`
 * row per customer per day in the list the owner scrolls by hand.
 *
 * Only ever a code THIS run wrote (`minted`), and only one still untouched:
 * deletePromo refuses a code with a use or an order against it, which is
 * exactly the code that must survive. Best effort — a tidying-up must never
 * be the reason a run fails.
 */
async function dropBirthdayPromo(promo: BirthdayPromo): Promise<void> {
  if (!promo.minted) return;
  try {
    const mod = (await import("@/lib/promos")) as unknown as {
      deletePromo?: (code: string) => Promise<unknown>;
    };
    await mod.deletePromo?.(promo.code);
  } catch (err) {
    console.warn("[flows] birthday code left behind:", (err as Error)?.message);
  }
}

/** One day of the birthday window: the calendar day the job is looking at, and how far ahead of «now» it is. */
interface WindowDay {
  /** `month * 100 + day` — the shape the query compares a birthday against. */
  mmdd: number;
  /** The year that calendar day falls in — what `birthday_sent_year` is stamped with. */
  year: number;
  /** 0 for today, 1 for tomorrow … `birthdayDays` for the last day of the window. */
  ahead: number;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * The days a run looks at: today and the next `birthdayDays` days, each with
 * its own year. A 29 February birthday exists only every fourth year; in the
 * other three it is celebrated on 28 February, so the pair (2, 29) is put on
 * the 28th's line whenever that 28th is in a non-leap year — the customer
 * born on the 29th gets the letter the day before the 1st of March, and the
 * customer born on the 28th gets theirs as always.
 *
 * «Today» is the Tallinn calendar day, and the steps after it are CALENDAR
 * days, not 24-hour hops. Both matter: the day stamped on a customer's
 * birthday is a date somebody typed on an Estonian form, and a 24-hour hop
 * across the last Sunday of October (a 25-hour Tallinn day) would name the
 * same date twice and skip the one after it — a letter sent twice, or a
 * birthday the window never reaches.
 */
export function birthdayWindow(now: number, birthdayDays: number): WindowDay[] {
  const out: WindowDay[] = [];
  const span = Math.max(0, Math.min(BIRTHDAY_MAX_DAYS, Math.trunc(birthdayDays) || 0));
  // a caller that hands in a broken `now` still gets span+1 days, so the
  // placeholder list below can never come out shorter than its parameters
  const today = shopDay(new Date(now)) || shopDay(new Date());
  for (let i = 0; i <= span; i += 1) {
    const parts = ymdParts(addShopDays(today, i));
    if (!parts) continue;
    const { year, month, day } = parts;
    out.push({ mmdd: month * 100 + day, year, ahead: i });
    if (month === 2 && day === 28 && !isLeapYear(year)) out.push({ mmdd: 229, year, ahead: i });
  }
  return out;
}

/**
 * Everybody whose birthday falls in the window — today up to `birthdayDays`
 * days ahead — who has said yes to marketing, and who has not had this
 * year's letter.
 *
 * `birthdayDays` is 0 by default — the day itself, which is what this has
 * always done. A larger number opens the window: with 3, the letter for a
 * 14 March birthday goes out on 11 March — or on the 12th, 13th or 14th if
 * the job did not run on the 11th, or the customer only typed the date on
 * the 13th. Until 10.09.2026 the job matched exactly one day (the birthday
 * minus the head start), so a run the cron missed, or a date entered after
 * the morning run, was a letter lost for the whole year (Dim: «I added my
 * birthday … but have not gotten any birthday email»). The window's last day
 * is the birthday itself: a greeting after the day is not a greeting.
 *
 * The code the letter carries lasts fourteen days from the birthday, however
 * early the letter goes (birthdayCodeDays). The year the guard stamps is the
 * BIRTHDAY's year, not today's: on 30 December, «за 3 дня» is looking at a
 * birthday in January, and stamping this year would let the same letter go
 * out again a few days later. `birthday_sent_year` is that guard — the job
 * may run hourly, or be started by hand from the panel, without sending
 * twice. A send the mail layer skipped (no RESEND_API_KEY, no address) takes
 * the stamp off again: nothing went out, and the letter is owed as soon as
 * mail works.
 */
export async function runBirthdays(now: number = Date.now()): Promise<FlowRun> {
  const flows = await getFlows();
  if (!flows.birthday) return { sent: 0, skipped: 0, reason: "disabled", skips: { disabled: 1 } };
  await loadTexts();
  let roomLeft = await marketingRoom();
  if (roomLeft <= 0) return { sent: 0, skipped: 0, reason: "no_budget", skips: { no_budget: 1 } };

  const window = birthdayWindow(now, flows.birthdayDays);
  const byDay = new Map<number, WindowDay>();
  for (const d of window) if (!byDay.has(d.mmdd)) byDay.set(d.mmdd, d);
  const holes = window.map((_, i) => `$${i + 1}`).join(",");
  const maxYear = Math.max(...window.map((d) => d.year));

  /* The year test in SQL is only a coarse cut (a row stamped with the last
     year of the window can never be due); the exact one is per row below,
     against the year of the very day that row matched. Across a New Year the
     window holds two years, and a December birthday stamped this year must
     not be mistaken for a January one stamped last year. */
  const rows = await query<{
    id: string;
    email: string;
    name: string | null;
    lang: string | null;
    mmdd: string | number;
    birthday_sent_year: number | string | null;
  }>(
    `select id, email, name, lang, birthday_sent_year,
            extract(month from birthday) * 100 + extract(day from birthday) as mmdd
       from customers
      where birthday is not null
        and marketing = true
        and (extract(month from birthday) * 100 + extract(day from birthday)) in (${holes})
        and (birthday_sent_year is null or birthday_sent_year < $${window.length + 1})
      order by created_at
      limit ${BATCH}`,
    [...window.map((d) => d.mmdd), maxYear],
  );
  if (!rows.length) {
    /* «Put birthday, but no e-mail.» — the query found nobody, and the three
       things that can hide a customer from it are a date nobody typed, the
       marketing tick, and this year's letter already gone. Counted, so the
       panel can say which. */
    const empty = counter();
    await explainEmptyBirthdayQueue(empty, window, maxYear);
    return { sent: 0, skipped: 0, reason: empty.top, skips: empty.map };
  }

  /* `marketing = true` above is the tick; this is the stop list. The link
     turns the tick off on a row it finds, so the two rarely disagree — but a
     row written after the click, or by hand, must still not get a letter.
     Not stamped: no letter went out, and the query only sees this birthday
     for the days the window covers anyway. */
  const blocked = await optedOutSet(rows.map((r) => r.email));

  let sent = 0;
  const skips = counter();
  for (const row of rows) {
    /* Before the stamp: an unstamped row is one tomorrow's run still sees,
       and a birthday is worth being a day late about rather than missing. */
    if (roomLeft <= 0) {
      skips.add("no_budget");
      continue;
    }
    const day = byDay.get(Number(row.mmdd));
    if (!day) continue;
    const year = day.year;
    const stamped = row.birthday_sent_year == null ? null : Number(row.birthday_sent_year);
    if (stamped === year) {
      skips.note("already_sent", 1); // this birthday's letter has gone
      continue;
    }
    if (blocked.has(row.email)) {
      skips.add("opted_out");
      continue;
    }
    const promo = await promoForBirthday(flows, now, day.ahead);
    if (!promo) {
      /* No promo module and no settings.flows.birthdayCode: a birthday letter
         whose code does nothing is worse than no letter. The row is left
         unstamped so it goes out as soon as a code exists. */
      skips.add("no_promo_code");
      continue;
    }
    // Stamped first: a repeat is worse than a miss (see runAbandonedCarts).
    await query("update customers set birthday_sent_year = $2 where id = $1", [row.id, year]);
    const lang = normalizeLangCode(row.lang);
    const mail = renderBirthday(
      { email: row.email, name: row.name ?? "", lang, unsubscribeUrl: unsubscribeUrl(row.email, lang, "marketing") },
      normalizeLang(lang),
      promo.code,
      { percent: flows.birthdayPercent, expires: promo.expires },
    );
    const res = await sendRendered(row.email, mail, {
      tags: { template: "birthday", lang: lang.toLowerCase() },
      idempotencyKey: `bday:${row.id}:${year}`,
      headers: unsubscribeHeaders(row.email, lang, "marketing"),
      kind: "marketing",
    });
    if (res.ok && !res.skipped) {
      sent += 1;
      roomLeft -= 1;
    } else {
      skips.add(sendSkip(res));
      // Resend's own daily quota — the rest of this queue is tomorrow's.
      if (res.quota) roomLeft = 0;
      /* Skipped, not failed: the mail layer did not even try (no key, no
         address). Nothing reached anybody, so the stamp comes off — a shop
         that gets its Resend key next week must still greet this customer
         this year. A real failure keeps the stamp: Resend was asked, and a
         retry from here would be the double letter the stamp exists to stop.

         The code goes back with the stamp, for the same reason: the next run
         will write a new one, and nobody was ever told this one. */
      if (res.skipped) {
        await query("update customers set birthday_sent_year = null where id = $1 and birthday_sent_year = $2", [row.id, year]);
        await dropBirthdayPromo(promo);
      }
    }
  }
  return { sent, skipped: skips.skipped, reason: skips.top, skips: skips.map };
}

/**
 * Why nobody was due — the three conditions the birthday query applies, each
 * counted over the whole customer table. Best effort.
 */
async function explainEmptyBirthdayQueue(
  skips: ReturnType<typeof counter>,
  window: WindowDay[],
  maxYear: number,
): Promise<void> {
  try {
    const holes = window.map((_, i) => `$${i + 1}`).join(",");
    const mmdd = "(extract(month from c.birthday) * 100 + extract(day from c.birthday))";
    const [row] = await query<Record<string, string | number>>(
      `select
         count(*) filter (where c.birthday is null)::int as no_birthday,
         count(*) filter (where c.birthday is not null and c.marketing is distinct from true)::int as no_marketing,
         count(*) filter (where c.birthday is not null and c.marketing = true
                            and ${mmdd} not in (${holes}))::int as not_in_window,
         count(*) filter (where c.birthday is not null and c.marketing = true
                            and ${mmdd} in (${holes})
                            and c.birthday_sent_year is not null
                            and c.birthday_sent_year >= $${window.length + 1})::int as already_sent
       from customers c`,
      [...window.map((d) => d.mmdd), maxYear],
    );
    if (!row) return;
    skips.note("no_birthday", Number(row.no_birthday) || 0);
    skips.note("no_marketing", Number(row.no_marketing) || 0);
    skips.note("not_in_window", Number(row.not_in_window) || 0);
    skips.note("already_sent", Number(row.already_sent) || 0);
    if (!skips.map) skips.note("nobody", 1); // not one customer in the table
  } catch (err) {
    console.warn("[flows] birthday queue could not be explained:", (err as Error)?.message);
  }
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

/* The mirror of UNPAID_STATUSES for setOrderStatus()'s `unless` guard: every
   status that is NOT one of those two, i.e. every status this loop's
   cancellation must refuse to make. Written out rather than imported from
   src/lib/orders.ts, which this file deliberately does not import (see the
   note at the top); the type check at the call site is what keeps the two
   vocabularies in step. */
const STILL_UNPAID_ONLY = ["paid", "shipped", "delivered", "cancelled", "refunded"] as const;
/* «Not paid» is two things, and the second one arrived on 19.09.2026: an order
   whose money HAS arrived but came up short is deliberately held (`payment.held`
   — src/lib/payments/apply.ts, the owner's decision of 18.09.2026). It keeps
   the status «новый», because nothing has been fulfilled, so every query in
   this file would have picked it up: a customer who really did pay would get
   «Заказ ждёт оплаты» for a week and then have the order cancelled under them.
   That flow is switched off today (`flows.unpaid`), which is the only reason
   this was never seen — and the owner's decision of 17.09.2026 is that it goes
   on. A trap behind a switch the go-live list turns on is still a trap, so the
   predicate closes it here, once, where all three queries read it. */
const NOT_PAID = "coalesce(payment->>'status','') <> 'paid' and payment->'held' is null";
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

/** `/shop2/et/done/?n=R-…&s=failed&o=<id>&c=FI` — the screen with «Оплатить ещё раз».
 *
 *  `c` is the order's delivery country and it is not decoration: the screen
 *  draws one country's bank chips, and a letter is opened in a browser that
 *  has never seen this shop's checkout — so without it a Finnish customer was
 *  handed the five built-in Estonian banks (Ренат, 17.09.2026, and see
 *  src/lib/payments/receipt.ts for the same fix on the redirect back from the
 *  bank). Built by hand here rather than through receiptUrl() because the
 *  letter also needs the language segment, which a receipt redirect never has.
 */
function payAgainUrl(lang: LangCode, row: UnpaidRow): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  const q = new URLSearchParams({ n: row.number, s: "failed", o: row.id });
  const ship = row.shipping as { country?: unknown } | null | undefined;
  const country = ship && typeof ship === "object" ? String(ship.country ?? "") : "";
  if (/^[A-Za-z]{2}$/.test(country)) q.set("c", country.toUpperCase());
  return `${baseUrl()}/shop2${seg}/done/?${q.toString()}`;
}

export async function runUnpaidOrders(now: number = Date.now()): Promise<UnpaidRun> {
  const flows = await getFlows();
  if (!flows.unpaid) return { sent: 0, skipped: 0, cancelled: 0, reason: "disabled", skips: { disabled: 1 } };
  await loadTexts();

  const day = 24 * 60 * 60 * 1000;
  const remindBefore = new Date(now - flows.unpaidRemindDays * day).toISOString();
  const cancelBefore = new Date(now - flows.unpaidCancelDays * day).toISOString();
  /* The backlog line (`unpaidFrom`, and the note on it in the Flows type). An
     order created at or before this instant was already past its cancel day
     the moment the owner turned the switch on: it is released, and it is
     released without a letter. Tallinn midnight of the stamped day, minus the
     cancel window — shopDayStart(), because the stamp is a calendar day in
     this shop's own zone and a Date built from the string any other way is up
     to three hours out.

     Deliberately NOT a precondition on the query above or below: the letter is
     what Dim asked to keep quiet, not the cancellation, and a reminder-shaped
     filter on the cancel query is the thing tests/flows-unpaid.test.ts pins
     against («does not send the reminder to an order that is already past the
     cancel day» — that order still has to go, and go now). */
  const floorStart = flows.unpaidFrom ? shopDayStart(flows.unpaidFrom).getTime() : NaN;
  const quietBefore = Number.isFinite(floorStart) ? floorStart - flows.unpaidCancelDays * day : null;

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
    let moved: Awaited<ReturnType<typeof setOrderStatus>>;
    try {
      moved = await setOrderStatus(row.id, "cancelled", "system:unpaid", { unless: STILL_UNPAID_ONLY });
    } catch (err) {
      console.error(`[flows] unpaid cancel failed on ${row.number}:`, err);
      skipped += 1;
      continue;
    }
    /* The money arrived while this walk was going on. The select above read a
       hundred orders once and each letter that follows takes its own trip to
       Resend, so the list is minutes old by the time the last row is reached —
       long enough for a bank to answer. `unless` puts the test inside the
       UPDATE itself (src/lib/orders.ts), so a payment that landed in between
       is not overwritten with «отменён» and its customer is not told his paid
       order has been cancelled. Nothing happened: nothing is counted. */
    if (!moved) continue;
    cancelled += 1;
    if (!row.email) continue;
    /* The backlog goes quietly. This order was already dead when the switch
       was flipped — nobody was ever going to pay for it and nobody was
       waiting to hear about it — so it is let go and nothing is written to
       the customer. Counted as cancelled, because it was; not counted as
       skipped, because no letter was due in the first place. */
    if (quietBefore !== null && new Date(row.created_at).getTime() <= quietBefore) continue;
    const res = await onOrderClosed({ ...unpaidOrderLike(row), status: "cancelled" }, { kind: "cancelled" });
    if (res.ok && !res.skipped) sent += 1;
  }

  return { sent, skipped, cancelled };
}

/* ---------- the scheduler ------------------------------------------------- */

export interface FlowsReport {
  abandoned: FlowRun;
  /** The discounted second letter — the same switch, its own clock. */
  abandonedDiscount: FlowRun;
  backstock: FlowRun;
  birthday: FlowRun;
  /** «По счёту»: the reminder and the automatic cancellation — src/lib/invoice-dunning.ts. */
  invoices: { reminded: number; cancelled: number; skipped: number; reason?: string };
  unpaid: UnpaidRun;
  /** «Доставлен» closed without anybody pressing it — src/lib/delivery.ts. */
  delivered: { closed: number; checked: number; returned?: number; reason?: string };
  /** Montonio re-asked about shipments whose webhook went quiet — src/lib/shipping/shipment-sync.ts. */
  shipments: {
    checked: number;
    changed: number;
    tracking: number;
    refused: number;
    closed: number;
    errors: number;
    left: number;
    reason?: string;
  };
  ms: number;
}

/* ---------- «Последний запуск» ------------------------------------------- */

/** The flows a run is recorded for — the ones the panel can start by hand and the ones beside them. */
export const RUNNABLE_FLOWS = ["abandoned", "abandonedDiscount", "birthday", "backstock", "unpaid"] as const;
export type RunnableFlow = (typeof RUNNABLE_FLOWS)[number];

/** One line of `settings.flow_runs`: what the last run of a flow did and when. */
export interface FlowRunRecord {
  /** ISO instant of the run. */
  at: string;
  sent: number;
  skipped: number;
  reason?: string;
  /** Every reason the run did not send, counted — see SKIP_REASONS. */
  skips?: SkipCounts;
  /** `cron` — the daily job; `admin` — «Запустить сейчас» in the panel. */
  by: "cron" | "admin";
}

/** Only the vocabulary, only whole positive numbers — what a settings blob may hold. */
function cleanSkips(raw: unknown): SkipCounts | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: SkipCounts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSkipReason(k)) continue;
    const n = Math.trunc(Number(v) || 0);
    if (n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Remembers the last run of one flow in `settings.flow_runs` — the line
 * «Последний запуск: 10.09 07:00 — отправлено 1» under the letter's row in
 * «Маркетинг → Письма». The same line whether the cron ran it or the owner
 * pressed the button: it answers the one question both cases raise, «did it
 * run at all, and did it send anything». Merged key by key with jsonb `||`,
 * so the two flows never overwrite each other's line. Best effort — a
 * settings write must never be the reason a run counts as failed.
 */
export async function recordFlowRun(flow: RunnableFlow, run: FlowRun, by: FlowRunRecord["by"], now: number = Date.now()): Promise<FlowRunRecord> {
  const skips = cleanSkips(run.skips);
  const record: FlowRunRecord = {
    at: new Date(now).toISOString(),
    sent: Math.max(0, Math.trunc(Number(run.sent) || 0)),
    skipped: Math.max(0, Math.trunc(Number(run.skipped) || 0)),
    by,
    ...(run.reason ? { reason: String(run.reason).slice(0, 40) } : {}),
    ...(skips ? { skips } : {}),
  };
  try {
    await query(
      `insert into settings (key, value, updated_at) values ('flow_runs', $1::jsonb, now())
       on conflict (key) do update
         set value = coalesce(settings.value, '{}'::jsonb) || excluded.value, updated_at = now()`,
      [JSON.stringify({ [flow]: record })],
    );
  } catch (err) {
    console.error(`[flows] flow_runs not recorded for ${flow}:`, err);
  }
  return record;
}

/** `settings.flow_runs`, cleaned: only the flows we know, only the fields we wrote. Empty when nothing has run. */
export async function getFlowRuns(): Promise<Partial<Record<RunnableFlow, FlowRunRecord>>> {
  let raw: unknown = null;
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = 'flow_runs'");
    raw = rows.length ? rows[0].value : null;
  } catch {
    return {};
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const map = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Partial<Record<RunnableFlow, FlowRunRecord>> = {};
  for (const flow of RUNNABLE_FLOWS) {
    const v = map[flow];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    const at = typeof r.at === "string" && !Number.isNaN(new Date(r.at).getTime()) ? r.at : "";
    if (!at) continue;
    const skips = cleanSkips(r.skips);
    out[flow] = {
      at,
      sent: Math.max(0, Math.trunc(Number(r.sent) || 0)),
      skipped: Math.max(0, Math.trunc(Number(r.skipped) || 0)),
      by: r.by === "admin" ? "admin" : "cron",
      ...(typeof r.reason === "string" && r.reason ? { reason: r.reason.slice(0, 40) } : {}),
      ...(skips ? { skips } : {}),
    };
  }
  return out;
}

/**
 * One flow, started by hand — `POST /api/admin/flows/run/` behind
 * «Запустить сейчас». Exactly the function the cron calls, so the button and
 * the schedule can never disagree; the switch still decides («disabled»
 * comes back as the reason and nothing goes out), and the same stamps that
 * keep the cron from sending twice keep the button from it too. The run is
 * recorded as the panel's, so the line under the row says who ran it.
 */
export type HandRunFlow = "abandoned" | "abandonedDiscount" | "birthday";

export async function runFlowByHand(flow: HandRunFlow, now: number = Date.now()): Promise<FlowRun & { at: string }> {
  const run =
    flow === "abandoned"
      ? await runAbandonedCarts(now)
      : flow === "abandonedDiscount"
        ? await runAbandonedCartsDiscount(now)
        : await runBirthdays(now);
  const record = await recordFlowRun(flow, run, "admin", now);
  return { ...run, at: record.at };
}

/** What `GET /api/cron/flows` runs. Every branch is independently guarded. */
export async function runFlows(now: number = Date.now()): Promise<FlowsReport> {
  const started = Date.now();
  const out: FlowsReport = {
    abandoned: { sent: 0, skipped: 0, reason: "error" },
    abandonedDiscount: { sent: 0, skipped: 0, reason: "error" },
    backstock: { sent: 0, skipped: 0, reason: "error" },
    birthday: { sent: 0, skipped: 0, reason: "error" },
    invoices: { reminded: 0, cancelled: 0, skipped: 0, reason: "error" },
    unpaid: { sent: 0, skipped: 0, cancelled: 0, reason: "error" },
    delivered: { closed: 0, checked: 0, reason: "error" },
    shipments: { checked: 0, changed: 0, tracking: 0, refused: 0, closed: 0, errors: 0, left: 0, reason: "error" },
    ms: 0,
  };
  /* «Брошенная корзина» first, then its discounted follow-up: the second
     letter's queue is built out of `reminded_at`, so running them in this
     order on the one pass a day the free plan allows means a basket that
     became due for both on the same day still gets them a full
     `abandonedDiscountDays` apart rather than minutes apart. */
  for (const [key, fn] of [
    ["abandoned", runAbandonedCarts],
    ["abandonedDiscount", runAbandonedCartsDiscount],
    ["backstock", sweepBackInStock],
    ["birthday", runBirthdays],
  ] as const) {
    try {
      out[key] = await fn(now);
    } catch (err) {
      console.error(`[flows] ${key} failed:`, err);
      out[key] = { sent: 0, skipped: 0, reason: "error", skips: { error: 1 } };
    }
    await recordFlowRun(key, out[key], "cron", now);
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
  await recordFlowRun("unpaid", out.unpaid, "cron", now);
  /* Not a letter — the last step of an order, closed for the owner instead of
     by him (Dim: «we need to improve this»). It rides this job because this is
     the one thing the shop runs on a schedule, and once a day is exactly the
     right frequency for «дошла ли посылка». Loaded lazily and guarded like
     everything else: a carrier that is down must not stop the letters. */
  /* The backup Montonio asked for (support, 24.09.2026): «we'd still
     recommend occasionally polling shipment status via GET as a backup, in
     case an event ever ends up undelivered». Every shipment that has been
     quiet for half a day is re-asked and the answer applied exactly as the
     webhook would have — a status, a tracking code that arrived late, a
     refusal for the journal, a delivery that closes the order. Before the
     close below, so an order this finds delivered is not asked twice. Bounded
     and time-boxed, never throws; loaded lazily like the close. */
  try {
    const { syncStaleShipments } = await import("@/lib/shipping/shipment-sync");
    out.shipments = await syncStaleShipments({ now });
  } catch (err) {
    console.error("[flows] shipments failed:", err);
    out.shipments = { checked: 0, changed: 0, tracking: 0, refused: 0, closed: 0, errors: 0, left: 0, reason: "error" };
  }
  try {
    const { closeDeliveredOrders } = await import("@/lib/delivery");
    out.delivered = await closeDeliveredOrders(now);
  } catch (err) {
    console.error("[flows] delivered failed:", err);
    out.delivered = { closed: 0, checked: 0, reason: "error" };
  }
  /* Housekeeping, not a letter: the per-address cart-write counters
     (db/migrations/181_cart_writes.sql) for days long past. It rides the one
     scheduled job the shop has for the same reason everything else here does
     — there is no second one. pruneCartWrites() swallows its own errors. */
  await pruneCartWrites(now);
  out.ms = Date.now() - started;
  return out;
}

/* ---------- the admin's three counters ------------------------------------ */

export interface FlowCounters {
  /** Carts waiting for a reminder — abandoned, never reminded, no order since, address not opted out. */
  carts: number;
  /** Addresses waiting for a «снова в наличии» letter. */
  alerts: number;
  /** Birthdays inside the run's own window (flows.birthdayDays), marketing
   *  consent given, address not opted out, this year's letter not yet sent. */
  birthdays: number;
  /** Unpaid orders old enough for the reminder and not reminded yet. */
  unpaid: number;
}

/* The panel's «в очереди N» must not promise a letter the run will refuse:
   the stop list is subtracted here the same way the runs skip it. */
const NOT_OPTED_OUT = (email: string) => `not exists (select 1 from mail_optouts mo where mo.email = ${email})`;

export async function flowCounters(now: number = Date.now()): Promise<FlowCounters> {
  const out: FlowCounters = { carts: 0, alerts: 0, birthdays: 0, unpaid: 0 };
  /* Read once for the two queues that need it (the birthday window, the
     unpaid days): one settings row, not one per counter. getFlows() answers
     with the defaults rather than throwing, so it needs no try of its own. */
  const flows = await getFlows();
  try {
    /* The wait the RUN is going to make, not the built-in three hours: the
       panel's «в очереди N» must not promise a letter the run will not send,
       which is the same rule NOT_OPTED_OUT above exists for. */
    const cutoff = new Date(now - abandonedAfterMs(flows)).toISOString();
    const [carts] = await query<{ n: string | number }>(
      `select count(*)::int as n from carts c
        where c.reminded_at is null and c.recovered_at is null and c.updated_at <= $1
          and not exists (select 1 from orders o where lower(o.email) = c.email and o.created_at >= c.updated_at)
          and ${NOT_OPTED_OUT("c.email")}`,
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
    /* The days the RUN is going to look at — birthdayWindow(now,
       flows.birthdayDays), the very list runBirthdays() builds, wrapping
       across the New Year and putting a 29 February birthday on the 28th in
       the three years out of four that have no 29th.

       This used to be a fixed seven days, while «за сколько дней» has been a
       setting since 07.09.2026 and defaults to 0 — today only. The panel said
       «в очереди 4» beside a run that had one letter to send, which is the one
       thing the note above NOT_OPTED_OUT exists to forbid. The other half of
       the same disagreement was `birthday_sent_year`: a letter that has
       already gone this year was still counted as queued, so the number never
       dropped after «Запустить сейчас» until the birthday itself had passed. */
    const window = birthdayWindow(now, flows.birthdayDays);
    /** mmdd → the year that calendar day falls in, first one wins (the window
     *  can name the same day twice: 28 February in a non-leap year). */
    const byDay = new Map<number, number>();
    for (const d of window) if (!byDay.has(d.mmdd)) byDay.set(d.mmdd, d.year);
    // Placeholders rather than an array parameter: the two drivers disagree
    // about how a JS array becomes a Postgres one, and a day is two holes.
    const params: unknown[] = [];
    const terms: string[] = [];
    for (const [mmdd, year] of byDay) {
      params.push(mmdd, year);
      const i = params.length;
      /* Per day, not against the newest year in the window: across a New Year
         the window holds two of them, and a December birthday stamped this
         year must not be read as a January one stamped last year — the same
         reasoning as the per-row test in runBirthdays(). */
      terms.push(
        `((extract(month from c.birthday) * 100 + extract(day from c.birthday)) = $${i - 1}
           and (c.birthday_sent_year is null or c.birthday_sent_year <> $${i}))`,
      );
    }
    const [bd] = terms.length
      ? await query<{ n: string | number }>(
          `select count(*)::int as n from customers c
            where c.birthday is not null and c.marketing = true
              and (${terms.join(" or ")})
              and ${NOT_OPTED_OUT("c.email")}`,
          params,
        )
      : [];
    out.birthdays = Number(bd?.n) || 0;
  } catch {
    /* ignored */
  }
  try {
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
