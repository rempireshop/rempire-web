/**
 * GET /api/account/orders/<id>/invoice/ — the invoice PDF («Скачать счёт (PDF)»
 * in «Кабинет → Мои заказы»), for the signed-in customer's own order.
 *
 * The same file the «Счёт на оплату» letter carried and the owner downloads at
 * /api/admin/orders/<id>/invoice/. Until 10.09.2026 the customer had only the
 * letter: «I see my orders and statuses, but not the invoices that were sent
 * by e-mail — I should be able to download them from my account instead of
 * digging through my mail.» The id is the order number or the uuid, like the
 * admin route.
 *
 * Who may have it: the `rmp_cust` cookie proves an address, and the order must
 * carry that address — matched the way /api/account/return-request/ matches
 * it. Anybody else's order answers `not_found`, exactly as a number that does
 * not exist does, so the route confirms nothing to a guesser; only an order
 * that IS the caller's own may say `no_invoice`. Unlike the gift-card link
 * this URL carries no token: the cookie is the credential, so the link is not
 * a bearer link and forwarding it hands nobody a file.
 *
 * Rendered on demand from the order row and the live seller details, like the
 * admin's copy — nothing is stored, and a file that is never cached cannot go
 * stale when the owner corrects his IBAN in «Настройки → О компании».
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { normalizeEmail, sessionEmail } from "@/lib/customers";
import { buildInvoicePdf, invoicePdfFilename } from "@/lib/invoice-pdf";
import { invoiceOf } from "@/lib/invoices";
import { getOrder, getOrderByNumber } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NO_STORE = { "cache-control": "no-store" } as const;
const notFound = () => Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });

export async function GET(req: Request, ctx: Ctx) {
  const email = sessionEmail(req);
  if (!email) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  /* An invoice is downloaded once or twice, by the company that owes it. The
     same allowance as the printable gift card: loose enough that a bookkeeper
     re-opening the file never locks anybody out, tight enough that a signed-in
     account cannot grind through order numbers looking for one that renders. */
  if (rateLimit("account-invoice-pdf", clientIp(req), 30, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const { id: raw } = await ctx.params;
  const id = String(raw ?? "").trim().slice(0, 40);
  if (!id) return notFound();

  let order;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/account/orders/:id/invoice] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!order || normalizeEmail(order.email) !== normalizeEmail(email)) return notFound();
  const invoice = invoiceOf(order);
  if (!invoice) return Response.json({ ok: false, error: "no_invoice" }, { status: 404, headers: NO_STORE });

  let bytes: Uint8Array;
  try {
    bytes = await buildInvoicePdf(order, invoice);
  } catch (err) {
    // the fonts are the one thing this cannot do without — a deployment that lost them is misconfigured, not a bad request
    console.error("[api/account/orders/:id/invoice] render failed:", err);
    return Response.json({ ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
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
