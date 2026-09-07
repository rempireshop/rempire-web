/**
 * «Доставлен» without Renat pressing it.
 *
 * The last step of an order was manual, sent nothing, and would have meant
 * tracking every parcel by hand to know when to press it. Dim's answer was
 * «we need to improve this», so this module closes it for him — from the same
 * once-a-day cron the letters run on (`GET /api/cron/flows`, one run a day on
 * the free plan, docs/flows.md).
 *
 * Two ways, in this order, and both only for orders that are already
 * `shipped`:
 *
 * 1. **The carrier's own answer.** Montonio's shipping API DOES expose a
 *    status — `GET /shipments/<id>` returns one, and there is a
 *    `shipment.statusUpdated` webhook we deliberately do not register
 *    (docs/shipping.md: registration is synchronous, so nothing needed one
 *    until now). `getMontonioShipment()` already reads it. What the reference
 *    does not spell out is the vocabulary of that field, so this asks a
 *    narrow question — «does the status LOOK delivered» — and treats anything
 *    it does not recognise as «not yet». A wrong «доставлен» is worse than a
 *    late one: the order stops appearing in «В пути» and Renat stops looking
 *    at it.
 *
 * 2. **Time, with a setting.** `settings.delivery.autoDays` — «закрывать
 *    заказ через N дней после отправки». 0 (the default) means never: a shop
 *    that has not decided must not be marking parcels delivered on its own.
 *    This is the fallback for a hand-over with no Montonio record at all
 *    (a courier collecting from the salon, a parcel booked elsewhere) and for
 *    a carrier whose status never becomes anything this recognises.
 *
 * Nothing here sends a letter — `delivered` never did (docs/shipping.md) —
 * and nothing here throws: a close that fails is a close that did not happen,
 * and the button in the panel still works.
 */
import { query } from "@/lib/db";
import { setOrderStatus } from "@/lib/orders";

/** Same shape the flows report uses, so the cron's answer stays one document. */
export interface DeliveryRun {
  closed: number;
  checked: number;
  /** Parcels the carrier has sent back — left open on purpose, not closed. */
  returned?: number;
  reason?: string;
}

export interface DeliverySettings {
  /** Days after «Отправлен» to close an order nobody closed. 0 = never. */
  autoDays: number;
  /** Ask Montonio whether the parcel has arrived. */
  useCarrier: boolean;
}

export const DELIVERY_DEFAULTS: DeliverySettings = { autoDays: 0, useCarrier: true };
/** More than a month in the post is a lost parcel, not a slow one. */
export const MAX_AUTO_DAYS = 60;

export function cleanDelivery(raw: unknown): DeliverySettings {
  const x = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const days = Math.trunc(Number(x.autoDays));
  return {
    autoDays: Number.isFinite(days) && days > 0 ? Math.min(days, MAX_AUTO_DAYS) : 0,
    useCarrier: x.useCarrier === undefined ? DELIVERY_DEFAULTS.useCarrier : x.useCarrier !== false,
  };
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  try {
    const rows = await query<{ value: unknown }>("select value from settings where key = 'delivery'");
    let raw: unknown = rows.length ? rows[0].value : null;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    return cleanDelivery(raw);
  } catch {
    return { ...DELIVERY_DEFAULTS };
  }
}

/**
 * Does a carrier status mean «the customer has it»?
 *
 * Deliberately a small allow-list rather than «anything that is not one of the
 * statuses we know are in-flight»: this decides whether an order leaves the
 * owner's screen, and an unknown word must fall on the safe side. The spellings
 * are the ones carriers and Montonio use between them — the exact vocabulary of
 * Montonio's own `status` field is not in the reference we have, so a status
 * this does not recognise simply leaves the order where it is.
 */
export function looksDelivered(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return false;
  if (looksReturned(s)) return false;
  return s === "delivered" || s === "completed" || s === "finished" ||
    s === "picked_up" || s === "collected" || s === "handed_over" ||
    s.startsWith("delivered");
}

