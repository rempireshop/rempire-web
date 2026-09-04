/**
 * GET /api/admin/giftcards/ → { ok, cards, unspent, issued }
 *
 * The panel's «Маркетинг → Подарочные карты → Выпущенные карты»: every card
 * the shop has issued, newest first, plus the money still sitting on them.
 * That total is a liability the owner should be able to see without asking
 * anybody — a card is cash the shop already took and has not delivered yet.
 *
 * Admin only. Codes are money: a card's code plus its balance is enough to
 * spend it at checkout, so this route never leaves requireAdmin, and nothing
 * about it goes anywhere near the public /api/giftcards/check.
 *
 * Read-only on purpose. Cards are issued by the paid-order hook
 * (issueGiftCards, src/lib/giftcards.ts) and spent at checkout; there is no
 * verb here that would let the panel mint or void one, because a gift card the
 * shop can create by hand is a gift card the books cannot explain.
 *
 * NB: trailing slash (next.config has trailingSlash: true).
 */
import { requireAdmin } from "@/lib/auth";
import { listGiftCards } from "@/lib/giftcards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const cards = await listGiftCards();
    const unspent = Math.round(cards.reduce((sum, c) => sum + c.balance, 0) * 100) / 100;
    const issued = Math.round(cards.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;
    return Response.json({ ok: true, cards, unspent, issued }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/giftcards] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
