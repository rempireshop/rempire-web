/**
 * The name a till sale is stored under when the cashier typed none.
 *
 * createOrder() needs a name on every order (src/lib/orders.ts) and a walk-in
 * sale often has none, so «Продажа в салоне» stands in — it is what the order
 * list and the order card show for it, and it is right there. It is NOT a
 * person: the receipt letter greeted «Здравствуйте, Продажа в!» with it
 * (staging, 25.09.2026, R-100081), so every reader that addresses the customer
 * asks isPosNoName() first — src/emails/common.ts customerName() and the
 * printable receipt (src/app/api/admin/pos-orders/[id]/receipt/route.ts).
 *
 * Its own tiny module because the letters must not import src/lib/orders.ts
 * and everything behind it just to know one string.
 */
export const POS_NO_NAME = "Продажа в салоне";

/** True for the till's stand-in name, however it was spaced. */
export function isPosNoName(name: unknown): boolean {
  return typeof name === "string" && name.trim() === POS_NO_NAME;
}
