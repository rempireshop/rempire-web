/**
 * The owner's alerts — money or a parcel gone wrong, on Renat's phone.
 *
 * Readiness pass of 27.09.2026, B11 (golive «webhook-alarm»). Until now the
 * one thing that pinged him was a PAID order (onOrderPaid in
 * src/lib/mail-hooks.ts). Everything that goes wrong afterwards was written
 * into the journal and nowhere else: a refund Montonio could not pay, a refund
 * it cancelled, a payment only the nightly check found (the webhook was lost),
 * a parcel the carrier refused by webhook, a parcel that came back. Renat
 * reads the panel a few times a week; the customer asks sooner.
 *
 * THE DOOR IS THE JOURNAL. Every one of those events already writes an
 * `admin_audit` row, from half a dozen places (the payment and parcel
 * webhooks, the nightly sweeps, the refund route), so writeAudit() in
 * src/lib/orders.ts hands each row of the actions below to alertFromJournal()
 * and nothing else has to remember to call anything. A new place that writes
 * one of these rows alerts by itself.
 *
 * WHAT IT SAYS: what happened and what to do, in Russian (Renat's language,
 * like the paid-order ping — this never reaches a customer), short enough for
 * a lock screen. The tap opens the order's card (`?order=`), exactly like the
 * paid-order push.
 *
 * THE CHANNELS are pingOwner()'s: Web Push and Telegram side by side, the
 * shop's letter to RESEND_TO only when no phone took the push.
 *
 * ONCE: Montonio retries a webhook up to 15 times over two days, and the
 * nightly jobs see the same order every night. Each alert has a key built from
 * what it is about (the refund id, the order number, the shipment id), and
 * only the call whose INSERT claims that key in `owner_alerts`
 * (db/migrations/217_owner_alerts.sql) sends. A second delivery of the same
 * news finds the row and stays quiet. On top of that, at most
 * OWNER_ALERT_HOURLY_CAP a rolling hour, so a sweep that finds something odd
 * about thirty old orders at once cannot buzz the phone thirty times.
 *
 * NEVER THROWS, NEVER HOLDS THE CALLER: inside a request the send rides
 * `after()` (next/server — the same pattern as src/lib/letter-hold.ts), so the
 * webhook answers Montonio first. Outside one (a unit test, a script) it runs
 * then and there, bounded by ALERT_TIMEOUT_MS. Every failure is logged and
 * swallowed: the journal row is the record, the ping is a courtesy.
 *
 * For the other side of a change that has no journal row, sendOwnerAlert() is
 * exported and takes an OwnerAlert directly.
 */
import { after } from "next/server";
import { baseUrl, money } from "@/emails/layout";
import { query } from "@/lib/db";
import { readRefundStatusDescription, type RefundStatusReason } from "@/lib/montonio-problems";

/** One alert, ready to send. */
export interface OwnerAlert {
  /** What the alert is about — the dedupe key in `owner_alerts`. */
  key: string;
  /** Which alert, for the table and the log. */
  kind: OwnerAlertKind;
  /** The order it is about; the tap opens its card. */
  number: string;
  /** The lock-screen line. */
  title: string;
  /** What happened and what to do — one or two sentences. */
  body: string;
  /** Anything longer, for Telegram and the letter only (Montonio's own words). */
  detail?: string;
}

export type OwnerAlertKind =
  | "refund_stuck"
  | "refund_cancelled"
  | "refund_refused"
  | "payment_recovered"
  | "payment_held"
  | "payment_odd"
  | "shipment_refused"
  | "shipment_returned";

/** A journal row as writeAudit() has it. `id` is missing when the insert failed. */
export interface JournalRow {
  id?: number;
  actor: string;
  action: string;
  payload?: unknown;
}

/**
 * The journal actions that can raise an alert. writeAudit() in
 * src/lib/orders.ts matches the same names with OWNER_ALERT_ACTION (a test
 * holds the two together), so it loads this module only for them.
 */
export const OWNER_ALERT_ACTIONS = [
  "order.refund",
  "order.refund_stuck",
  "order.refund_failed",
  "order.payment_recovered",
  "order.payment_held",
  "order.payment_odd",
  "shipment.registration_failed",
  "shipment.returned",
] as const;

/** Sends in a rolling hour before the rest are recorded and not sent. */
export const OWNER_ALERT_HOURLY_CAP = 10;
/** How long one send may take — the three channels together. */
export const ALERT_TIMEOUT_MS = 10_000;

