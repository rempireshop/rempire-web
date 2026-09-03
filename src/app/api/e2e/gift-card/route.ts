/**
 * GET /api/e2e/gift-card/?order=<uuid-or-number> — TEST-ONLY lookup of the
 * gift-card code(s) issued for one order.
 *
 * Why this route exists: a real shopper learns their card's code from the
 * confirmation e-mail (src/lib/mail-hooks.ts issueOrderGiftCards →
 * src/emails/gift-card.ts). The e2e suite runs with no RESEND_API_KEY, so
 * that mail is only "skipped, logged" (docs/mail.md) — there is no mailbox
 * to read it from, and neither the receipt screen nor any existing admin
 * route ever surfaces the code (it is written straight to the `gift_cards`
 * table, keyed by `order_id`, and nothing joins it back onto the order — see
 * src/lib/giftcards.ts issueGiftCards). Without this route, the gift-card
 * spec (docs/testing.md) could prove a card was *issued* only indirectly and
 * could never learn its code to redeem on a second order.
 *
 * Double-gated like /api/e2e/bootstrap, PLUS the admin cookie (unlike that
 * route, this one hands back a real code with real balance, so it keeps the
 * same requireAdmin() lock as every other order-detail read):
 *   1. NODE_ENV !== "production"
 *   2. E2E_BOOTSTRAP === "1"
 *   3. a valid rmp_admin cookie (src/lib/auth.ts)
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber } from "@/lib/orders";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GiftCardRow {
  code: string;
  amount: string | number;
  balance: string | number;
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.E2E_BOOTSTRAP !== "1") {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const ref = new URL(req.url).searchParams.get("order") ?? "";
  if (!ref) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });

  try {
    const order = (await getOrder(ref)) ?? (await getOrderByNumber(ref));
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

    const rows = await query<GiftCardRow>(
      "select code, amount, balance from gift_cards where order_id = $1 order by created_at",
      [order.id],
    );
    return Response.json(
      { ok: true, cards: rows.map((r) => ({ code: r.code, amount: Number(r.amount), balance: Number(r.balance) })) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/e2e/gift-card] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
