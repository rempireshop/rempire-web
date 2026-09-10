/**
 * "Which gift cards did this order buy, and where is each one's PDF" — and,
 * since 10.09.2026, "which gift card paid for it and how much of that may
 * still go back onto it" — the one shape the admin panel reads.
 *
 * Its own module rather than a helper inside src/lib/giftcards.ts on purpose:
 * the PDF link comes from src/lib/giftcard-pdf.ts, which pulls `pdf-lib` in
 * behind it, and `giftcards.ts` is imported by the public
 * `POST /api/giftcards/check/` route on every code a shopper types. Keeping the
 * two apart means the checkout never carries a PDF library it will not use.
 */
import { giftPdfPath } from "@/lib/giftcard-pdf";
import { giftCardsByOrder, giftPaidByOrders, giftValidUntil, type GiftPaid } from "@/lib/giftcards";

export interface OrderGiftCardView {
  code: string;
  amount: number;
  balance: number;
  /** `YYYY-MM-DD` — derived, see giftValidUntil(). */
  validUntil: string;
  /** `/api/giftcards/<code>/pdf/?t=…`, ready to put in an href. */
  pdfUrl: string;
  /** Set once the order that bought the card was refunded — the card is dead (151_gift_card_refunds). */
  voidedAt: string | null;
}

type Orderish = { id: string; items?: unknown };

function buysGiftCards(order: Orderish): boolean {
  const items = Array.isArray(order.items) ? (order.items as Array<{ id?: unknown }>) : [];
  return items.some((it) => typeof it?.id === "string" && it.id.startsWith("gift:"));
}

/**
 * The same orders back, each one that bought gift cards carrying a `giftCards`
 * array, and each one a gift card paid for carrying `giftPaid` — what the card
 * paid and what of it a refund may still return to it (src/lib/giftcards.ts
 * giftPaidByOrders; the «Вернуть деньги» card draws its split from this).
 * Never throws and never changes the orders otherwise: a gift-card lookup
 * that fails must not empty the panel's order list.
 */
export async function attachGiftCards<T extends Orderish>(
  orders: T[],
): Promise<Array<T & { giftCards?: OrderGiftCardView[]; giftPaid?: GiftPaid[] }>> {
  const soldIds = orders.filter(buysGiftCards).map((o) => o.id);
  let byOrder: Awaited<ReturnType<typeof giftCardsByOrder>> = {};
  let paidBy: Record<string, GiftPaid[]> = {};
  try {
    [byOrder, paidBy] = await Promise.all([
      soldIds.length ? giftCardsByOrder(soldIds) : Promise.resolve({}),
      giftPaidByOrders(orders.map((o) => o.id)),
    ]);
  } catch (err) {
    console.error("[giftcard-links] lookup failed:", err);
    return orders;
  }
  return orders.map((order) => {
    const cards = byOrder[order.id];
    const paid = paidBy[order.id];
    if ((!cards || !cards.length) && (!paid || !paid.length)) return order;
    return {
      ...order,
      ...(cards && cards.length
        ? {
            giftCards: cards.map((c) => ({
              code: c.code,
              amount: c.amount,
              balance: c.balance,
              validUntil: giftValidUntil(c.createdAt),
              pdfUrl: giftPdfPath(c.code),
              voidedAt: c.voidedAt,
            })),
          }
        : {}),
      ...(paid && paid.length ? { giftPaid: paid } : {}),
    };
  });
}
