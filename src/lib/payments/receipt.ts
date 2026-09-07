/**
 * The receipt's address — `/shop2/done/?n=R-100042&s=paid|failed|pending` —
 * built in one place for the two things that send a shopper there: the
 * provider's return (src/app/api/payments/return/route.ts) and an order that
 * had nothing left to pay, settled on the spot by POST /api/payments/create/
 * (src/lib/payments/settle.ts). The screen itself is doneState() /
 * screenDone() in public/shop2/app.js, which reads only this query.
 */

export type ReceiptState = "paid" | "failed" | "pending";

export interface ReceiptParams {
  number: string | null;
  state: ReceiptState;
  /**
   * `t` (analytics agent) rides along only on a paid receipt — it is what
   * lets the done screen's client-side `track("purchase", …)` beacon report
   * a total without app.js having to remember anything across the redirect
   * to the bank and back. It is a funnel signal only: the euro amount that
   * actually counts as revenue is written server-side by applyPaymentResult
   * → src/lib/events.ts recordPurchaseEvent — see db/migrations/080_events.sql
   * for the full "which is used where".
   */
  total?: number;
  /**
   * `g` is how the receipt screen learns it can offer «Скачать подарочную
   * карту (PDF)». It carries `<code>~<token>` per card, because the token is
   * an HMAC the browser cannot compute (src/lib/giftcard-pdf.ts) and the
   * receipt is a static page with no order of its own to ask about. Only
   * ever on the buyer's own arrival, only for the order just paid.
   */
  gift?: string;
  /**
   * `o` — the order's id, and only on a failed receipt: it is what
   * «Оплатить ещё раз» posts back to POST /api/payments/create/, which then
   * re-creates the payment for the same order with the method chosen the
   * first time. The shopper's own browser already held this id (POST
   * /api/orders/ answered with it), so the URL gives away nothing new; a
   * paid or pending receipt has no use for it and does not carry it.
   */
  orderId?: string;
  /**
   * `m` — bank | card | wallet, the method this order was last sent out with,
   * and only on a failed receipt beside `o`. The screen offers all three so a
   * customer whose card was refused can switch to a bank link without going
   * back through the basket (Dim, 07.09.2026); this is what makes the one they
   * already chose the one that starts selected, rather than the shop quietly
   * proposing a different way to pay.
   */
  method?: string;
  /**
   * `b` — the BIC of the bank the shopper picked, beside `m=bank`. The retry
   * screen draws the same chips the checkout does, and this is what keeps the
   * one they chose highlighted; without it a shopper who picked SEB came back
   * to a screen offering Swedbank.
   */
  bank?: string;
}

/** The three the checkout's radio has, and the only values `m` may carry. */
const METHODS: readonly string[] = ["bank", "card", "wallet"];
/** A bank code is a BIC — 8 or 11 of A–Z and 0–9, and nothing else in a URL. */
const BIC_RE = /^[A-Z0-9]{8,11}$/;

export function receiptUrl(base: string, p: ReceiptParams): string {
  const params = new URLSearchParams();
  if (p.number) params.set("n", p.number);
  params.set("s", p.state);
  if (p.state === "paid" && p.total != null && Number.isFinite(p.total)) params.set("t", p.total.toFixed(2));
  if (p.state === "paid" && p.gift) params.set("g", p.gift);
  if (p.state === "failed" && p.orderId) params.set("o", p.orderId);
  if (p.state === "failed" && p.method && METHODS.includes(p.method)) params.set("m", p.method);
  if (p.state === "failed" && p.method === "bank" && p.bank && BIC_RE.test(p.bank)) params.set("b", p.bank);
  return `${base}/shop2/done/?${params.toString()}`;
}

/**
 * `RMP-ACDE-4679~<token>,…` for the cards this order bought — "" for an order
 * with none, and "" for anything that goes wrong. The receipt must never fail
 * to render because a gift-card lookup did.
 */
export async function giftLinks(orderId: string): Promise<string> {
  try {
    const [{ orderGiftCards }, { giftPdfToken }] = await Promise.all([
      import("@/lib/giftcards"),
      import("@/lib/giftcard-pdf"),
    ]);
    const cards = await orderGiftCards(orderId);
    return cards
      .slice(0, 10)
      .map((c) => `${c.code}~${giftPdfToken(c.code)}`)
      .join(",");
  } catch (err) {
    console.error("payments/receipt: gift-card links unavailable", err);
    return "";
  }
}
