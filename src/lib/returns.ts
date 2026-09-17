/**
 * «Хочу вернуть заказ» — the tick, and the whole of what this shop can
 * honestly build around a return.
 *
 * Montonio hands the merchant no return codes ("These are only sent to the
 * customer") and its Shipping API v2 has no return endpoint at all — no return
 * shipment, no label, no webhook event. The audit went through every one of
 * them: docs/audit/2026-09-07-shipping-returns.md § «Ответ 2». So there is no
 * label for this shop to print and no parcel for it to book, and a "returns
 * process" in the panel would be a screen made of promises nobody can keep.
 *
 * What is left is what Dim chose on 08.09.2026, and it is this: the customer
 * ticks a delivered order in «Кабинет → Мои заказы», the shop records that a
 * return was asked for and when, the tick reaches the owner through the same
 * «Сделать сегодня» queue a new review and a partner request reach him through
 * (qAttention in src/lib/analytics.ts), and a person writes back. Nothing in
 * this file — and nothing in the words around it — promises a label.
 *
 * The window is the one /shop2/info/returns/ already states: **30 days from
 * receiving the order** (public/shop/legal.ru.js, «returns» — «вы можете
 * запросить возврат в течение 30 дней после получения товара»). The 14-day EU
 * right of withdrawal named further down that same page is the legal minimum
 * living inside those 30 days, not a second, shorter window; counting the
 * longer of the two is the only choice that never hides the tick from a
 * customer who still has the right to use it.
 *
 * Where it is stored: `orders.shipping.returnRequest = {at}`, beside the
 * shipment Montonio registered and beside `shipping.deliveredAt`, the stamp
 * setOrderStatus() writes the first time the owner presses «Доставлен». See
 * db/migrations/150_order_return_request.sql for why neither is a column.
 *
 * This module imports nothing but the database, on purpose: src/lib/
 * customers.ts reads it for the account screen and is itself a leaf that
 * nothing in lib/ pulls in. The audit row for the tick is written by the
 * route (POST /api/account/return-request/), which is where the actor — the
 * customer's own address — is known.
 */
import { query } from "@/lib/db";

/** The window /shop2/info/returns/ states, in days from the hand-over. */
export const RETURN_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * As much of an order as returns care about. Structural rather than the Order
 * type from src/lib/orders.ts, so this file stays a leaf — an Order satisfies
 * it as it is, and so does the row the account screen builds.
 */
export type ReturnableOrder = {
  id: string;
  number: string;
  status: string;
  shipping: unknown;
  updatedAt: string;
};

/** The fulfilment stamps this module keeps on the order's shipping jsonb. */
type ReturnFields = {
  deliveredAt?: unknown;
  returnRequest?: { at?: unknown; doneAt?: unknown } | null;
};

