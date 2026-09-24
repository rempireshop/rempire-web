/**
 * The day's letter allowance — how many e-mails this shop may still send
 * today, and which of them may be stopped.
 *
 * Dim, 21.09.2026. Resend's free plan says 100 a day and 3 000 a month, and
 * enforces it softly: he has watched a run pass 100 and stop nearer 200. A
 * number we cannot predict is a number we cannot plan against, so the cap the
 * shop obeys is ours — `settings.mail_budget`, 100 out of the box — and this
 * module is the counter behind it (db/migrations/201_mail_budget.sql).
 *
 * THE FAILURE THIS EXISTS TO PREVENT is not a slow newsletter. It is a
 * campaign quietly eating the day's allowance at nine in the morning and an
 * ORDER CONFIRMATION failing at four in the afternoon — a customer who has
 * paid and got nothing. Hence the two rules, and they are not symmetrical:
 *
 *   TRANSACTIONAL NEVER ASKS. Order letters, gift cards, invoices, the «снова
 *   в наличии» alert somebody asked for by name, the owner's own pings — they
 *   call noteSent() after the fact and nothing else. roomFor("transactional")
 *   answers Infinity without touching the database, because a counter that
 *   could not be read must never be the reason a paid order goes unanswered.
 *
 *   MARKETING ASKS FIRST AND STOPS. «Рассылка» and the three letters nobody
 *   asked for (abandoned cart, its discounted follow-up, the birthday
 *   greeting) call roomFor("marketing") and send at most that many. It stops
 *   at cap − reserve, so the last `reserve` letters of the day belong to the
 *   customers who are paying for something.
 *
 * FAIL OPEN ONE WAY, CLOSED THE OTHER, for the same reason. A database that
 * cannot be read leaves transactional mail exactly as it was and gives
 * marketing nothing: «мы не знаем, сколько потрачено» is a reason to hold a
 * campaign back and never a reason to refuse somebody's receipt. Nothing here
 * throws — every function swallows its own failure and answers with the safe
 * side of that asymmetry.
 *
 * WHO COUNTS. sendMail() (src/lib/mail.ts), on every accepted send, from its
 * `kind` — which defaults to "transactional", so a letter nobody classified
 * spends the allowance but can never be stopped by it. A skipped send (no
 * key, no address) and a refused one count for nothing: the allowance is
 * spent by what actually left.
 *
 * WHEN RESEND ITSELF SAYS NO. A 429 that names the daily quota is not the
 * ordinary 429 that names two requests a second — the first means the day is
 * over, the second means «wait a moment». noteQuotaRefusal() stamps the day
 * blocked so the rest of the run stops at once instead of walking the queue
 * collecting the same refusal, and marketing stays stopped until UTC midnight.
 *
 * THE OWNER HEARS ABOUT IT ONCE. warnOwnerOnce() claims the day in the same
 * row it counts in (the `where` on the upsert is what makes «once» true when
 * two batches discover it in the same second) and sends a Web Push. Not an
 * e-mail: e-mail is the thing that has run out.
 */
import { query } from "@/lib/db";
import type { MailKind } from "@/lib/mail";

/* ---------- the settings -------------------------------------------------- */

/** `settings.mail_budget` — `{ "cap": 100, "reserve": 30 }`. */
export const MAIL_BUDGET_SETTING = "mail_budget";

/** Resend's free plan, and what the shop assumes until the owner says otherwise. */
export const MAIL_CAP_DEFAULT = 100;
/** Letters held back inside the cap for the customers who are paying. */
export const MAIL_RESERVE_DEFAULT = 30;
/** A cap is a promise to ourselves, not a plan to send this much. */
export const MAIL_CAP_MAX = 5_000;

export interface MailBudgetSettings {
  cap: number;
  reserve: number;
}

const DEFAULTS: MailBudgetSettings = { cap: MAIL_CAP_DEFAULT, reserve: MAIL_RESERVE_DEFAULT };

function whole(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.round(n), max);
}

/**
 * A stored blob → the two numbers, clamped. The first door, the way
 * cleanShippingRules() and cleanMailTexts() are: a settings row is jsonb the
 * admin can PUT, and a cap of `"сто"` must become 100 rather than NaN — which
 * would make every comparison below false and every letter allowed.
 *
 * A reserve equal to the cap is left alone rather than corrected: it means
 * «no marketing at all», and that is a thing somebody may legitimately want
 * for a week. A reserve ABOVE the cap is the same wish typed carelessly and
 * is pulled down to it, so the arithmetic can never go negative.
 */
