/**
 * POST /api/admin/shipments/  — { orderId } → register the parcel with a carrier
 *
 * The button behind «Создать этикетку» on the admin's order card. It hands the
 * order's shipping jsonb (parcel-machine id, or the courier address) to
 * Montonio, which registers it with Omniva / DPD / SmartPosti / Venipak and
 * hands back a tracking code; the result is merged into
 * `orders.shipping.montonio` so the label route and the panel can find it.
 *
 * **It registers, and nothing else.** The order's status stays exactly where
 * it was — a label is a sticker, not a hand-over: the parcel is still on the
 * shelf until the owner presses «Отправлен», which is its own explicit step
 * (PATCH /api/admin/orders/<id> { status: "shipped" } — that is where the
 * status moves and the customer's «Заказ отправлен» letter, tracking link
 * included, goes out). This route used to flip the order to `shipped` and
 * send the letter by itself, and the owner's complaint was exactly that:
 * «нажимаю „этикетка“ — меняется весь статус».
 *
 * Order of work, deliberately:
 *   1. Montonio first — nothing is written until the carrier accepted the parcel.
 *   2. then the order row, then admin_audit.
 *
 * Idempotent: a second press returns the shipment already stored rather than
 * booking (and paying for) a second parcel. A shipment the journal's undo had
 * set aside (`dismissed`, see MontonioShipment) is brought back the same way —
 * the parcel at the carrier is the same parcel. And a press that arrives while
 * the FIRST one is still inside Montonio — the timed-out tap on the owner's
 * phone — is answered `in_progress` rather than booking a second one: the slot
 * on the order row is claimed before the call (claimShipmentSlot).
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber, writeAuditSafe } from "@/lib/orders";
import {
  MontonioShippingError,
  claimShipmentSlot,
  createMontonioShipment,
  releaseShipmentSlot,
  saveShipmentOnOrder,
  shipmentOnOrder,
} from "@/lib/shipping/montonio";
import {
  getParcelSettings,
  noteLockerSize,
  suggestedLockerSize,
  takesLockerSize,
  toLockerSize,
} from "@/lib/shipping/parcel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which failures are the operator's fault (400) and which are ours (502). */
const CLIENT_ERRORS = new Set(["not_shippable", "point_unresolved", "no_courier_service"]);

/**
 * `{ length, width, height }` in centimetres from the panel → metres for
 * Montonio, or `null` when the body carries no usable box.
 *
 * All three sides or none: two of them describe nothing, and a parcel with a
 * length and no height is a 400 from Montonio rather than a smaller one.
 * Bounds are the same 1–200 cm the panel's fields carry, so a value that got
 * past the screen is still refused here.
 */
