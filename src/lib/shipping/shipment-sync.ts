/**
 * One parcel status, applied to one order — whoever brought the news.
 *
 * The news comes by **the webhook** (POST /api/shipping/notify/) — Montonio
 * pushes every transition. Its retry policy is now known (support,
 * 24.09.2026): «15 attempts total. The first retry happens after about 10
 * seconds, and the interval grows exponentially … roughly 1.5–2 days». So a
 * notification can arrive two days late, after a newer one — which is why a
 * webhook never moves a parcel BACKWARDS here.
 *
 * …and by **the nightly poll** (`syncStaleShipments()` below, from the daily
 * cron) — Montonio's own advice in the same answer: «Since you rely solely on
 * the webhook for tracking, we'd still recommend occasionally polling
 * shipment status via GET as a backup, in case an event ever ends up
 * undelivered.» `GET /shipments/{id}` is the state now, so the poll may move a
 * parcel in either direction.
 *
 * Whoever brings it, `applyShipmentUpdate()` does the same four things, so an
 * event lost on the way and found by the poll does exactly what it would have
 * done had it arrived:
 *
 *   1. the carrier's word goes onto `orders.shipping.montonio.status`;
 *   2. a tracking code the order does not have yet is filled in — the case
 *      that matters is a parcel registered AFTER the button press: a refused
 *      shipment repaired with PATCH, or one Montonio re-tried by itself;
 *   3. a refusal (`registrationFailed`) goes into the journal, so the owner
 *      hears it from the shop and not from the customer;
 *   4. «delivered» closes a `shipped` order, as the white list decides.
 *
 * Nothing here is written twice: every step either checks what is stored or
 * is idempotent (setOrderStatus only moves `shipped` → `delivered` once).
 */
import { query } from "@/lib/db";
import { shipmentRegistrationFailed } from "@/lib/montonio-problems";
import { getOrder, setOrderStatus, writeAuditSafe, type Order } from "@/lib/orders";
import {
  getMontonioShipment,
  isMontonioShippingConfigured,
  saveShipmentOnOrder,
  shipmentOnOrder,
  type MontonioShipment,
} from "@/lib/shipping/montonio";
import { statusMeaning, type ShipmentMeaning } from "@/lib/shipping/webhook";

/** What one piece of news says about a shipment, in Montonio's own words. */
export interface ShipmentUpdate {
  /** The status word exactly as it arrived (`data.status` / GET `status`). */
  status: string;
  /** The webhook's `eventType`; empty for the poll. */
  event?: string;
  /** The shipment the news is about. */
  shipmentId?: string;
  trackingCode?: string;
  trackingUrl?: string;
  dropOffPin?: string;
}

export interface ShipmentApplied {
  /** The word was written onto the order. */
  written: boolean;
  /** An older word than the one stored, delivered late — not written. */
  stale: boolean;
  /** Names a shipment this order does not hold — nothing written at all. */
  otherShipment: boolean;
  /** A tracking code the order lacked was filled in. */
  tracking: boolean;
  /** A refusal went into the journal. */
  refused: boolean;
  /** The order transition applied, if any. */
  applied: "" | "delivered";
  meaning: ShipmentMeaning;
}

/**
 * The lifecycle Montonio documents (overview § «What is the lifecycle of a
 * Shipment?»), in order. `registrationFailed` sits BELOW `registered`: it can
 * only follow `pending`, and a shipment that failed and then registered — by a
 * PATCH, or by Montonio retrying on its own — goes up. So a late
 * `registrationFailed` after `registered` is stale news, never a new refusal.
 * `delivered` and `returned` share the top. A word outside this list (a
 * carrier's own spelling) has no rank and is never called stale.
 */
const LIFECYCLE: Record<string, number> = {
  pending: 0,
  registrationfailed: 1,
  registered: 2,
  labelscreated: 3,
  intransit: 4,
  awaitingcollection: 5,
  delivered: 6,
  returned: 6,
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function lifecycleRank(status: unknown): number | null {
  const r = LIFECYCLE[norm(status)];
  return typeof r === "number" ? r : null;
}

/** Montonio's two final words — nothing more will happen to the parcel. */
export function isFinalShipmentStatus(status: unknown): boolean {
  const s = norm(status);
  return s === "delivered" || s === "returned";
}

const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : "");

/**
 * Apply one status to one order. Throws only when closing the order failed —
 * the webhook turns that into a 503 (Montonio will retry), the poll counts it.
 */
