/**
 * "The order is paid" → the mail side, if there is one.
 *
 * src/lib/mail-hooks.ts belongs to the mail agent. It is imported lazily, and
 * every failure is swallowed: a mail server having a bad day must never turn a
 * paid order into an error page for the shopper. Failures are logged.
 *
 * The specifier is a plain literal so the bundler traces the module into the
 * serverless function — a computed specifier would resolve to nothing in
 * production, which is the one failure mode this file must not have.
 */

type OrderHook = (order: unknown, opts?: unknown) => unknown | Promise<unknown>;

async function call(
  name: "onOrderPaid" | "issueOrderGiftCards" | "onOrderClosed",
  order: unknown,
  opts?: unknown,
): Promise<{ ran: boolean; result?: unknown }> {
  try {
    const mod: Record<string, unknown> = await import("@/lib/mail-hooks");
    const hook = mod?.[name] as OrderHook | undefined;
    if (typeof hook !== "function") return { ran: false };
    return { ran: true, result: await hook(order, opts) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "module not found" is the normal case before the mail agent lands
    if (!/cannot find module|failed to resolve|not found/i.test(message)) {
      console.error(`${name} failed`, message);
    }
    return { ran: false };
  }
}

/**
 * What became of the customer's letter — as much of it as anything outside
 * the mail module may rely on.
 *
 * `ran` (the old boolean) only ever said that the hook itself resolved, which
 * is true of a mail server that refused the letter and of a shop with no
 * Resend key at all. «Отметить оплаченным» reported «письмо ушло» from it, so
 * the owner was told the customer had been written to whenever the hook did
 * not throw. Typed structurally rather than imported from src/lib/mail-hooks.ts
 * on purpose: this file must keep working when that module is not there.
 */
export interface OrderMailReport {
  /** The customer's «Заказ принят» really left. */
  sent: boolean;
  /** Nothing was sent on purpose — no Resend key, or no address on the order. */
  skipped: boolean;
  reason?: string;
}

/**
 * Whatever the hook answered, read defensively — it is another module's value,
 * and on the markInvoicePaid() seam it is a test's stand-in. Exported so the
 * one reader serves both.
 */
export function readOrderMailReport(raw: unknown): OrderMailReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    sent: r.sent === true,
    skipped: r.skipped === true,
    reason: typeof r.reason === "string" ? r.reason : undefined,
  };
}

/** The transition into paid: the customer's letter, Renat's ping, the gift cards. */
export async function notifyOrderPaid(order: unknown): Promise<OrderMailReport> {
  const { ran, result } = await call("onOrderPaid", order);
  if (!ran) return { sent: false, skipped: false, reason: "no_mail_module" };
  return readOrderMailReport(result);
}

/**
 * A "paid" for an order that is already paid (audit H4): no letter, no ping —
 * but the gift cards bought in the order must exist, and if the first pass
 * died between the status write and the hook, this retry is the only thing
 * that will ever mint them. Idempotent on the mail side.
 */
export async function issueOrderGiftCards(order: unknown): Promise<boolean> {
  return (await call("issueOrderGiftCards", order)).ran;
}

/**
 * The order is closed — cancelled, or the money sent back.
 *
 * Until 07.09.2026 neither said anything to the customer: setOrderStatus()
 * returned the stock and stopped, and the confirm card in the admin had to
 * admit as much («Письмо не уходит: напишите клиенту сами»). Two openings, one
 * letter (src/emails/order-cancelled.ts); `kind` picks which, and `amount` is
 * what actually went back on a refund.
 */
export async function notifyOrderClosed(
  order: unknown,
  opts: {
    kind: "cancelled" | "refunded" | "refund_sent";
    amount?: number;
    reason?: string;
    /** The part of `amount` that went back onto a gift card, and which card — the letter names it. */
    giftAmount?: number;
    giftCode?: string;
    /** On a cancel of a paid order: what it was worth (money + gift card) — the letter says the money comes back. */
    value?: number;
  },
): Promise<boolean> {
  return (await call("onOrderClosed", order, opts)).ran;
}
