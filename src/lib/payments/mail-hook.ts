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

type OrderPaidHook = (order: unknown) => unknown | Promise<unknown>;

export async function notifyOrderPaid(order: unknown): Promise<boolean> {
  try {
    const mod: Record<string, unknown> = await import("@/lib/mail-hooks");
    const hook = mod?.onOrderPaid as OrderPaidHook | undefined;
    if (typeof hook !== "function") return false;
    await hook(order);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "module not found" is the normal case before the mail agent lands
    if (!/cannot find module|failed to resolve|not found/i.test(message)) {
      console.error("onOrderPaid failed", message);
    }
    return false;
  }
}
