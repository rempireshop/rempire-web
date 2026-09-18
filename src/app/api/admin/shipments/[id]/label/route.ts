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
 *
 * The A4 sheet also carries the order under the label since r16 — the drop-off
 * code, where the parcel goes, who is waiting for it and what is inside (see
 * src/lib/shipping/label-pdf.ts). Renat, 13.09.2026: «no drop-off code for the
 * locker is shown», «the address or any information from order is not printed
 * on the PDF». A6 stays the bare sticker: it has no room and a thermal roll
 * has no page to spare.
 */
import { requireAdmin } from "@/lib/auth";
import { shipmentRegistrationFailed } from "@/lib/montonio-problems";
import { getOrder, getOrderByNumber } from "@/lib/orders";
import { labelSlipFor, normaliseLabelPdf } from "@/lib/shipping/label-pdf";
import {
  MontonioShippingError,
  fetchLabelPdf,
  getMontonioLabel,
  getMontonioShipment,
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

  /* A parcel the carrier refused has no label and never will: `POST
     /label-files` on an unregistered shipment fails somewhere inside
     Montonio, and the owner was shown «Не удалось» with nothing behind it.
     Refused here instead, with the same words «Создать этикетку» gives — the
     fix is a corrected receiver sent to Montonio (`PATCH /shipments/{id}`),
     not another press. docs/montonio-untested.md § S1/S8. */
  if (String(shipment.status ?? "").trim().toLowerCase() === "registrationfailed") {
    const reading = shipmentRegistrationFailed(shipment.status);
    return Response.json(
      { ok: false, error: "registration_failed", reason: reading.reason, messages: reading.messages },
      { status: 409 },
    );
  }

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

  /* The drop-off code is Montonio's `parcels[0].dropOffPin`, stored on the
     order when the parcel was registered. A shipment registered before the
     reply carried one — or booked asynchronously — has an empty pin, and the
     one call that can still fill it is GET /shipments/<id>. Asked once, only
     when the pin is missing and the parcel is going to a machine, and never
     allowed to cost the owner his label: a carrier that does not answer
     leaves the slip saying there is no code, which is the truth we have. */
  let parcel = shipment;
  if (size === "A4" && !shipment.dropOffPin && shipment.method !== "courier") {
    try {
      const fresh = await getMontonioShipment(shipment.shipmentId);
      if (fresh.dropOffPin || fresh.trackingCode) {
        parcel = { ...shipment, ...fresh };
        await saveShipmentOnOrder(order.id, {
          dropOffPin: fresh.dropOffPin,
          trackingCode: fresh.trackingCode || shipment.trackingCode,
          trackingUrl: fresh.trackingUrl || shipment.trackingUrl,
        }).catch((err) => console.error("[api/admin/shipments/:id/label] pin not stored:", err));
      }
    } catch (err) {
      console.error("[api/admin/shipments/:id/label] shipment re-read failed:", err);
    }
  }

  // Montonio's file draws the label twice-composed and cut in half (see
  // label-pdf.ts); rewrite the page so the label alone is on the sheet, with
  // the order's own details under it on A4. A file the repair does not
  // recognise goes out as it came.
  let body: ArrayBuffer | Uint8Array = pdf;
  try {
    const fixed = await normaliseLabelPdf(pdf, size, size === "A4" ? labelSlipFor(order, parcel) : null);
    if (fixed) body = fixed;
  } catch (err) {
    console.error("[api/admin/shipments/:id/label] label repair failed, serving the original:", err);
  }

  return new Response(body as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${order.number || "label"}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
