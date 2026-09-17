/**
 * «Этот заказ оплатили?» — the one bit the shop is allowed to ask about an
 * order it made, and the token that proves it may ask.
 *
 * Why it exists: payNow() empties the basket before the redirect to the bank
 * and parks it against the order (holdCart() in public/shop2/app.js). It is
 * handed back when a receipt says the order was NOT paid — and a receipt is
 * the only thing that ever says so. A shopper who pressed «Назад» at the
 * bank, or closed that tab, never sees one: the basket sat in localStorage
 * for a day and the shop opened empty (Ренат, 13.09.2026).
 *
 * The obvious fix — give the basket back at boot whenever no paid receipt was
 * seen — is the very failure the parking was built to avoid: a shopper who
 * PAID and closed the bank's tab sees no receipt either, and would find the
 * goods they already own back in the basket, ready to be bought a second
 * time. So the shop does not guess; it asks, and restores only on a definite
 * «не оплачен».
 *
 * ---------- what proves the asker may ask ---------------------------------
 *
 * The same shape the receipt screen already uses for the one other thing it
 * may show about an order it has no session for — the printable gift card
 * (src/lib/giftcard-pdf.ts): an HMAC under SESSION_SECRET, handed to the
 * browser by the route that had the order in front of it, and checked back
 * here. No new secret, no new table, no cookie — the shopper who is about to
 * be sent to a bank is usually not signed in at all.
 *
 * POST /api/orders/ mints it beside the order id it already answers with, so
 * the only browser that ever holds one is the browser that placed the order.
 *
 * What a stranger holding nothing but an order id learns: nothing. The token
 * is checked BEFORE the database is touched, and a wrong one answers exactly
 * what an invented id answers — 404 `not_found`, no body, no timing tell. An
 * id is therefore not a way to find out whether an order exists, let alone
 * who it belongs to or what is in it.
 *
 * With SESSION_SECRET unset there is nothing to sign: the token is "" and
 * verify refuses everything, so the endpoint answers 404 to everyone and the
 * shop never restores. Closed is the safe direction — an empty basket is
 * recoverable through the receipt link in the e-mail, a double payment is not.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : "";
}

/**
 * `HMAC-SHA256("order-status:v1:" + orderId)` under SESSION_SECRET, base64url,
 * truncated to 32 characters — 192 bits, the same budget giftPdfToken() runs
 * on, and far past guessing for a value that is also rate-limited per IP.
 *
 * "" when there is no key to sign with, and "" for an empty id.
 */
export function orderStatusToken(orderId: string): string {
  const key = secret();
  const id = String(orderId ?? "").trim();
  if (!key || !id) return "";
  return createHmac("sha256", key).update(`order-status:v1:${id}`).digest("base64url").slice(0, 32);
}

/** Constant-time compare. False for a missing key, a missing token, any mismatch. */
export function verifyOrderStatusToken(orderId: string, token: string | null | undefined): boolean {
  const want = orderStatusToken(orderId);
  if (!want || !token) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The only two statuses that mean «the money definitely never arrived, and
 * the order is still open»: `new` — created and never paid for — and
 * `failed`, a payment the bank refused. Everything else answers `paid: true`.
 *
 * `cancelled` and `refunded` answer true as well, and deliberately so. Neither
 * means the money is in the till right now; both mean this shop cannot say
 * that it never was. The bit this endpoint exists to produce is not «where
 * does the accounting stand», it is «may the shop hand this basket back», and
 * the answer to that on a maybe is no. The full list is ORDER_STATUSES in
 * src/lib/orders.ts (db/migrations/140_order_delivered.sql).
 */
export const UNPAID_ORDER_STATUSES = ["new", "failed"] as const;

export function orderCountsAsPaid(status: unknown): boolean {
  const s = String(status ?? "");
  return !(UNPAID_ORDER_STATUSES as readonly string[]).includes(s);
}
