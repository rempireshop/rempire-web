/**
 * Before «Создать этикетку» books a parcel: does Montonio already have one?
 *
 * R-100098, the first live hour (26.09.2026). The press sent `POST /shipments`;
 * our fetch gave up after ten seconds; the route took that for «nothing was
 * booked» and freed the button. Montonio had booked it: `shipment.registered`
 * for shipment 3888e013-… arrived at 19:33:03 UTC. The webhook of the day
 * wrote only the status word onto the order — the id went into the journal's
 * first-sighting row and nowhere else — so the shop went on believing there
 * was no parcel, and the next press would have booked, and paid for, another.
 *
 * So a press on an order with no parcel id first looks for the parcel that
 * may exist, in the order it can be trusted:
 *   1. an id on the order itself — since 26.09.2026 the webhook stores one
 *      (src/lib/shipping/shipment-sync.ts); the route's `existing` check
 *      finds it before anything here runs;
 *   2. an id the journal ties to this order: any `shipment.*` row carrying a
 *      `shipmentId` and naming the order by its id, or by its number when the
 *      row is not older than the order (a number from before the go-live
 *      reset belongs to somebody else's R-100098);
 *   3. — nothing else. Montonio's Shipping API v2 lists thirteen endpoints and
 *      none of them searches shipments by `merchantReference`
 *      (docs/montonio-shipping-audit.md, the endpoint table). The shop does not
 *      guess at one.
 * Each candidate is asked for by id (`GET /shipments/{id}`, documented) and
 * adopted only if Montonio's copy names this order or names none. A candidate
 * Montonio cannot be asked about right now is not a «no»: the caller refuses
 * to book until it can be.
 */
import { query } from "@/lib/db";
import { writeAuditSafe, type Order } from "@/lib/orders";
import {
  MontonioShippingError,
  adoptShipmentOnOrder,
  getMontonioShipment,
  type MontonioShipment,
} from "@/lib/shipping/montonio";

/** Candidates asked about per press. One is the real case; three is generous. */
export const ADOPT_LEADS_MAX = 3;

/** Shipment ids the journal ties to this order, newest first. */
export async function shipmentLeads(order: Pick<Order, "id" | "number" | "createdAt">): Promise<string[]> {
  const rows = await query<{ sid: string }>(
    `select payload ->> 'shipmentId' as sid, max(id) as last
       from admin_audit
      where action like 'shipment.%'
        and coalesce(payload ->> 'shipmentId', '') <> ''
        and (payload ->> 'orderId' = $1
             or ((payload ->> 'number' = $2 or payload ->> 'order' = $2) and at >= $3::timestamptz))
      group by payload ->> 'shipmentId'
      order by last desc
      limit $4`,
    [order.id, order.number, order.createdAt, ADOPT_LEADS_MAX],
  );
  return rows.map((r) => String(r.sid)).filter(Boolean);
}

export type Adoption =
  /** Found at Montonio, checked, and now on the order. */
  | { kind: "adopted"; shipment: MontonioShipment & Record<string, unknown> }
  /** Another press or the webhook stored a parcel a moment ago — that one stands. */
  | { kind: "taken" }
  /** Nothing to adopt. `unverified`: a candidate exists that Montonio could not be asked about. */
  | { kind: "none"; unverified: boolean };

/**
 * Look for this order's parcel in the journal, ask Montonio about each
 * candidate, and adopt the first one that is really this order's.
 *
 * Throws only on a database failure (the caller answers 503 — a press that
 * cannot look must not book). `fetchShipment` is the tests' door.
 */
export async function adoptFromJournal(
  order: Order,
  opts: { fetchShipment?: (shipmentId: string) => Promise<MontonioShipment> } = {},
): Promise<Adoption> {
  const leads = await shipmentLeads(order);
  const fetchShipment = opts.fetchShipment ?? getMontonioShipment;
  let unverified = false;

  for (const lead of leads) {
    let fresh: MontonioShipment;
    try {
      fresh = await fetchShipment(lead);
    } catch (err) {
      // Montonio says there is no such shipment: not this order's parcel
      if (err instanceof MontonioShippingError && err.code === "not_found") continue;
      console.error(`[shipments] could not ask Montonio about ${lead} for ${order.number}:`, err);
      unverified = true;
      continue;
    }
    const ref = String(fresh.merchantReference ?? "").trim();
    if (ref && ref !== order.number) {
      console.error(`[shipments] ${lead} belongs to ${ref}, not ${order.number} — not adopted`);
      continue;
    }

    const at = new Date().toISOString();
    const ship = (order.shipping ?? {}) as unknown as Record<string, unknown>;
    const record: Record<string, unknown> = {
      provider: "montonio",
      shipmentId: fresh.shipmentId || lead,
      // an empty word says nothing — the status already on the order stays
      status: fresh.status || undefined,
      statusAt: at,
      carrier: fresh.carrier || String(ship.carrier ?? "") || undefined,
      country: fresh.country || String(ship.country ?? "").toUpperCase() || undefined,
      method: fresh.method,
      trackingCode: fresh.trackingCode,
      trackingUrl: fresh.trackingUrl,
      dropOffPin: fresh.dropOffPin,
      createdAt: fresh.createdAt || at,
      dismissed: false,
      adoptedFrom: "journal",
      adoptedAt: at,
    };
    if (!(await adoptShipmentOnOrder(order.id, record))) return { kind: "taken" };

    console.error(`[shipments] ${order.number} had no parcel id — adopted ${record.shipmentId} from the journal`);
    await writeAuditSafe("admin", "shipment.adopt", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: record.shipmentId,
      carrier: record.carrier,
      code: fresh.status || undefined,
      trackingCode: fresh.trackingCode || undefined,
      source: "journal",
    });
    const before = (ship.montonio && typeof ship.montonio === "object" ? ship.montonio : {}) as Record<string, unknown>;
    const shipment = { ...before, ...JSON.parse(JSON.stringify(record)), bookingAt: null, bookingUncertainAt: null };
    return { kind: "adopted", shipment: shipment as MontonioShipment & Record<string, unknown> };
  }
  return { kind: "none", unverified };
}

/**
 * A Montonio status on the order with no parcel id beside it — the webhook
 * spoke about a parcel the shop cannot name. Written only by the notify route
 * before 26.09.2026 (R-100098), or by an event that carried no id. It is proof
 * that a parcel exists, so it is never outwaited: the caller refuses to book.
 */
export function unlinkedParcelStatus(order: Pick<Order, "shipping">): string {
  const raw = (order.shipping as unknown as { montonio?: unknown } | null)?.montonio;
  if (!raw || typeof raw !== "object") return "";
  const m = raw as Record<string, unknown>;
  if (typeof m.shipmentId === "string" && m.shipmentId) return "";
  return typeof m.status === "string" ? m.status.trim() : "";
}