/* ---------- reading a journal row ---------------------------------------- */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}
function amountOf(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/* Why a refund did not reach the customer, as the first half of a sentence —
   Montonio's own `refundStatusDescription`, read by the same table the journal
   uses (src/lib/montonio-problems.ts). The long sentences there are for the
   order card; these fit a lock screen. */
const REFUND_CAUSE: Record<RefundStatusReason, string> = {
  insufficient_funds: "на счёте магазина в Montonio не хватило денег.",
  exceeds_paid: "Montonio считает, что возврат больше оплаты.",
  declined: "банк покупателя отказал.",
  expired_or_cancelled_card: "карта покупателя закрыта.",
  lost_or_stolen_card: "карта покупателя заблокирована.",
  expired: "Montonio ждал 10 дней.",
  other: "Montonio не назвал причину.",
  unknown: "",
};
/** …and what to do about a refund Montonio CANCELLED: the money is still the shop's. */
const REFUND_FIX_CANCELLED: Record<RefundStatusReason, string> = {
  insufficient_funds: "оформите возврат заново, когда на счёте будут деньги.",
  exceeds_paid: "сверьте суммы в Montonio.",
  declined: "верните их другим способом.",
  expired_or_cancelled_card: "попросите у покупателя другие реквизиты.",
  lost_or_stolen_card: "попросите у покупателя другие реквизиты.",
  expired: "оформите возврат заново.",
  other: "откройте заказ в Montonio.",
  unknown: "откройте заказ в Montonio.",
};

function refundCause(code: string): { reason: RefundStatusReason; cause: string; detail: string } {
  const reading = readRefundStatusDescription(code);
  const cause = reading.reason === "unknown" ? (code ? `Montonio: «${code}».` : "") : REFUND_CAUSE[reading.reason];
  return { reason: reading.reason, cause, detail: code ? reading.messages.RU : "" };
}

/** A refund Montonio gave up on — the words for both rows that can say so. */
function refundCancelled(number: string, ref: string, amount: number, code: string): OwnerAlert {
  const m = money(amount);
  if (!code) {
    return {
      key: `refund_cancelled:${ref || number}`,
      kind: "refund_cancelled",
      number,
      title: `⚠️ Возврат отменён: ${number}`,
      body: `Montonio отменил возврат ${m} — деньги остались у магазина. Откройте заказ и верните их заново или переводом.`,
    };
  }
  const why = refundCause(code);
  return {
    key: `refund_cancelled:${ref || number}`,
    kind: "refund_cancelled",
    number,
    title: `⚠️ Возврат отменён: ${number}`,
    body: `Montonio отменил возврат ${m}${why.cause ? `: ${why.cause}` : "."} Деньги остались у магазина — ${REFUND_FIX_CANCELLED[why.reason]}`,
    detail: why.detail,
  };
}

const CARRIER: Record<string, string> = {
  omniva: "Omniva",
  smartpost: "SmartPosti",
  itella: "SmartPosti",
  dpd: "DPD",
  unisend: "Unisend",
  novapost: "Nova Post",
  venipak: "Venipak",
};

/**
 * A journal row → the alert it raises, or null for a row that raises none.
 * Pure: no database, no clock — the tests read every sentence off this.
 */
export function alertForJournal(row: JournalRow): OwnerAlert | null {
  const p = obj(row.payload);
  const number = str(p.number) || str(p.orderId);
  if (!number) return null;
  const amount = amountOf(p.amount);

  switch (row.action) {
    /* Montonio's refund webhook explaining itself (`refundStatusDescription`),
       from src/app/api/payments/notify/route.ts. A SUCCESSFUL refund can carry
       a description too, and is no news. */
    case "order.refund_stuck": {
      const status = str(p.status);
      const ref = str(p.ref);
      const code = str(p.code);
      if (status === "done") return null;
      if (status === "failed") return refundCancelled(number, ref, amount, code);
      const why = refundCause(code);
      const fix =
        why.reason === "insufficient_funds"
          ? "Montonio пробует сам до 10 дней; если срочно — пополните счёт в Montonio."
          : "Откройте заказ в Montonio.";
      return {
        key: `refund_stuck:${ref || number}:${code}`,
        kind: "refund_stuck",
        number,
        title: `⚠️ Возврат ещё не дошёл: ${number}`,
        body: `${money(amount)} ещё не у покупателя${why.cause ? `: ${why.cause}` : "."} ${fix}`,
        detail: why.detail,
      };
    }
    /* Every refund the ledger records (settleRefund in src/lib/payments/
       settle.ts) — only a FAILED one is news: Montonio REJECTED or CANCELED
       it. Keyed by the refund's own id and shared with the row above, so the
       webhook that says both things pings once; the ledger's `repeat` is NOT
       read, because a PENDING refund that later fails is exactly a repeat of
       its id. */
    case "order.refund": {
      if (str(p.status) !== "failed") return null;
      return refundCancelled(number, str(p.ref), amount, str(p.code));
    }
    /* «Вернуть деньги» refused by Montonio — the panel says why in a toast
       that clears itself; this stays in the notification shade. One per press:
       each press is its own refusal. */
    case "order.refund_failed": {
      return {
        key: `refund_refused:${row.id ?? `${number}:${Date.now()}`}`,
        kind: "refund_refused",
        number,
        title: `⚠️ Возврат не прошёл: ${number}`,
        body: `Montonio отказал в возврате ${money(amount)} — деньги не ушли. Откройте заказ: причина в «Настройки → Журнал».`,
        detail: str(p.detail) ? `Montonio: ${str(p.detail)}` : undefined,
      };
    }
    /* The nightly check found a payment the webhook never brought
       (src/lib/payments/reconcile.ts). The order is paid now and the usual
       «оплачен» ping has gone too; this one says that the webhook is what
       failed, which is worth knowing if it happens twice. */
    case "order.payment_recovered": {
      return {
        key: `payment_recovered:${number}`,
        kind: "payment_recovered",
        number,
        title: `⚠️ Оплату нашла ночная проверка: ${number}`,
        body: `Уведомление Montonio об оплате ${money(amount)} не дошло. Заказ уже «Оплачен» — отправьте его как обычно. Если такое повторится, напишите Диму.`,
      };
    }
    /* Money arrived and it was not enough (src/lib/payments/apply.ts). The
       order is held, nothing else pings, and only Renat can end it. */
    case "order.payment_held": {
      const currency = str(p.reason) === "currency";
      return {
        key: `payment_held:${number}`,
        kind: "payment_held",
        number,
        title: `⚠️ Заплатили меньше: ${number}`,
        body: currency
          ? `Оплата пришла в другой валюте (${str(p.paidCurrency) || "?"}) — заказ придержан. Проверьте платёж в Montonio.`
          : `Пришло ${money(amountOf(p.got))} из ${money(amountOf(p.expected))} — заказ придержан. Проверьте платёж в Montonio и откройте заказ.`,
      };
    }
    /* Montonio says refunded, the shop says never paid — the nightly check
       writes it every night the two disagree; this goes once per order. */
    case "order.payment_odd": {
      const said = str(p.montonioStatus);
      return {
        key: `payment_odd:${number}:${said}`,
        kind: "payment_odd",
        number,
        title: `⚠️ Montonio и магазин не сходятся: ${number}`,
        body: `В Montonio заказ «${said || "?"}», а в магазине он не оплачен. Проверьте заказ в Montonio.`,
      };
    }
    /* The carrier turned the parcel down — news only when it arrived by
       itself (the webhook, or the nightly poll: actor `system`). A refusal
       answered to «Создать этикетку» is on the owner's screen already. A
       webhook retry of a refusal already on the order says `repeat`. */
    case "shipment.registration_failed": {
      if (row.actor !== "system" || p.repeat === true) return null;
      const sid = str(p.shipmentId);
      return {
        key: `shipment_refused:${sid || number}:${row.id ?? Date.now()}`,
        kind: "shipment_refused",
        number,
        title: `📦 Перевозчик не принял посылку: ${number}`,
        body: "Этикетки нет. Откройте заказ и нажмите «Отправить заново»; не пройдёт снова — проверьте телефон и адрес покупателя.",
      };
    }
    /* Nobody collected it and the carrier is sending it back (B14,
       src/lib/shipping/shipment-sync.ts). Once per parcel. */
    case "shipment.returned": {
      const sid = str(p.shipmentId);
      const who = CARRIER[str(p.carrier).toLowerCase()] || "";
      return {
        key: `shipment_returned:${sid || number}`,
        kind: "shipment_returned",
        number,
        title: `📦 Посылка возвращается: ${number}`,
        body: `${who ? `${who}: п` : "П"}окупатель не забрал посылку, она едет обратно в магазин. Свяжитесь с покупателем — отправить заново или вернуть деньги.`,
      };
    }
    default:
      return null;
  }
}

/* ---------- sending ------------------------------------------------------ */

export interface OwnerAlertResult {
  sent: boolean;
  /** Why not: `duplicate` (already sent once), `capped`, `no_channel`, `error`. */
  reason?: "duplicate" | "capped" | "no_channel" | "error";
}

/** The panel on this order's card — the same path the paid-order push carries. */
function orderPath(number: string): string {
  return `/shop2/admin/?order=${encodeURIComponent(number)}`;
}

/** `claimed` — ours to send; `taken` — somebody sent it; `unknown` — no database answer, send anyway. */
async function claim(alert: OwnerAlert): Promise<"claimed" | "taken" | "unknown"> {
  try {
    const rows = await query<{ key: string }>(
      `insert into owner_alerts (key, kind, number) values ($1, $2, $3)
       on conflict (key) do nothing
       returning key`,
      [alert.key.slice(0, 500), alert.kind, alert.number.slice(0, 64)],
    );
    return rows.length ? "claimed" : "taken";
  } catch (err) {
    /* A duplicated alert is better than a missing one: the thing it is about
       went wrong while the database was hiccuping, which is when it matters. */
    console.error("[owner-alerts] could not claim the alert, sending it anyway:", err);
    return "unknown";
  }
}

async function overCap(key: string): Promise<boolean> {
  try {
    const [row] = await query<{ n: number }>(
      `select count(*)::int as n from owner_alerts
        where at > now() - interval '1 hour' and key <> $1 and note is distinct from 'capped'`,
      [key.slice(0, 500)],
    );
    return Number(row?.n) >= OWNER_ALERT_HOURLY_CAP;
  } catch {
    return false;
  }
}

async function mark(key: string, delivered: boolean, note?: string): Promise<void> {
  try {
    await query("update owner_alerts set delivered = $2, note = $3 where key = $1", [key.slice(0, 500), delivered, note ?? null]);
  } catch (err) {
    console.error("[owner-alerts] could not record the outcome:", err);
  }
}

async function ping(alert: OwnerAlert): Promise<boolean> {
  const path = orderPath(alert.number);
  const text = [alert.title, alert.body, alert.detail ?? "", `Открыть в панели: ${baseUrl()}${path}`]
    .filter(Boolean)
    .join("\n");
  /* Loaded here, not at the top: the renderers behind mail-hooks are not
     wanted in the static graph of every module that writes a journal row. */
  const { pingOwner } = await import("@/lib/mail-hooks");
  return pingOwner(`REMPIRE — ${alert.title.replace(/^[^\p{L}\p{N}]+/u, "")}`, text, {
    title: alert.title,
    body: alert.body,
    url: path,
    /* One line per alert in the shade: never the paid order's own line
       (`order:<id>`), and a second copy of the same news replaces the first. */
    tag: `alert:${alert.key}`,
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claim the alert's key and send it — once, whoever asks. Never throws.
 */
export async function sendOwnerAlert(alert: OwnerAlert): Promise<OwnerAlertResult> {
  try {
    const claimed = await claim(alert);
    if (claimed === "taken") return { sent: false, reason: "duplicate" };
    if (claimed === "claimed" && (await overCap(alert.key))) {
      console.warn(`[owner-alerts] ${alert.kind} ${alert.number}: over ${OWNER_ALERT_HOURLY_CAP} alerts this hour — recorded, not sent`);
      await mark(alert.key, false, "capped");
      return { sent: false, reason: "capped" };
    }
    const delivered = await withTimeout(ping(alert).catch(() => false), ALERT_TIMEOUT_MS, false);
    if (claimed === "claimed") await mark(alert.key, delivered);
    console.info(`[owner-alerts] ${alert.kind} ${alert.number}: ${delivered ? "sent" : "no channel took it"}`);
    return delivered ? { sent: true } : { sent: false, reason: "no_channel" };
  } catch (err) {
    console.error("[owner-alerts] alert failed:", err);
    return { sent: false, reason: "error" };
  }
}

/**
 * writeAudit()'s hook: the alert this journal row raises, sent after the
 * response inside a request, or now outside one. Never throws; resolves at
 * once inside a request.
 */
export async function alertFromJournal(row: JournalRow): Promise<void> {
  let alert: OwnerAlert | null;
  try {
    alert = alertForJournal(row);
  } catch (err) {
    console.error(`[owner-alerts] could not read the ${row.action} row:`, err);
    return;
  }
  if (!alert) return;
  const ready = alert;
  const task = async (): Promise<void> => {
    await sendOwnerAlert(ready);
  };
  try {
    after(task);
  } catch {
    // outside a request — a test, a script: now, and bounded
    await task();
  }
}
