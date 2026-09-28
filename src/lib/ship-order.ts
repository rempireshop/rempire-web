/**
 * «Отправлен» — one door, whoever opens it.
 *
 * Two hands move an order to `shipped`:
 *
 *   · the owner, on the order card: PATCH /api/admin/orders/<id>
 *     { status: "shipped" } — «Отправлен», or «Отправлен без этикетки» for a
 *     parcel that left some other way;
 *   · since 28.09.2026, the carrier. The owner's decision (Renat via Dim):
 *     Renat prints the label and drops the parcel into the carrier's machine,
 *     and when the carrier's scan reaches the shop through Montonio — the
 *     `shipment.statusUpdated` webhook, or the nightly re-ask that finds an
 *     event the webhook lost — the order becomes «Отправлен» and the customer's
 *     tracking letter goes out, with nobody pressing anything
 *     (applyShipmentUpdate in src/lib/shipping/shipment-sync.ts). The evidence
 *     that made the press redundant: live order R-100098 (DPD parcel machine)
 *     got `inTransit` on 27.09.2026 17:24 UTC by itself, and the order sat at
 *     «оплачен» with no tracking letter until somebody would have noticed.
 *
 * Both go through shipOrder() below, so the status, the `shippedAt` stamp, the
 * journal row and the one «Заказ отправлен» letter are the same code, and the
 * two can race without doubling anything: the move is a CLAIM
 * (setOrderStatus's `unless`, checked inside the UPDATE), and only the call
 * whose UPDATE moved the row sends the letter. The press on a card read before
 * the scan landed finds the order already `shipped` and does nothing; the scan
 * after a press finds it `shipped` and does nothing.
 *
 * What the label is NOT: «Создать этикетку» (POST /api/admin/shipments) still
 * never ships — a label is a sticker, not a hand-over (Renat, before
 * 18.09.2026: «нажимаю „этикетка“ — меняется весь статус»). It is the
 * CARRIER'S scan that ships now, not the owner's label.
 *
 * The letter. The owner's press holds it ten seconds (src/lib/letter-hold.ts)
 * because the toast under his thumb has a «Вернуть» that must be able to stop
 * it. The carrier has no toast and nobody to take it back, so its letter goes
 * at once, from inside the webhook or the cron — the same letter
 * (sendShippedLetter), with the tracking code the order holds at that moment.
 * Resend's idempotency key (`shipped:<number>:<code>`, src/lib/mail-hooks.ts)
 * is a second lock behind the claim.
 */
import { dropStatusLetters, holdAndSend, type LetterHeld } from "@/lib/letter-hold";
import { ORDER_STATUSES, setOrderStatus, type Order, type OrderStatus } from "@/lib/orders";
import { shipmentOnOrder } from "@/lib/shipping/montonio";

/**
 * Montonio's own words for «the carrier has the parcel» — the lifecycle its
 * overview page documents (pending, registered, registrationFailed,
 * labelsCreated, inTransit, awaitingCollection, delivered, returned), and of
 * those only the three that mean a carrier has scanned it: on its way, in the
 * machine at the other end, handed over. Compared whole and without regard to
 * case, and nothing else: not `registered` or `labelsCreated` (a label exists,
 * the parcel may still be on Renat's shelf), not `returned` (it is coming back
 * to him), not a carrier's own spelling Montonio might pass through one day
 * («in_transit», «completed») — an unknown word ships nothing, and the panel's
 * nudge (B13 in public/shop2/app.js) stays for it.
 */
export const CARRIER_HAS_PARCEL: readonly string[] = ["intransit", "awaitingcollection", "delivered"];

export function carrierHasParcel(status: unknown): boolean {
  return CARRIER_HAS_PARCEL.includes(String(status ?? "").trim().toLowerCase());
}

/** The two statuses after «Отправлен» — a step back from either is not a hand-over. */
export function handedOver(status: string): boolean {
  return status === "shipped" || status === "delivered";
}

/**
 * Has this order been «Отправлен» before — the owner pressed it, and later
 * took it back to «оплачен» by hand? `shipping.shippedAt` is stamped by the
 * first move to `shipped` and never removed (setOrderStatus in
 * src/lib/orders.ts). The carrier's scan leaves such an order alone: the
 * owner undid that step on purpose, and a second hand-over would be a second
 * «Заказ отправлен» in the customer's inbox. The panel's nudge covers it.
 */
