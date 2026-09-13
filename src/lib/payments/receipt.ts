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
   * `o` — the order's id, on any receipt for an order that is **not paid**:
   * it is what «Оплатить ещё раз» posts back to POST /api/payments/create/,
   * which then re-creates the payment for the same order with the method
   * chosen the first time. The shopper's own browser already held this id
   * (POST /api/orders/ answered with it), so the URL gives away nothing new.
   *
   * Until 13.09.2026 it rode on a `failed` receipt only, and that stranded
   * the shopper Renat was: Montonio's order token says **PENDING** when a
   * payment was started and never completed — pressing «Отменить» at the bank
   * does not make it ABANDONED, that comes later when the order expires. So a
   * cancelled card payment came back `s=pending`, the screen said «Платёж
   * обрабатывается», and with no `o` there was no way to pay at all
   * («…cart is empty and I do not have option to pay again»). A pending
   * receipt that names an order now carries it too. It cannot cause a double
   * payment: POST /api/payments/create/ answers 409 `already_paid` for an
   * order that settled in the meantime.
   *
   * A **paid** receipt still never carries it — there is nothing left to pay.
   */
  orderId?: string;
  /**
   * `m` — bank | card | wallet, the method this order was last sent out with,
   * and only ever beside `o`. The screen offers all three so a customer whose
   * card was refused can switch to a bank link without going back through the
   * basket (Dim, 07.09.2026); this is what makes the one they already chose
   * the one that starts selected, rather than the shop quietly proposing a
   * different way to pay.
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
  /* Everything below is the "this order still owes money" payload — a paid
     receipt carries none of it, and the caller only passes an order id when it
     actually looked the order up and found it unpaid. */
  const owing = p.state === "failed" || p.state === "pending";
  if (owing && p.orderId) params.set("o", p.orderId);
  if (owing && p.orderId && p.method && METHODS.includes(p.method)) params.set("m", p.method);
  if (owing && p.orderId && p.method === "bank" && p.bank && BIC_RE.test(p.bank)) params.set("b", p.bank);
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
