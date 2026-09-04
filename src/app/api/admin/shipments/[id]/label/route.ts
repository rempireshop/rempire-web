/**
 * GET /api/admin/shipments/<order>/label/ → the shipping label as a PDF
 *
 * `<order>` is the order uuid or its number (R-100042), the same two keys the
 * admin's order routes accept, so the admin can link to it straight from the
 * order it is looking at.
 *
 * The PDF is proxied rather than linked: Montonio hands out a pre-signed S3
 * URL, and a link to that would be a label anyone could fetch for as long as
 * the signature lives. Behind requireAdmin, the browser gets the bytes and
 * nothing leaks.
 *
 * The URL is created on the first request and stored on the order, so pressing
 * «Этикетка PDF» twice does not make Montonio generate the file twice.
 *
 * `?size=A4` (the default) is one label on an A4 page — what an office printer
 * prints as-is. `?size=A6` is the label alone, for a thermal label printer.
 * The stored URL remembers which size it is; asking for the other one makes a
 * new file.
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber } from "@/lib/orders";
import {
  MontonioShippingError,
  fetchLabelPdf,
  getMontonioLabel,
  saveShipmentOnOrder,
  shipmentOnOrder,
} from "@/lib/shipping/montonio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  let order;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/admin/shipments/:id/label] order read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const shipment = shipmentOnOrder(order);
  if (!shipment) return Response.json({ ok: false, error: "no_shipment" }, { status: 404 });

  const size: "A4" | "A6" = new URL(req.url).searchParams.get("size") === "A6" ? "A6" : "A4";
  // a label stored before sizes were recorded was an A6 one
  const storedSize = shipment.labelSize === "A4" || shipment.labelSize === "A6" ? shipment.labelSize : "A6";
  let url = typeof shipment.labelUrl === "string" && storedSize === size ? shipment.labelUrl : "";
  let pdf: ArrayBuffer | null = null;

  try {
    if (url) {
      // a stored link can have expired; making a fresh label is the cheap fix
      try {
        pdf = await fetchLabelPdf(url);
      } catch {
        url = "";
      }
    }
    if (!pdf) {
      const label = await getMontonioLabel(shipment.shipmentId, { pageSize: size, labelsPerPage: 1 });
      url = label.url;
      pdf = await fetchLabelPdf(url);
      await saveShipmentOnOrder(order.id, { labelUrl: url, labelFileId: label.labelFileId, labelSize: size }).catch(
        (err) => console.error("[api/admin/shipments/:id/label] label url not stored:", err),
      );
    }
  } catch (err) {
    if (err instanceof MontonioShippingError) {
      const status = err.code === "not_configured" ? 501 : err.code === "label_not_ready" ? 409 : 502;
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status });
    }
    console.error("[api/admin/shipments/:id/label] label failed:", err);
    return Response.json({ ok: false, error: "label_failed" }, { status: 502 });
  }
  if (!pdf) return Response.json({ ok: false, error: "label_failed" }, { status: 502 });

  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${order.number || "label"}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