export function shippedBefore(order: Pick<Order, "shipping">): boolean {
  const s = order.shipping as unknown as Record<string, unknown> | null | undefined;
  return !!(s && typeof s === "object" && typeof s.shippedAt === "string" && s.shippedAt);
}

/**
 * «Заказ отправлен», with the carrier's tracking code and link when the order
 * carries a Montonio shipment (src/lib/shipping/montonio.ts) — without one the
 * letter still goes, saying the number will follow. Loaded lazily by a
 * literal specifier (so the bundler traces it into the function) and never
 * allowed to throw: a status that already moved must not fail because Resend
 * had a bad day. (Moved here from the order PATCH route, 28.09.2026 — both
 * hands send it.)
 */
export async function sendShippedLetter(order: Order): Promise<void> {
  try {
    const { onOrderShipped } = await import("@/lib/mail-hooks");
    const shipment = shipmentOnOrder(order);
    await onOrderShipped(
      order,
      shipment && !shipment.dismissed
        ? { carrier: shipment.carrier, code: shipment.trackingCode, url: shipment.trackingUrl }
        : undefined,
    );
  } catch (err) {
    console.error("[ship-order] onOrderShipped failed:", err);
  }
}

export interface ShipOrderOptions {
  /** `admin` for the owner's press; `system` for the carrier's scan. */
  actor: string;
  /**
   * Hold the letter ten seconds for the toast's «Вернуть» (the owner's press),
   * or send it now (the carrier's scan — there is no toast to take it back).
   */
  hold: boolean;
  /**
   * The carrier's scan: ships only an order that is `paid` right now, inside
   * the UPDATE, and its journal row says so (`via: "carrier"` plus these
   * words). Absent for the owner's press, which ships from any status the card
   * offers it on, exactly as it always did.
   */
  carrier?: { shipmentId?: string; carrierStatus: string; source: "webhook" | "poll" };
}

export interface ShipOrderResult {
  /** The order as the move left it — null when this call did not move it (somebody else did). */
  order: Order | null;
  /** The letter this move sends: held (the press), sent now (the scan), or none (an undo of «Доставлен»). */
  letter?: LetterHeld | { held: false };
}

/**
 * Move an order to `shipped` and say so to the customer — once.
 *
 * `order.status` is the status the CALLER saw (the card, or the order row the
 * news was applied to). It decides the claim and whether a letter goes:
 *
 *   · from `delivered` (the journal's undo of «Доставлен»): refused only if the
 *     order is already `shipped`; no letter — the parcel left once;
 *   · from anything else (`paid`, and whatever else the owner's PATCH is
 *     given): refused if the order is already `shipped` OR `delivered` by the
 *     time the UPDATE runs — the scan got there first, or the scan and the
 *     delivery both did — and the letter goes only with a move that happened;
 *   · the carrier: refused unless the order is `paid` at that moment.
 */
export async function shipOrder(
  order: Pick<Order, "id" | "status">,
  opts: ShipOrderOptions,
): Promise<ShipOrderResult> {
  const from = String(order.status ?? "");
  const unless: readonly OrderStatus[] = opts.carrier
    ? ORDER_STATUSES.filter((s) => s !== "paid")
    : handedOver(from)
      ? ["shipped"]
      : ["shipped", "delivered"];
  const audit = opts.carrier
    ? {
        via: "carrier",
        shipmentId: opts.carrier.shipmentId || undefined,
        carrierStatus: opts.carrier.carrierStatus,
        source: opts.carrier.source,
      }
    : undefined;
  const moved = await setOrderStatus(order.id, "shipped", opts.actor, { unless, audit });
  if (!moved) return { order: null };

  /* A held «Заказ отменён» the move no longer justifies is voided, exactly as
     every other status move does (src/lib/letter-hold.ts). */
  await dropStatusLetters(order.id, "shipped");

  // the letter goes with the first hand-over only — not when «Доставлен» is undone back to shipped
  if (handedOver(from)) return { order: moved };
  if (opts.hold) return { order: moved, letter: await holdAndSend(order.id, "shipped", sendShippedLetter) };
  await sendShippedLetter(moved);
  return { order: moved, letter: { held: false } };
}