/**
 * The parcel came back. Montonio's own shipment vocabulary is
 * `pending | registered | registrationFailed | inTransit | awaitingCollection |
 * delivered | returned` (docs.montonio.com, shipping v2, «Shipments»), and
 * `returned` is what an uncollected parcel becomes: the carriers hold it for
 * their own window — Omniva 4 days since 01.05.2026, SmartPosti and DPD 7,
 * Unisend 72 h plus 4 to redirect, Posti in Finland 5 — and then send it back
 * to the sender address held in Montonio, never to the machine it was dropped
 * into. The shop pays that leg at roughly the outbound price.
 *
 * Two reasons this matters here. It must never read as delivered — the
 * customer never got it. And `autoDays` closes a shipped order after N days
 * whatever the carrier says, so with that setting on, a parcel sitting on
 * Renat's own desk would have been marked «Доставлен» on schedule.
 */
export function looksReturned(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return false;
  return s === "returned" || s === "return" || s.startsWith("returned") ||
    s.startsWith("return_to") || s === "returning";
}

type ShippedRow = { id: string; number: string; shipping: unknown; updated_at: string | Date };

/** Orders that are `shipped` and have been for at least an hour. */
async function shippedOrders(limit: number): Promise<ShippedRow[]> {
  return query<ShippedRow>(
    `select id, number, shipping, updated_at
       from orders
      where status = 'shipped'
      order by updated_at
      limit ${Math.max(1, Math.min(200, limit))}`,
  );
}

function shipmentIdOf(shipping: unknown): string {
  const s = (shipping && typeof shipping === "object" ? shipping : {}) as Record<string, unknown>;
  const m = (s.montonio && typeof s.montonio === "object" ? s.montonio : {}) as Record<string, unknown>;
  const id = typeof m.shipmentId === "string" ? m.shipmentId : "";
  // a shipment the journal's undo set aside is not one to poll
  return m.dismissed === true ? "" : id;
}

/**
 * One pass. `now` is injectable for the tests, exactly like runFlows().
 *
 * Best effort per order: a carrier that does not answer leaves that one alone
 * and the next is still tried.
 */
export async function closeDeliveredOrders(now: number = Date.now()): Promise<DeliveryRun> {
  const settings = await getDeliverySettings();
  if (!settings.autoDays && !settings.useCarrier) return { closed: 0, checked: 0, reason: "disabled" };

  let rows: ShippedRow[];
  try {
    rows = await shippedOrders(100);
  } catch (err) {
    console.error("[delivery] cannot read shipped orders:", err);
    return { closed: 0, checked: 0, reason: "error" };
  }
  if (!rows.length) return { closed: 0, checked: 0 };

  const cutoff = settings.autoDays ? now - settings.autoDays * 24 * 60 * 60 * 1000 : null;
  let closed = 0;
  let returned = 0;
  for (const row of rows) {
    let deliver = false;
    /* A parcel the carrier has sent back is the one case where the clock must
       not run: it is on its way to Renat, not to the customer. Asked for
       whenever we have a shipment id, even with «спрашивать перевозчика» off,
       because the alternative is closing it as delivered by the calendar. */
    const shipmentId = shipmentIdOf(row.shipping);
    if (shipmentId) {
      try {
        const { getMontonioShipment } = await import("@/lib/shipping/montonio");
        const shipment = await getMontonioShipment(shipmentId);
        if (looksReturned(shipment.status)) {
          returned += 1;
          continue;
        }
        if (settings.useCarrier && looksDelivered(shipment.status)) deliver = true;
      } catch {
        /* not configured, a 404, a timeout — the time rule below still applies */
      }
    }

    if (!deliver && cutoff != null) {
      const since = new Date(row.updated_at as string).getTime();
      if (Number.isFinite(since) && since <= cutoff) deliver = true;
    }

    if (!deliver) continue;
    try {
      await setOrderStatus(row.id, "delivered", "system");
      closed += 1;
    } catch (err) {
      console.error(`[delivery] could not close ${row.number}:`, err);
    }
  }
  //  is reported so the nightly line says why a parcel did not close
  return { closed, checked: rows.length, returned };
}