export function cleanMailBudget(raw: unknown): MailBudgetSettings {
  let src = raw;
  if (typeof src === "string") {
    try {
      src = JSON.parse(src);
    } catch {
      src = null;
    }
  }
  const o = (src && typeof src === "object" && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  const cap = whole(o.cap, DEFAULTS.cap, MAIL_CAP_MAX);
  return { cap, reserve: Math.min(whole(o.reserve, DEFAULTS.reserve, MAIL_CAP_MAX), cap) };
}

/**
 * The owner's two numbers. A missing row, a missing table or a missing
 * database all mean the defaults — unlike the counter below, an unreadable
 * SETTING says nothing about how much has been spent, and 100/30 is the
 * honest assumption to carry on with.
 */
export async function mailBudgetSettings(): Promise<MailBudgetSettings> {
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = $1", [MAIL_BUDGET_SETTING]);
    return cleanMailBudget(rows.length ? rows[0].value : null);
  } catch {
    return { ...DEFAULTS };
  }
}

/* ---------- the day ------------------------------------------------------- */

/**
 * The counter's own day: UTC, 'YYYY-MM-DD'.
 *
 * Not Tallinn's, which is what src/lib/day.ts hands the rest of the shop.
 * That one cuts the day where the customers live; this one has to cut it
 * where Resend does, and Resend's allowance turns over at UTC midnight. A
 * counter on Tallinn time would hand out three hours' worth of tomorrow's
 * letters against a quota that had not moved.
 */