export async function applyShipmentUpdate(
  order: Order,
  update: ShipmentUpdate,
  opts: { source: "webhook" | "poll"; now?: Date },
): Promise<ShipmentApplied> {
  const now = (opts.now ?? new Date()).toISOString();
  const word = String(update.status ?? "").trim();
  const meaning = statusMeaning(word);
  const out: ShipmentApplied = {
    written: false,
    stale: false,
    otherShipment: false,
    tracking: false,
    refused: false,
    applied: "",
    meaning,
  };

  const stored = shipmentOnOrder(order);
  const id = String(update.shipmentId ?? "").trim();
  /* The order was found by its number, but the news is about a shipment it
     does not hold. Nothing on the order describes that parcel, and writing its
     status here would paint this order's card with someone else's news. */
  if (stored && id && stored.shipmentId !== id) {
    out.otherShipment = true;
    return out;
  }

  const storedRank = lifecycleRank(stored?.status);
  const newRank = lifecycleRank(word);
  /* A webhook can be two days late (15 retries), so it may carry an older
     word than the one the order already has. The poll reads the state now and
     is always believed. */
  out.stale =
    opts.source === "webhook" && storedRank !== null && newRank !== null && newRank < storedRank;

  const patch: Record<string, unknown> = {};
  if (word && !out.stale && word !== String(stored?.status ?? "")) {
    patch.status = word;
    patch.statusAt = now;
  } else if (word && opts.source === "webhook" && !out.stale) {
    // the same word again: still news that Montonio is talking about it
    patch.statusAt = now;
  }
  if (opts.source === "poll") patch.polledAt = now;

  /* A parcel registered after the button press — a PATCH that answered
     `pending`, or Montonio's own retry — has its tracking code only in the
     news. Filled in once, never overwritten: the code on the card is the one
     the customer's letter carried. */
  const code = String(update.trackingCode ?? "").trim();
  if (stored && code && !String(stored.trackingCode ?? "").trim() && (!id || id === stored.shipmentId)) {
    patch.trackingCode = code;
    const url = httpUrl(update.trackingUrl);
    if (url && !httpUrl(stored.trackingUrl)) patch.trackingUrl = url;
    const pin = String(update.dropOffPin ?? "").trim();
    if (pin && !String(stored.dropOffPin ?? "").trim()) patch.dropOffPin = pin;
    out.tracking = true;
  }

  if (Object.keys(patch).length) {
    try {
      await saveShipmentOnOrder(order.id, patch);
      out.written = "status" in patch;
    } catch (err) {
      /* Worth logging, not worth a redelivery: the vocabulary already has the
         word, and the poll comes back tomorrow. */
      console.error(`[shipment sync] could not store the status on ${order.number}`, err);
      out.tracking = false;
    }
  }

  /* `shipment.registrationFailed` — the carrier turned the parcel down. Two
     ways in, because only one of them is documented (audit F23): the word,
     and the event name the owner ticked when registering the webhook. Not
     news when the stored shipment is already registered or further on — that
     is a late copy of a refusal that has since been repaired — and, for the
     poll, not news when the order already said so (the webhook or the button
     press wrote that row). */
  const failedWord = norm(word) === "registrationfailed";
  const failedEvent = norm(update.event) === "shipment.registrationfailed";
  const alreadyPast = storedRank !== null && storedRank >= LIFECYCLE.registered;
  const alreadyKnown = opts.source === "poll" && norm(stored?.status) === "registrationfailed";
  if ((failedWord || failedEvent) && !alreadyPast && !alreadyKnown) {
    console.error(`[shipment sync] carrier refused the parcel for ${order.number} (${opts.source})`);
    await writeAuditSafe("system", "shipment.registration_failed", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: id || stored?.shipmentId || undefined,
      code: word,
      reason: shipmentRegistrationFailed(word).reason,
      event: update.event || undefined,
      source: opts.source === "poll" ? "poll" : undefined,
    });
    out.refused = true;
  }

  /* The white-list fallback, doing the one thing it is trusted with — and
     only from `shipped`, so an order closed by hand is not touched, a repeat
     finds nothing to do, and a parcel that came back (`returned`) is left
     open: it is on its way to Renat, not to the customer. `system` is the
     actor the nightly close uses for the same transition. */
  if (meaning === "delivered" && !out.stale && order.status === "shipped") {
    await setOrderStatus(order.id, "delivered", "system");
    out.applied = "delivered";
  }

  return out;
}

/* ---------- the nightly poll --------------------------------------------- */

/**
 * How long a shipment may go without news before the poll asks for it.
 *
 * Montonio's retries run for 1.5–2 days, so a lost event is only certainly
 * lost after two. Asking earlier costs one read-only GET and finds it a day
 * sooner; asking every run for a parcel Montonio talked about this morning
 * would be noise. Half a day, against a cron that runs once a day (Vercel
 * Hobby allows no more), means: anything quiet since yesterday's run.
 */
export const SHIPMENT_QUIET_HOURS = 12;
/** Shipments asked per run. The shop books a few parcels a week; twenty is weeks of them. */
export const SHIPMENT_POLL_LIMIT = 20;
/** The poll's share of the cron's one minute (maxDuration 60 in /api/cron/flows). */
export const SHIPMENT_POLL_BUDGET_MS = 12_000;

