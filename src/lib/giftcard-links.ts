/**
 * "Which gift cards did this order buy, and where is each one's PDF" — the one
 * shape the admin panel reads.
 *
 * Its own module rather than a helper inside src/lib/giftcards.ts on purpose:
 * the PDF link comes from src/lib/giftcard-pdf.ts, which pulls `pdf-lib` in
 * behind it, and `giftcards.ts` is imported by the public
 * `POST /api/giftcards/check/` route on every code a shopper types. Keeping the
 * two apart means the checkout never carries a PDF library it will not use.
 */
import { giftPdfPath } from "@/lib/giftcard-pdf";
import { giftCardsByOrder, giftValidUntil } from "@/lib/giftcards";

export interface OrderGiftCardView {
  code: string;
  amount: number;
  balance: number;
  /** `YYYY-MM-DD` — derived, see giftValidUntil(). */
  validUntil: string;
  /** `/api/giftcards/<code>/pdf/?t=…`, ready to put in an href. */
  pdfUrl: string;
}

type Orderish = { id: string; items?: unknown };

function buysGiftCards(order: Orderish): boolean {
  const items = Array.isArray(order.items) ? (order.items as Array<{ id?: unknown }>) : [];
  return items.some((it) => typeof it?.id === "string" && it.id.startsWith("gift:"));
}

/**
 * The same orders back, each one that bought gift cards carrying a `giftCards`
 * array. Never throws and never changes the orders otherwise: a gift-card
 * lookup that fails must not empty the panel's order list.
 */
export async function attachGiftCards<T extends Orderish>(
  orders: T[],
): Promise<Array<T & { giftCards?: OrderGiftCardView[] }>> {
  const ids = orders.filter(buysGiftCards).map((o) => o.id);
  if (!ids.length) return orders;
  let byOrder: Awaited<ReturnType<typeof giftCardsByOrder>> = {};
  try {
    byOrder = await giftCardsByOrder(ids);
  } catch (err) {
    console.error("[giftcard-links] lookup failed:", err);
    return orders;
  }
  return orders.map((order) => {
    const cards = byOrder[order.id];
    if (!cards || !cards.length) return order;
    return {
      ...order,
      giftCards: cards.map((c) => ({
        code: c.code,
        amount: c.amount,
        balance: c.balance,
        validUntil: giftValidUntil(c.createdAt),
        pdfUrl: giftPdfPath(c.code),
      })),
    };
  });
}
