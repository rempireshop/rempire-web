/**
 * GET  /api/admin/orders/<id>/invoice/  — the invoice PDF («Скачать счёт»)
 * POST /api/admin/orders/<id>/invoice/  — { action: "paid" | "resend" }
 *
 * The id is the uuid or the order number, like the order route next door.
 * Admin only: an invoice names a company and its address, and «paid» moves
 * money-shaped state.
 *
 *   paid    «Отметить оплаченным» — the bank statement shows the transfer.
 *           src/lib/invoices.ts markInvoicePaid(): the same
 *           applyPaymentResult() door a provider's webhook goes through, so
 *           the gift card, the promo use, the points, the stock and the
 *           «Заказ принят» letter are settled exactly once; a second press is
 *           a no-op (paid is a floor). Lands in admin_audit as `invoice.paid`.
 *   resend  «Отправить счёт ещё раз» — the same letter with the same PDF to
 *           the invoice's e-mail; `invoice.sent` in the audit either way.
 *
 * The PDF is rendered on demand from the order row and the live seller
 * details — nothing is stored in the bucket. At this shop's volume a render
 * is ~100 ms, and a file that is never cached cannot go stale when the owner
 * corrects his IBAN in «Настройки → О компании».
 */
import { requireAdmin } from "@/lib/auth";
import { buildInvoicePdf, invoicePdfFilename } from "@/lib/invoice-pdf";
import { invoiceOf, markInvoicePaid, resendInvoice } from "@/lib/invoices";
import { getOrder, getOrderByNumber, OrderError, setOrderPayment, setOrderStatus } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function find(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let order;
  try {
    order = await find(id);
  } catch (err) {
    console.error("[api/admin/orders/:id/invoice] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const invoice = invoiceOf(order);
  if (!invoice) return Response.json({ ok: false, error: "no_invoice" }, { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await buildInvoicePdf(order, invoice);
  } catch (err) {
    // the fonts are the one thing this cannot do without — a deployment that lost them is misconfigured, not a bad request
    console.error("[api/admin/orders/:id/invoice] render failed:", err);
    return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoicePdfFilename(invoice.number)}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const action = body.action === "paid" || body.action === "resend" ? body.action : null;
  if (!action) return Response.json({ ok: false, error: "bad_action" }, { status: 400 });

  try {
    const order = await find(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    if (!invoiceOf(order)) return Response.json({ ok: false, error: "no_invoice" }, { status: 409 });

    if (action === "paid") {
      if (order.status === "cancelled" || order.status === "refunded") {
        return Response.json({ ok: false, error: "order_closed" }, { status: 409 });
      }
      const outcome = await markInvoicePaid(order, { setOrderPayment, setOrderStatus }, "admin");
      const fresh = (await getOrder(order.id)) ?? order;
      return Response.json(
        { ok: true, order: fresh, alreadyPaid: outcome.alreadyPaid },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const { sent } = await resendInvoice(order, "admin");
    const fresh = (await getOrder(order.id)) ?? order;
    return Response.json(
      { ok: true, order: fresh, sent: sent.ok, skipped: sent.skipped ?? false, error: sent.ok ? undefined : sent.error },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof OrderError) {
      return Response.json({ ok: false, error: err.code }, { status: 409 });
    }
    console.error("[api/admin/orders/:id/invoice] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