function fields(shipping: unknown): ReturnFields {
  return shipping && typeof shipping === "object" ? (shipping as ReturnFields) : {};
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * When the order was handed over, as far as the shop knows.
 *
 * `shipping.deliveredAt` is the honest answer and is on every order delivered
 * since that stamp shipped. For one marked «Доставлен» before it existed there
 * is only `updated_at`, which for such an order is the moment the mark was
 * made unless the owner has touched it since — in which case the window comes
 * out generous rather than short. Erring long is deliberate: a customer inside
 * their rights must never find the tick missing.
 */
export function deliveredAt(order: Pick<ReturnableOrder, "shipping" | "updatedAt">): string | null {
  return isoOrNull(fields(order.shipping).deliveredAt) ?? isoOrNull(order.updatedAt);
}

/** The last moment the tick is offered — `null` when there is no hand-over to count from. */
export function returnWindowEnds(order: Pick<ReturnableOrder, "shipping" | "updatedAt">): string | null {
  const from = deliveredAt(order);
  if (!from) return null;
  return new Date(new Date(from).getTime() + RETURN_WINDOW_DAYS * DAY_MS).toISOString();
}

/** When the customer ticked it, or `null` — nobody has asked. */
export function returnRequestedAt(order: Pick<ReturnableOrder, "shipping">): string | null {
  const req = fields(order.shipping).returnRequest;
  return req && typeof req === "object" ? isoOrNull(req.at) : null;
}

/**
 * When the owner marked the request dealt with, or `null` — it is still open.
 *
 * Dim, 17.09.2026. The counter on «Обзор» and the «Возвраты» chip both said,
 * in so many words, «в счётчике — те, на которые вы ещё не ответили», and
 * neither could ever fall: the tick was the only thing stored, and nothing in
 * the shop wrote a second stamp beside it. A request the owner had already
 * settled sat in the number for good, so the number was «сколько людей когда-
 * либо просили вернуть заказ» wearing the words «сколько ждут ответа».
 *
 * What it deliberately is NOT tied to:
 *
 *   · **not a letter.** He rings the customer as often as he writes — the
 *     return that was settled on the phone would never leave the counter.
 *   · **not a refund.** «Вернуть деньги» is the answer to some returns and not
 *     to others: a return he looked at and turned down (opened cosmetics,
 *     outside the window, the customer changed their mind again) is answered
 *     and refunded nothing. Hanging the stamp on the money would leave exactly
 *     those in the queue for good — the ones he has already spent his time on.
 *
 * So it is its own thing: one button, «Обработано», on the order card. It
 * moves no money, sends nothing and changes no status — it says «я этим
 * занялся», which is the only fact the counter was ever asking about.
 */
export function returnHandledAt(order: Pick<ReturnableOrder, "shipping">): string | null {
  const req = fields(order.shipping).returnRequest;
  return req && typeof req === "object" ? isoOrNull(req.doneAt) : null;
}

export type ReturnHandledOutcome =
  | { ok: true; at: string | null }
  | { ok: false; error: "not_requested" };

/**
 * Stamp — or un-stamp — «Обработано» on a return request.
 *
 * Only ever on an order that carries a request: there is nothing to answer
 * otherwise, and writing the key onto an order nobody asked about would put a
 * `returnRequest` object on it out of thin air, which is exactly what
 * `admReturnAskedAt()` and the partial index read to mean «somebody asked».
 *
 * `done: false` is the undo, and it deletes the key rather than writing a
 * false: «нет ключа» is what every order the owner has not answered looks
 * like, and one shape for one state keeps the count a single `is null`.
 */
export async function setReturnHandled(
  orderId: string,
  done = true,
  now: Date = new Date(),
): Promise<ReturnHandledOutcome> {
  const at = done ? now.toISOString() : null;
  const rows = await query<{ at: string | null }>(
    `update orders
        set shipping = case when $2::text is null
                         then shipping #- '{returnRequest,doneAt}'
                         else jsonb_set(shipping, '{returnRequest,doneAt}', to_jsonb($2::text)) end,
            updated_at = now()
      where id = $1 and (shipping -> 'returnRequest') is not null
      returning shipping -> 'returnRequest' ->> 'doneAt' as at`,
    [orderId, at],
  );
  if (!rows.length) return { ok: false, error: "not_requested" };
  return { ok: true, at: isoOrNull(rows[0]?.at) };
}

/**
 * May this order still be ticked? Delivered, inside the window, and nobody has
 * asked yet — the same three questions the account screen asks before it draws
 * the tick and the route asks again before it writes.
 */
export function canRequestReturn(
  order: Pick<ReturnableOrder, "status" | "shipping" | "updatedAt">,
  now: Date = new Date(),
): boolean {
  if (order.status !== "delivered") return false;
  if (returnRequestedAt(order)) return false;
  const ends = returnWindowEnds(order);
  return !!ends && now.getTime() <= new Date(ends).getTime();
}

export type ReturnRequestOutcome =
  | { ok: true; at: string; repeat: boolean }
  | { ok: false; error: "not_delivered" | "window_closed" };

/**
 * The tick itself, on an order the caller has already proved belongs to this
 * customer — POST /api/account/return-request/ reads the address out of the
 * signed cookie and matches it against the order before calling in here, so an
 * order that is somebody else's never gets this far.
 *
 * Safe to run twice: the update writes only where no tick is stored yet, so a
 * double tap — or a retried request — keeps the first date and reports it back
 * with `repeat: true` rather than moving the day the owner sees.
 */
export async function recordReturnRequest(
  order: ReturnableOrder,
  now: Date = new Date(),
): Promise<ReturnRequestOutcome> {
  if (order.status !== "delivered") return { ok: false, error: "not_delivered" };

  const already = returnRequestedAt(order);
  if (already) return { ok: true, at: already, repeat: true };

  const ends = returnWindowEnds(order);
  if (!ends || now.getTime() > new Date(ends).getTime()) return { ok: false, error: "window_closed" };

  const at = now.toISOString();
  const rows = await query<{ id: string }>(
    `update orders
        set shipping = coalesce(shipping, '{}'::jsonb)
                       || jsonb_build_object('returnRequest', jsonb_build_object('at', $2::text)),
            updated_at = now()
      where id = $1 and (shipping -> 'returnRequest') is null
      returning id`,
    [order.id, at],
  );
  /* Nothing updated means a tick landed between the read above and this write
     — two taps on a slow phone. That is the same "already asked" answer, not
     an error, so the stored date is read back rather than reported as a
     failure. */
  if (!rows.length) {
    const back = await query<{ at: string | null }>(
      "select shipping -> 'returnRequest' ->> 'at' as at from orders where id = $1",
      [order.id],
    );
    return { ok: true, at: isoOrNull(back[0]?.at) ?? at, repeat: true };
  }
  return { ok: true, at, repeat: false };
}
