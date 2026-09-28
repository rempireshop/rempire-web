/**
 * GET /api/account/orders/<id>/receipt/ — the receipt PDF («Скачать чек
 * (PDF)» in «Кабинет → Мои заказы»), for the signed-in customer's own paid
 * order. Dim, 28.09.2026: a receipt on every paid order, beside the gift-card
 * and invoice links. `?lang=ru|et|en` is the page's language, which the
 * receipt is printed in (src/lib/receipt-pdf.ts); without it, the order's.
 *
 * Authorised EXACTLY as the account's invoice route is
 * (src/app/api/account/orders/[id]/invoice/route.ts), line for line:
 *
 *   · the `rmp_cust` cookie proves an address (sessionEmail — the same signed
 *     cookie /api/account/me reads); none, or a forged one, is 401;
 *   · the order must carry that address. Anybody else's order answers
 *     `not_found`, exactly as a number that does not exist does, so the route
 *     confirms nothing to a guesser; only an order that IS the caller's own
 *     may say `no_receipt` — one never paid, or one paid «По счёту», whose
 *     document is the invoice (receiptAllowed, src/lib/account-orders.ts —
 *     the same rule that decides whether the link is drawn at all);
 *   · the same allowance per address of 30 a minute.
 *
 * The link carries no token: the cookie is the credential, so forwarding the
 * link hands nobody a file. Rendered on demand from the order row and the
 * live seller details — nothing is stored, nothing is cached.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { receiptAllowed } from "@/lib/account-orders";
import { normalizeEmail, sessionEmail } from "@/lib/customers";
import { getOrder, getOrderByNumber } from "@/lib/orders";
import { buildReceiptPdf, receiptPdfFilename } from "@/lib/receipt-pdf";

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
  /* A receipt is downloaded once or twice. The invoice's allowance: loose
     enough that re-opening the file never locks anybody out, tight enough
     that a signed-in account cannot grind through order numbers. */
  if (rateLimit("account-receipt-pdf", clientIp(req), 30, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  const { id: raw } = await ctx.params;
  const id = String(raw ?? "").trim().slice(0, 40);
  if (!id) return notFound();

  let order;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/account/orders/:id/receipt] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!order || normalizeEmail(order.email) !== normalizeEmail(email)) return notFound();
  if (!receiptAllowed(order)) return Response.json({ ok: false, error: "no_receipt" }, { status: 404, headers: NO_STORE });

  const lang = new URL(req.url).searchParams.get("lang");
  let bytes: Uint8Array;
  try {
    bytes = await buildReceiptPdf(order, { lang: lang || null });
  } catch (err) {
    // the fonts are the one thing this cannot do without — a deployment that lost them is misconfigured, not a bad request
    console.error("[api/account/orders/:id/receipt] render failed:", err);
    return Response.json({ ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${receiptPdfFilename(order.number)}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
