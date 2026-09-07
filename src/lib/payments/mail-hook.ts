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
): Promise<boolean> {
  try {
    const mod: Record<string, unknown> = await import("@/lib/mail-hooks");
    const hook = mod?.[name] as OrderHook | undefined;
    if (typeof hook !== "function") return false;
    await hook(order, opts);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "module not found" is the normal case before the mail agent lands
    if (!/cannot find module|failed to resolve|not found/i.test(message)) {
      console.error(`${name} failed`, message);
    }
    return false;
  }
}

/** The transition into paid: the customer's letter, Renat's ping, the gift cards. */
export async function notifyOrderPaid(order: unknown): Promise<boolean> {
  return call("onOrderPaid", order);
}

/**
 * A "paid" for an order that is already paid (audit H4): no letter, no ping —
 * but the gift cards bought in the order must exist, and if the first pass
 * died between the status write and the hook, this retry is the only thing
 * that will ever mint them. Idempotent on the mail side.
 */
export async function issueOrderGiftCards(order: unknown): Promise<boolean> {
  return call("issueOrderGiftCards", order);
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
  opts: { kind: "cancelled" | "refunded"; amount?: number; reason?: string },
): Promise<boolean> {
  return call("onOrderClosed", order, opts);
}
