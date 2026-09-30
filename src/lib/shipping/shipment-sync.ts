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
 *   4. «delivered» closes a `shipped` order, as the white list decides;
 *   5. (since 27.09.2026, B14) a parcel coming back (`returned`) goes into
 *      the journal once, and never moves the order;
 *   6. (since 28.09.2026, the owner's decision) the carrier HAS the parcel —
 *      `inTransit`, `awaitingCollection` or `delivered`, Montonio's documented
 *      words only — on a `paid` order: the order becomes «Отправлен» through
 *      the owner's own door (shipOrder, src/lib/ship-order.ts) and the
 *      customer's tracking letter goes. On a cancelled or refunded order the
 *      same news moves nothing and is journalled once (`shipment.
 *      closed_moving`).
 * The journal rows of 3, 5 and 6's cancelled case reach the owner's phone by
 * themselves (writeAudit → src/lib/owner-alerts.ts).
 *
 * And, from the webhook only (26.09.2026, R-100098): news about a parcel on an
 * order that holds NO shipment id records that parcel on the order — the
 * booking's answer was lost to a timeout and Montonio booked it anyway, so the
 * event is the only place its id exists. Journalled as `shipment.adopt`.
 *
 * Nothing here is written twice: every step either checks what is stored or
 * is idempotent (setOrderStatus only moves `shipped` → `delivered` once, and
 * the carrier's «Отправлен» is a claim that only a `paid` order can answer).
 */
import { query } from "@/lib/db";
import { shipmentRegistrationFailed } from "@/lib/montonio-problems";
import { getOrder, setOrderStatus, writeAuditSafe, type Order } from "@/lib/orders";
import { carrierHasParcel, shipOrder, shippedBefore } from "@/lib/ship-order";
import {
  adoptShipmentOnOrder,
  getMontonioShipment,
  isMontonioShippingConfigured,
  MontonioShippingError,
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
  /** The rest of the shipment, when the news carries it (the webhook's signed `data`). */
  carrier?: string;
  country?: string;
  method?: "pickupPoint" | "courier" | "";
  createdAt?: string;
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
  /** The order held no shipment id and now holds this one (webhook only). */
  adopted: boolean;
  /** The carrier is sending the parcel back — journalled, once per parcel. */
  returned: boolean;
  /** This news made a `paid` order «Отправлен» (28.09.2026) — the letter went with it. */
  shipped: boolean;
  /** The carrier has a parcel of a cancelled or refunded order — journalled, once per parcel. */
  closedMoving: boolean;
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
 * Apply one status to one order. Throws only when closing the order failed, or
 * when a parcel the order had no id for could not be recorded — the webhook
 * turns that into a 503 (Montonio will retry), the poll counts it.
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
    adopted: false,
    returned: false,
    shipped: false,
    closedMoving: false,
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
  if (opts.source === "poll") {
    patch.polledAt = now;
    // an answer at last: the failure an earlier night wrote down is over (B12)
    if (stored && stored.pollError) patch.pollError = null;
  }

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

  /* The order holds NO shipment id and the news names one. R-100098,
     26.09.2026: the booking's own answer was lost to a timeout, Montonio had
     booked the parcel anyway, and this event was the only place its id
     existed. Only the status word used to be written here, so the shop went
     on believing there was no parcel and the next «Создать этикетку» would
     have booked — and paid for — a second one. Now the parcel is written down
     whole, from Montonio's signed word (id, carrier, tracking, the lot), and
     the button finds it and answers `reused`.
     Only from the webhook: the signature is what makes it believable, and the
     poll only ever asks about ids the order already holds. Conditional, like
     the booking claim: a shipment stored a moment earlier — by the press that
     booked it — is never replaced, and the news is applied to THAT instead. */
  if (!stored && id && opts.source === "webhook") {
    const url = httpUrl(update.trackingUrl);
    const record: Record<string, unknown> = {
      ...patch,
      provider: "montonio",
      shipmentId: id,
      carrier: String(update.carrier ?? "").trim() || undefined,
      country: String(update.country ?? "").trim().toUpperCase() || undefined,
      method: update.method || undefined,
      trackingCode: code || undefined,
      trackingUrl: url || undefined,
      dropOffPin: String(update.dropOffPin ?? "").trim() || undefined,
      createdAt: String(update.createdAt ?? "").trim() || now,
      dismissed: false,
      adoptedFrom: "webhook",
      adoptedAt: now,
    };
    let took = false;
    try {
      took = await adoptShipmentOnOrder(order.id, record);
    } catch (err) {
      /* Unlike a lost status word, a lost id is the whole bug: thrown, so the
         webhook answers 503 and Montonio sends the event again (15 tries over
         1.5–2 days) rather than the parcel going unrecorded. */
      console.error(`[shipment sync] could not record parcel ${id} on ${order.number}`, err);
      throw err;
    }
    if (!took) {
      const fresh = await getOrder(order.id).catch(() => null);
      if (fresh && shipmentOnOrder(fresh)) return applyShipmentUpdate(fresh, update, opts);
    } else {
      out.adopted = true;
      out.written = "status" in patch;
      out.tracking = !!code;
      console.error(`[shipment sync] ${order.number} had no parcel id — recorded ${id} from the webhook`);
      await writeAuditSafe("system", "shipment.adopt", {
        orderId: order.id,
        number: order.number,
        provider: "montonio",
        shipmentId: id,
        carrier: record.carrier,
        code: word || undefined,
        trackingCode: code || undefined,
        event: update.event || undefined,
        source: "webhook",
      });
    }
  } else if (Object.keys(patch).length) {
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
    const refusedId = id || stored?.shipmentId || "";
    const repeat = norm(stored?.status) === "registrationfailed" || (await refusedBefore(refusedId));
    await writeAuditSafe("system", "shipment.registration_failed", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: id || stored?.shipmentId || undefined,
      code: word,
      reason: shipmentRegistrationFailed(word).reason,
      event: update.event || undefined,
      source: opts.source === "poll" ? "poll" : undefined,
      /* The same refusal heard again — a webhook retry, the second of two
         event types, the poll after an event that left the word at
         `pending`. Still a row, as it always was, but not a second ping on
         the owner's phone (src/lib/owner-alerts.ts reads this). */
      repeat: repeat || undefined,
    });
    out.refused = true;
  }

  /* B14 (readiness pass 27.09.2026): the carrier is sending the parcel back —
     nobody collected it from the machine in the carrier's window (Omniva 4
     days, SmartPosti and DPD 7…, see looksReturned in src/lib/delivery.ts).
     The order stays where it is — it is not delivered, and it is not the
     shop's to close — and used to stay there in silence, counted only in the
     cron's JSON. Now it is a journal row, and through the journal a ping on
     Renat's phone (src/lib/owner-alerts.ts), and the order card says so.
     Once per parcel: the row is written on the move INTO `returned`, so a
     retried webhook, the nightly poll and the nightly close all find the
     word already stored and stay quiet. */
  const wasReturned = statusMeaning(String(stored?.status ?? "")) === "returned";
  if (meaning === "returned" && !out.stale && !wasReturned && (stored || out.adopted)) {
    console.error(`[shipment sync] the parcel for ${order.number} is on its way back (${opts.source})`);
    await writeAuditSafe("system", "shipment.returned", {
      orderId: order.id,
      number: order.number,
      provider: "montonio",
      shipmentId: id || stored?.shipmentId || undefined,
      carrier: String(stored?.carrier ?? update.carrier ?? "").trim() || undefined,
      code: word,
      orderStatus: order.status,
      source: opts.source === "poll" ? "poll" : undefined,
    });
    out.returned = true;
  }

  /* «Отправлен» by the carrier's scan — the owner's decision of 28.09.2026
     (Renat via Dim): he drops the parcel into the machine, and the carrier's
     scan is the hand-over. src/lib/ship-order.ts says why and how; here is
     WHEN, and it is a question about the state, not about this one event:
       · the carrier has the parcel — the word the order now holds for it
         (`heard`: this news, or the stored word when this news was an older
         one that arrived late), one of Montonio's three documented words
         (carrierHasParcel);
       · the parcel is this order's own Montonio shipment (stored, or adopted
         a moment ago above) and not a label the journal set aside;
       · the order is `paid` and has never been «Отправлен» before — an order
         the owner shipped and then took back by hand stays where he put it.
     So a repeat of the same event, the nightly re-ask of a paid order whose
     `inTransit` arrived before this rule existed (R-100098), and a late older
     word about a parcel already in transit all ship it — and only the first
     of them, because shipOrder() CLAIMS the move (only a `paid` row can
     answer), and every later one finds it `shipped`. The owner's press before
     or after is the same claim, from the other side.
     A failure to move the order throws, like the close below: the webhook
     answers 503 and Montonio sends the event again; the poll counts it and
     asks tomorrow. */
  const heard = out.stale ? String(stored?.status ?? "") : word || String(stored?.status ?? "");
  const ours = out.adopted || (!!stored && stored.dismissed !== true);
  let orderStatus: string = order.status;
  if (ours && carrierHasParcel(heard)) {
    if (order.status === "paid" && !shippedBefore(order)) {
      const shipped = await shipOrder(order, {
        actor: "system",
        hold: false,
        carrier: { shipmentId: id || stored?.shipmentId, carrierStatus: heard, source: opts.source },
      });
      if (shipped.order) {
        out.shipped = true;
        orderStatus = "shipped";
        console.info(`[shipment sync] ${order.number} is «Отправлен» by the carrier's scan (${heard}, ${opts.source})`);
        /* The card's progress line says «по скану» under «Отправлен» from
           this. Best effort: the journal row already says it. */
        try {
          await saveShipmentOnOrder(order.id, { autoShippedAt: now });
        } catch (err) {
          console.error(`[shipment sync] could not stamp the automatic «Отправлен» on ${order.number}`, err);
        }
      }
    } else if ((order.status === "cancelled" || order.status === "refunded") && (await claimClosedMoving(order.id, now))) {
      /* The carrier has a parcel of an order that is closed — cancelled after
         the label was made, or the money already sent back. Nothing moves:
         whether the parcel should go on is the owner's call, not the shop's.
         But he must hear it now, not from the customer: a journal row, and
         through it a ping (src/lib/owner-alerts.ts). Once per parcel — the
         stamp is claimed in the same statement that checks it. */
      console.error(`[shipment sync] the carrier has the parcel of ${order.status} order ${order.number} (${opts.source})`);
      await writeAuditSafe("system", "shipment.closed_moving", {
        orderId: order.id,
        number: order.number,
        provider: "montonio",
        shipmentId: id || stored?.shipmentId || undefined,
        carrier: String(stored?.carrier ?? update.carrier ?? "").trim() || undefined,
        code: heard,
        orderStatus: order.status,
        source: opts.source === "poll" ? "poll" : undefined,
      });
      out.closedMoving = true;
    }
  }

  /* The white-list fallback, doing the one thing it is trusted with — and
     only from `shipped`, so an order closed by hand is not touched, a repeat
     finds nothing to do, and a parcel that came back (`returned`) is left
     open: it is on its way to Renat, not to the customer. `system` is the
     actor the nightly close uses for the same transition. An order this very
     news has just shipped is closed by the same word it was shipped by —
     `delivered` as the first word the shop hears is two steps, in order,
     with the one letter the first of them sent. */
  const delivered = out.shipped ? statusMeaning(heard) === "delivered" : meaning === "delivered" && !out.stale;
  if (delivered && orderStatus === "shipped") {
    // the carrier's own «delivered» — its date is the hand-over (setOrderStatus carrierDelivered)
    await setOrderStatus(order.id, "delivered", "system", { carrierDelivered: true });
    out.applied = "delivered";
  }

  return out;
}

/**
 * The once-only stamp for `shipment.closed_moving`: set on the order's
 * shipment in the same UPDATE that checks it was not set, so two copies of the
 * same event cannot both journal it. False when it was already there, or when
 * the order holds no shipment to stamp.
 */
async function claimClosedMoving(orderId: string, now: string): Promise<boolean> {
  try {
    const rows = await query<{ id: string }>(
      `update orders
          set shipping = jsonb_set(shipping, '{montonio,closedMovingAt}', to_jsonb($2::text))
        where id = $1
          and jsonb_typeof(shipping -> 'montonio') = 'object'
          and (shipping -> 'montonio' ->> 'closedMovingAt') is null
        returning id`,
      [orderId, now],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(`[shipment sync] could not stamp the closed-order parcel on ${orderId}`, err);
    return false;
  }
}

/**
 * Has this shipment's refusal already been journalled since it was last sent
 * to the carrier again? «Отправить заново» that went through writes
 * `shipment.repair` (POST /api/admin/shipments); a refusal after that is news,
 * one before it is the same refusal heard twice. False when the journal cannot
 * say — a second ping is better than a missing one.
 */
async function refusedBefore(shipmentId: string): Promise<boolean> {
  if (!shipmentId) return false;
  try {
    const [row] = await query<{ n: number }>(
      `select count(*)::int as n from admin_audit
        where action = 'shipment.registration_failed' and payload ->> 'shipmentId' = $1
          and id > coalesce((select max(id) from admin_audit
                              where action = 'shipment.repair' and payload ->> 'shipmentId' = $1), 0)`,
      [shipmentId],
    );
    return Number(row?.n) > 0;
  } catch {
    return false;
  }
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
  /** …whose paid order became «Отправлен» by the carrier's scan (28.09.2026). */
  shipped: number;
  /** …that the carrier is sending back (B14) — journalled. */
  returned: number;
  /** GETs Montonio did not answer, or updates that could not be written. */
  errors: number;
  /** …of which Montonio answered 404 — no such shipment (a sandbox id under live keys). */
  notFound: number;
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
 * aside (`dismissed`), not in a final state (`delivered`, `returned`) — unless
 * the order is still `paid` with a `delivered` the carrier's scan has not
 * shipped yet (28.09.2026) — and
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
  const run: ShipmentSyncRun = {
    checked: 0, changed: 0, tracking: 0, refused: 0, closed: 0, shipped: 0, returned: 0, errors: 0, notFound: 0, left: 0,
  };
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
      /* A final word is normally the end of asking — except on a paid order
         the carrier's scan has not shipped yet (28.09.2026): a `delivered`
         that arrived before the rule existed, or one whose ship failed, would
         otherwise leave the order «оплачен» for ever. Asked again until it is
         shipped; an order the owner took back by hand (`shippedAt`) is his,
         and is not. */
      const unshipped =
        row.status === "paid" && carrierHasParcel(m.status) && !shippedBefore({ shipping: s } as unknown as Order);
      return { id: row.id, m, heard, polled: when(m.polledAt) || 0, unshipped };
    })
    .filter(
      ({ m, heard, unshipped }) =>
        m.dismissed !== true && (!isFinalShipmentStatus(m.status) || unshipped) && now - heard >= quietMs,
    )
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
      if (result.returned) run.returned += 1;
      if (result.shipped) run.shipped += 1;
      if (result.applied === "delivered") run.closed += 1;
    } catch (err) {
      /* not configured after all, a 404, a timeout, a close that failed —
         this one waits for tomorrow, the next is still asked */
      run.errors += 1;
      const code = err instanceof MontonioShippingError ? err.code : "error";
      if (code === "not_found") run.notFound += 1;
      console.error(`[shipment sync] ${id}:`, err);
      await notePollFailure(id, code, now);
    }
  }
  return run;
}

/**
 * B12 (readiness pass 27.09.2026): a check that failed is still a check.
 *
 * The queue is sorted by `polledAt`, least recently asked first — and
 * `polledAt` used to be written only by an answer (applyShipmentUpdate). So a
 * shipment Montonio would not answer for kept the oldest time in the shop and
 * went first again the next night, and the night after: twenty sandbox ids
 * that answer 404 under the live keys took all twenty places every night, and
 * a real parcel behind them was never asked about at all.
 *
 * Now the time goes on the parcel either way, with what went wrong beside it:
 * `pollError` is Montonio's error code — `not_found` for a 404, i.e. «Montonio
 * has no shipment with this id» — or `error` for anything else (a timeout, a
 * close that failed). A failing parcel therefore goes to the back of the queue
 * and waits its SHIPMENT_QUIET_HOURS like any other; the next answer clears the
 * error. Best effort: a write that fails is logged, and the run goes on.
 */
async function notePollFailure(orderId: string, code: string, now: number): Promise<void> {
  try {
    await saveShipmentOnOrder(orderId, { polledAt: new Date(now).toISOString(), pollError: code });
  } catch (err) {
    console.error(`[shipment sync] could not record the failed check on ${orderId}:`, err);
  }
}