export function utcDay(now: number | Date = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/* ---------- what has been spent ------------------------------------------- */

export interface MailSpent {
  /** The UTC day these numbers belong to. */
  day: string;
  transactional: number;
  marketing: number;
  /** Both classes — what the provider has seen from us today. */
  total: number;
  /** Resend refused a send today for its own daily quota. Marketing is over. */
  blocked: boolean;
  /** The owner has already been told today. */
  warned: boolean;
  /**
   * False when the counter could not be read at all. The difference between
   * «nothing has been sent» and «we do not know» is the whole of the
   * fail-open/fail-closed rule in the header — never collapse the two.
   */
  known: boolean;
}

const UNKNOWN: Omit<MailSpent, "day"> = {
  transactional: 0,
  marketing: 0,
  total: 0,
  blocked: false,
  warned: false,
  known: false,
};

type DayRow = { kind: string; n: number | string; blocked_at: string | Date | null; warned_at: string | Date | null };

/** Today's two rows. Never throws — an unreadable counter answers `known:false`. */
export async function spentToday(now: number = Date.now()): Promise<MailSpent> {
  const day = utcDay(now);
  let rows: DayRow[];
  try {
    rows = await query<DayRow>("select kind, n, blocked_at, warned_at from mail_sends_daily where day = $1", [day]);
  } catch (err) {
    console.error("[mail-budget] today's counter could not be read:", err);
    return { day, ...UNKNOWN };
  }
  const out: MailSpent = { day, transactional: 0, marketing: 0, total: 0, blocked: false, warned: false, known: true };
  for (const r of rows) {
    const n = Math.max(0, Math.trunc(Number(r.n) || 0));
    if (r.kind === "marketing") {
      out.marketing = n;
      /* Only the marketing row carries the «he has been told» stamp: the
         notice is about marketing stopping, and there is one of it a day. */
      if (r.warned_at) out.warned = true;
    } else if (r.kind === "transactional") {
      out.transactional = n;
    }
    /* A block on EITHER row ends the day for marketing. Resend counts one
       account, so a quota refusal on an order letter says just as much about
       the campaign as one on the campaign itself. */
    if (r.blocked_at) out.blocked = true;
  }
  out.total = out.transactional + out.marketing;
  return out;
}

/**
 * How many letters of this class may still go out today.
 *
 * Infinity for transactional, without a query: see the header. Marketing gets
 * cap − reserve − everything already sent, and nothing at all when the
 * counter could not be read or Resend has already refused for quota today.
 */
export async function roomFor(kind: MailKind, now: number = Date.now()): Promise<number> {
  if (kind !== "marketing") return Number.POSITIVE_INFINITY;
  const [{ cap, reserve }, spent] = await Promise.all([mailBudgetSettings(), spentToday(now)]);
  if (!spent.known || spent.blocked) return 0;
  return Math.max(0, cap - reserve - spent.total);
}

/* ---------- writing it down ----------------------------------------------- */

/**
 * `n` letters of this class left the building. Called by sendMail() on every
 * accepted send, and by the one sender that does not go through it (the
 * owner's ping, src/lib/notify.ts — its own fetch, the shop's own quota).
 *
 * Swallows everything. A counter that cannot be written is a counter that
 * runs low, which costs a campaign a day; a throw here would reach a payment
 * callback, which costs an order.
 */
export async function noteSent(kind: MailKind, n: number = 1): Promise<void> {
  const count = Math.trunc(Number(n) || 0);
  if (count <= 0) return;
  try {
    await query(
      `insert into mail_sends_daily (day, kind, n) values ($1, $2, $3)
       on conflict (day, kind) do update
         set n = mail_sends_daily.n + excluded.n, updated_at = now()`,
      [utcDay(), classOf(kind), count],
    );
  } catch (err) {
    console.error("[mail-budget] a send was not counted:", err);
  }
}

/**
 * Resend refused for its own daily quota — the day is over.
 *
 * Stamped rather than inferred from the count: our cap and theirs are
 * different numbers by design (the header), so the shop can be well under 100
 * and still be told no. Marketing reads the stamp and stops at once; the
 * alternative is a batch walking two hundred addresses collecting the same
 * refusal, which is exactly the hammering the provider is asking us to stop.
 */
export async function noteQuotaRefusal(kind: MailKind, now: number = Date.now()): Promise<void> {
  try {
    await query(
      `insert into mail_sends_daily (day, kind, n, blocked_at) values ($1, $2, 0, now())
       on conflict (day, kind) do update
         set blocked_at = coalesce(mail_sends_daily.blocked_at, now()), updated_at = now()`,
      [utcDay(now), classOf(kind)],
    );
    console.warn(`[mail-budget] Resend refused a ${classOf(kind)} letter for the daily quota — marketing stops until UTC midnight.`);
  } catch (err) {
    console.error("[mail-budget] the quota refusal was not recorded:", err);
  }
}

/** Anything that is not the word 'marketing' is the class that is never stopped. */
function classOf(kind: MailKind | string | undefined): MailKind {
  return kind === "marketing" ? "marketing" : "transactional";
}

/* ---------- telling the owner --------------------------------------------- */

/** A campaign that stopped at the limit, as the notice counts it. */
export interface ParkedCampaign {
  /** Letters that went out, across every day of this campaign. */
  sent: number;
  /** Its whole audience. */
  total: number;
}

/**
 * The notice's one line. It says what happens next, because that is the only
 * question the notice raises. Dim, 24.09.2026, after the limit test: «Will the
 * newsletters send themselves automatically, when I get this message? … I had
 * to click "send"». They do — the daily cron sends the rest
 * (resumeParkedNewsletters) — but the notice said «Рассылка остановлена» and
 * the panel said «Отправка прервалась — нажмите «Продолжить»». A campaign that
 * parked passes its own count, so the line reads like the panel's:
 * «отправлено N из M — остальные уйдут автоматически завтра».
 */
export function limitNoticeBody(
  spent: Pick<MailSpent, "total" | "blocked">,
  budget: MailBudgetSettings,
  campaign?: ParkedCampaign,
): string {
  const head = spent.blocked
    ? `Resend отказал: дневная квота исчерпана, отправлено ${spent.total}.`
    : `Сегодня отправлено ${spent.total} из ${budget.cap}; ${budget.reserve} писем держим для заказов.`;
  const next = campaign
    ? `Рассылка: отправлено ${campaign.sent} из ${campaign.total} — остальные уйдут автоматически завтра, нажимать ничего не нужно.`
    : "Рассылка и напоминания продолжатся завтра сами, нажимать ничего не нужно.";
  return `${head} ${next}`;
}

/**
 * «Дневной лимит писем исчерпан» — once a day, on his phone.
 *
 * Web Push (src/lib/push.ts) and Telegram, never e-mail: the whole message is
 * that e-mail has run out, and a letter about it would either be refused or
 * spend one of the thirty an order still needs. Both channels answer false
 * without touching anything when they are not configured, exactly as they do
 * for a paid order.
 *
 * The day is claimed BEFORE anything is sent, and claimed in the counter's own
 * row: two batches that hit the wall in the same second both call this, and
 * exactly one of them gets the row back. A claim that reached nobody is not
 * retried — the log says so, and a notification repeated every letter for the
 * rest of the day would be worse than the silence.
 *
 * True when this call is the one that claimed the day.
 */
export async function warnOwnerOnce(now: number = Date.now(), campaign?: ParkedCampaign): Promise<boolean> {
  const day = utcDay(now);
  let claimed = false;
  try {
    const rows = await query<{ day: string }>(
      `insert into mail_sends_daily (day, kind, n, warned_at) values ($1, 'marketing', 0, now())
       on conflict (day, kind) do update set warned_at = now(), updated_at = now()
         where mail_sends_daily.warned_at is null
       returning day`,
      [day],
    );
    claimed = rows.length > 0;
  } catch (err) {
    console.error("[mail-budget] the owner's daily-limit notice was not claimed:", err);
    return false;
  }
  if (!claimed) return false;

  const [settings, spent] = await Promise.all([mailBudgetSettings(), spentToday(now)]);
  const body = limitNoticeBody(spent, settings, campaign);
  const message = {
    title: "✉️ Лимит писем на сегодня",
    body,
    /* The panel, not a letter's screen: what he can do about it is change the
       cap or wait, and both live there. */
    url: "/shop2/admin/",
    /* One line in the shade per day — a second notice replaces the first. */
    tag: `mail-budget:${day}`,
  };

  let reached = false;
  try {
    const { sendPush } = await import("@/lib/push");
    reached = (await sendPush(message)).ok;
  } catch (err) {
    /* sendPush() does not throw; this catches the import failing on a
       deployment where `web-push` never installed — the same guard
       src/lib/mail-hooks.ts puts round its own. */
    console.error("[mail-budget] the owner's push could not be sent:", err);
  }
  try {
    const { forwardTelegram } = await import("@/lib/notify");
    reached = (await forwardTelegram(`${message.title}\n${message.body}`)) || reached;
  } catch (err) {
    console.error("[mail-budget] the owner's Telegram notice failed:", err);
  }
  if (!reached) {
    console.warn("[mail-budget] the daily limit is reached and no channel took the notice (no VAPID keys, no Telegram bot).");
  }
  return true;
}

/* ---------- what the panel prints ------------------------------------------ */

export interface MailBudgetView {
  /** The UTC day these numbers belong to. */
  day: string;
  cap: number;
  reserve: number;
  sent: { transactional: number; marketing: number; total: number };
  /** «рассылке доступно M» — letters a campaign may still send today. */
  marketingRoom: number;
  /** Resend itself has refused for quota today. */
  blocked: boolean;
  /** The owner has been told about it today. */
  warned: boolean;
  /** False when the counter could not be read — the panel says «неизвестно» rather than «0». */
  known: boolean;
}

/** Everything «сегодня отправлено N из CAP · рассылке доступно M» needs, in one read. */
export async function mailBudgetView(now: number = Date.now()): Promise<MailBudgetView> {
  const [{ cap, reserve }, spent] = await Promise.all([mailBudgetSettings(), spentToday(now)]);
  return {
    day: spent.day,
    cap,
    reserve,
    sent: { transactional: spent.transactional, marketing: spent.marketing, total: spent.total },
    marketingRoom: !spent.known || spent.blocked ? 0 : Math.max(0, cap - reserve - spent.total),
    blocked: spent.blocked,
    warned: spent.warned,
    known: spent.known,
  };
}

export interface MailBudgetPlan {
  /** Letters still to send. */
  left: number;
  /** How many of them fit in what is left of today. */
  today: number;
  /** Whole days the rest of the campaign needs, today included. 0 when there is nothing left. */
  days: number;
  /** The UTC day the last letter goes out on. */
  until: string;
}

/**
 * «Отправим 70 сегодня, закончим 23.09» — before the owner presses «Отправить».
 *
 * The days after today are counted against the WHOLE marketing allowance
 * (cap − reserve), not against what is left of today: tomorrow starts at zero.
 * It is an estimate and the panel should word it as one — a busy day of orders
 * eats the same cap, and the campaign simply takes a day longer.
 */
export function campaignPlan(left: number, view: MailBudgetView, now: number = Date.now()): MailBudgetPlan {
  const rest = Math.max(0, Math.trunc(Number(left) || 0));
  const today = Math.min(rest, Math.max(0, view.marketingRoom));
  const perDay = Math.max(1, view.cap - view.reserve);
  const after = rest - today;
  const days = rest === 0 ? 0 : (today > 0 ? 1 : 0) + Math.ceil(after / perDay);
  /* Day 1 is today when anything goes out today, so the last day is
     `days − 1` sleeps away; a campaign that cannot start until tomorrow has
     no letter today and its first day is already the next one. */
  const untilMs = new Date(now).getTime() + Math.max(0, days - (today > 0 ? 1 : 0)) * 86_400_000;
  return { left: rest, today, days, until: days === 0 ? view.day : utcDay(untilMs) };
}
