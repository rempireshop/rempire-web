/**
 * POST /api/admin/shipments/  — { orderId } → register the parcel with a carrier
 *
 * The button behind «Создать отправление» in the admin. It hands the order's
 * shipping jsonb (parcel-machine id, or the courier address) to Montonio, which
 * registers it with Omniva / DPD / SmartPosti / Venipak and hands back a
 * tracking code; the result is merged into `orders.shipping.montonio` so the
 * label route and the storefront can find it again.
 *
 * Order of work, deliberately:
 *   1. Montonio first — nothing is written until the carrier accepted the parcel.
 *   2. then the order row, then admin_audit, then the status.
 *   3. the customer's tracking letter last, and its failure is swallowed: a
 *      registered parcel must not be lost because Resend was down.
 *
 * Idempotent: a second press returns the shipment already stored rather than
 * booking (and paying for) a second parcel.
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber, setOrderStatus, writeAuditSafe } from "@/lib/orders";
import {
  MontonioShippingError,
  createMontonioShipment,
  saveShipmentOnOrder,
  shipmentOnOrder,
} from "@/lib/shipping/montonio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which failures are the operator's fault (400) and which are ours (502). */
const CLIENT_ERRORS = new Set(["not_shippable", "point_unresolved", "no_courier_service"]);

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: { orderId?: unknown; order?: unknown; weight?: unknown; carrier?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
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
    return Response.json(
      { ok: true, reused: true, shipment: existing },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // An unpaid parcel is a parcel nobody has been charged for.
  if (order.status !== "paid" && order.status !== "shipped") {
    return Response.json({ ok: false, error: "not_paid", detail: order.status }, { status: 409 });
  }

  let shipment;
  try {
    shipment = await createMontonioShipment(order, {
      weight: typeof body.weight === "number" && body.weight > 0 ? body.weight : undefined,
      carrier: typeof body.carrier === "string" && body.carrier ? body.carrier : undefined,
    });
  } catch (err) {
    if (err instanceof MontonioShippingError) {
      const status = err.code === "not_configured" ? 501 : CLIENT_ERRORS.has(err.code) ? 400 : 502;
      console.error("[api/admin/shipments] montonio refused:", err.code, err.detail);
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status });
    }
    console.error("[api/admin/shipments] create failed:", err);
    return Response.json({ ok: false, error: "shipment_failed" }, { status: 502 });
  }

  try {
    await saveShipmentOnOrder(order.id, { ...shipment });
  } catch (err) {
    // The parcel exists at the carrier; losing the row is bad but not fatal —
    // report it with the tracking code so nobody books it twice.
    console.error("[api/admin/shipments] could not store the shipment:", err);
    return Response.json({ ok: false, error: "store_failed", shipment }, { status: 500 });
  }

  await writeAuditSafe("admin", "shipment.create", {
    orderId: order.id,
    number: order.number,
    provider: "montonio",
    shipmentId: shipment.shipmentId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
  });

  let updated = order;
  try {
    updated = (await setOrderStatus(order.id, "shipped", "admin")) ?? order;
  } catch (err) {
    console.error("[api/admin/shipments] status not moved to shipped:", err);
  }

  /* The mail agent owns this. Loaded lazily by a literal specifier (so the
     bundler traces it into the function) and never allowed to throw: a parcel
     that is already at the carrier must not fail because Resend had a bad day. */
  try {
    const { onOrderShipped } = await import("@/lib/mail-hooks");
    await onOrderShipped(updated, {
      carrier: shipment.carrier,
      code: shipment.trackingCode,
      url: shipment.trackingUrl,
    });
  } catch (err) {
    console.error("[api/admin/shipments] onOrderShipped failed:", err);
  }

  return Response.json(
    { ok: true, shipment, order: { ...updated, status: "shipped" } },
    { headers: { "cache-control": "no-store" } },
  );
}