function cleanBox(raw: unknown): { length: number; width: number; height: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const side of ["length", "width", "height"] as const) {
    const cm = Number(x[side]);
    if (!Number.isFinite(cm) || cm <= 0 || cm > 200) return null;
    out[side] = Math.round((cm / 100) * 100) / 100;
  }
  return out as { length: number; width: number; height: number };
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: {
    orderId?: unknown;
    order?: unknown;
    weight?: unknown;
    carrier?: unknown;
    lockerSize?: unknown;
    box?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const id = String(body.orderId ?? body.order ?? "").trim();
  if (!id) return Response.json({ ok: false, error: "bad_order" }, { status: 400 });

  let order;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/admin/shipments] order read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const existing = shipmentOnOrder(order);
  if (existing) {
    if (existing.dismissed) {
      try {
        await saveShipmentOnOrder(order.id, { dismissed: false });
      } catch (err) {
        console.error("[api/admin/shipments] could not bring the shipment back:", err);
        return Response.json({ ok: false, error: "store_failed", shipment: existing }, { status: 500 });
      }
      await writeAuditSafe("admin", "shipment.step", { orderId: order.id, number: order.number, labelStep: true });
    }
    return Response.json(
      { ok: true, reused: true, shipment: { ...existing, dismissed: false }, order },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // An unpaid parcel is a parcel nobody has been charged for.
  if (order.status !== "paid" && order.status !== "shipped") {
    return Response.json({ ok: false, error: "not_paid", detail: order.status }, { status: 409 });
  }

  /* The slot is taken BEFORE Montonio is called. Everything above ran against
     a snapshot of the order, and between "there is no shipment here" and the
     write at the bottom sits a live call to a carrier: a press that timed out
     on the owner's phone and was pressed again booked — and paid for — a
     second parcel. `false` means another press is inside that call right now
     (claimShipmentSlot, which expires by itself). */
  let claimed = false;
  try {
    claimed = await claimShipmentSlot(order.id);
  } catch (err) {
    console.error("[api/admin/shipments] could not claim the booking slot:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!claimed) return Response.json({ ok: false, error: "in_progress" }, { status: 409 });

  /* The locker door, and the only place it can honestly be decided: the owner
     is standing over the box he has just packed. The panel pre-selects one and
     posts it, so pressing the button is a confirmation and not a question —
     but the *default* is the server's, not the panel's, so a press from a tab
     that never loaded the settings (or from the assistant, or from a test)
     still books with the size he has been shipping rather than with none at
     all. Ренат, 18.09.2026: «use recommended, but we have also option that
     some default is set and used + automate it». */
  const parcel = await getParcelSettings();
  const lockerSize = toLockerSize(body.lockerSize) ?? suggestedLockerSize(parcel);

  /* «Другая коробка» — this parcel's own measurements, in **centimetres**,
     which is what the three fields on the card say and what the owner reads
     off a tape. They are converted once, here, because `POST /shipments` is
     metric (reference § Create Shipment → parcels) while
     `POST /shipping-methods/rates` is centimetric; both are right and neither
     is to be made to agree with the other.
     An explicit box always goes out. The shop's *declared* carton does not —
     createMontonioShipment() fills that in only where Montonio says the route
     requires dimensions, so nothing this adds can move a size tier on a
     booking that already worked. This one is the owner saying «эта посылка
     другая», and it is honoured. */
  const box = cleanBox(body.box);

  let shipment;
  try {
    shipment = await createMontonioShipment(order, {
      weight: typeof body.weight === "number" && body.weight > 0 ? body.weight : undefined,
      carrier: typeof body.carrier === "string" && body.carrier ? body.carrier : undefined,
      lockerSize,
      ...(box ?? {}),
    });
  } catch (err) {
    // nothing was booked, so the button must work again at once
    await releaseShipmentSlot(order.id).catch(() => {});
    if (err instanceof MontonioShippingError) {
      const status = err.code === "not_configured" ? 501 : CLIENT_ERRORS.has(err.code) ? 400 : 502;
      console.error("[api/admin/shipments] montonio refused:", err.code, err.detail);
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status });
    }
    console.error("[api/admin/shipments] create failed:", err);
    return Response.json({ ok: false, error: "shipment_failed" }, { status: 502 });
  }

  try {
    // the claim goes out with the same write that records the parcel
    await saveShipmentOnOrder(order.id, { ...shipment, bookingAt: null });
  } catch (err) {
    // The parcel exists at the carrier; losing the row is bad but not fatal —
    // report it with the tracking code so nobody books it twice.
    console.error("[api/admin/shipments] could not store the shipment:", err);
    return Response.json({ ok: false, error: "store_failed", shipment }, { status: 500 });
  }

  /* What he actually pressed, remembered, so the next label offers it without
     being asked. Only for a shipment that could carry a size at all — a
     courier parcel and an Omniva locker never take one, and counting them
     would teach the suggestion a number nobody chose. Best effort: the parcel
     is booked, and a forgotten size is not a failed label. */
  if (shipment.method === "pickupPoint" && takesLockerSize(shipment.carrier)) {
    await noteLockerSize(lockerSize);
  }

  await writeAuditSafe("admin", "shipment.create", {
    orderId: order.id,
    number: order.number,
    provider: "montonio",
    shipmentId: shipment.shipmentId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    lockerSize: shipment.method === "pickupPoint" && takesLockerSize(shipment.carrier) ? lockerSize : undefined,
  });

  // The status is the order's own: still `paid` (or whatever it was) — see the header.
  return Response.json(
    { ok: true, shipment, order },
    { headers: { "cache-control": "no-store" } },
  );
}