export interface ShipmentSyncRun {
  /** Shipments asked about this run. */
  checked: number;
  /** …whose status on the order changed. */
  changed: number;
  /** …that got a tracking code they lacked. */
  tracking: number;
  /** …whose refusal reached the journal. */
  refused: number;
  /** …whose order was closed as delivered. */
  closed: number;
  /** GETs Montonio did not answer, or updates that could not be written. */
  errors: number;
  /** Quiet shipments left for the next run (limit or time budget). */
  left: number;
  reason?: string;
}

type Candidate = { id: string; status: string; shipping: unknown; created_at: string | Date };

function when(v: unknown): number {
  const t = typeof v === "string" ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Ask Montonio for every shipment that has gone quiet, and apply what it says
 * exactly as the webhook would have (`applyShipmentUpdate`, source "poll").
 *
 * Which shipments: on an order that is still `paid` or `shipped`, not set
 * aside (`dismissed`), not in a final state (`delivered`, `returned`), and
 * with no news for SHIPMENT_QUIET_HOURS — «news» being the last webhook
 * (`statusAt`), the last poll (`polledAt`) or, for one never heard of, its
 * booking (`createdAt`). The least recently polled go first, so a long queue
 * is worked through over several nights rather than the same twenty forever.
 *
 * Bounded by count and by time, idempotent (an unchanged status writes only
 * `polledAt`; a refusal already on the order is not journalled again), and it
 * never throws: the letters that share the cron must go out whatever
 * Montonio does. `fetchShipment` and `configured` are the tests' doors.
 */
export async function syncStaleShipments(
  opts: {
    now?: number;
    limit?: number;
    budgetMs?: number;
    quietHours?: number;
    fetchShipment?: (shipmentId: string) => Promise<MontonioShipment>;
    configured?: () => boolean;
  } = {},
): Promise<ShipmentSyncRun> {
  const run: ShipmentSyncRun = { checked: 0, changed: 0, tracking: 0, refused: 0, closed: 0, errors: 0, left: 0 };
  const configured = opts.configured ?? (() => isMontonioShippingConfigured());
  if (!configured()) return { ...run, reason: "not_configured" };

  const now = opts.now ?? Date.now();
  const started = Date.now();
  const limit = Math.max(1, Math.min(100, opts.limit ?? SHIPMENT_POLL_LIMIT));
  const budget = Math.max(1_000, opts.budgetMs ?? SHIPMENT_POLL_BUDGET_MS);
  const quietMs = Math.max(0, opts.quietHours ?? SHIPMENT_QUIET_HOURS) * 60 * 60 * 1000;
  const fetchShipment = opts.fetchShipment ?? getMontonioShipment;

  let rows: Candidate[];
  try {
    /* The coarse cut in SQL (the order's own status, a shipment id present);
       the timestamps are read in code, where a malformed one is «unknown»
       rather than a cast that fails the whole query. */
    rows = await query<Candidate>(
      `select id, status, shipping, created_at
         from orders
        where status in ('paid', 'shipped')
          and coalesce(shipping -> 'montonio' ->> 'shipmentId', '') <> ''
        order by created_at desc
        limit 500`,
    );
  } catch (err) {
    console.error("[shipment sync] cannot read shipments:", err);
    return { ...run, reason: "error" };
  }

  const quiet = rows
    .map((row) => {
      const s = (row.shipping && typeof row.shipping === "object" ? row.shipping : {}) as Record<string, unknown>;
      const m = (s.montonio && typeof s.montonio === "object" ? s.montonio : {}) as Record<string, unknown>;
      const heard = Math.max(
        when(m.statusAt) || 0,
        when(m.polledAt) || 0,
        when(m.createdAt) || when(row.created_at) || 0,
      );
      return { id: row.id, m, heard, polled: when(m.polledAt) || 0 };
    })
    .filter(({ m, heard }) => m.dismissed !== true && !isFinalShipmentStatus(m.status) && now - heard >= quietMs)
    .sort((a, b) => a.polled - b.polled || a.heard - b.heard);

  for (let i = 0; i < quiet.length; i++) {
    if (run.checked >= limit || Date.now() - started > budget) {
      run.left = quiet.length - i;
      break;
    }
    const { id } = quiet[i];
    run.checked += 1;
    try {
      const order = await getOrder(id);
      const stored = order ? shipmentOnOrder(order) : null;
      if (!order || !stored) continue;
      const fresh = await fetchShipment(stored.shipmentId);
      const result = await applyShipmentUpdate(
        order,
        {
          status: fresh.status,
          shipmentId: fresh.shipmentId || stored.shipmentId,
          trackingCode: fresh.trackingCode,
          trackingUrl: fresh.trackingUrl,
          dropOffPin: fresh.dropOffPin,
        },
        { source: "poll", now: new Date(now) },
      );
      if (result.written) run.changed += 1;
      if (result.tracking) run.tracking += 1;
      if (result.refused) run.refused += 1;
      if (result.applied === "delivered") run.closed += 1;
    } catch (err) {
      /* not configured after all, a 404, a timeout, a close that failed —
         this one waits for tomorrow, the next is still asked */
      run.errors += 1;
      console.error(`[shipment sync] ${id}:`, err);
    }
  }
  return run;
}
