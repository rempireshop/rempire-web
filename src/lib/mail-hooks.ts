/**
 * Order lifecycle → e-mail. Backend-core and the checkout agent call these by
 * dynamic import, so the three names are a contract:
 *
 *   const { onOrderPaid } = await import("@/lib/mail-hooks");
 *   await onOrderPaid(order);
 *
 * Nothing in here throws and nothing in here awaits anything slow enough to
 * matter to a payment callback: a mail failure is logged and reported in the
 * return value, never raised. Callers may ignore the result entirely.
 */

import { renderOrderConfirmed } from "@/emails/order-confirmed";
import { renderOrderShipped } from "@/emails/order-shipped";
import { renderGiftCard, type GiftCardLike } from "@/emails/gift-card";
import { money, normalizeLang, num, pick } from "@/emails/layout";
import {
  customerName,
  deliveryLine,
  itemTitle,
  lineTotal,
  orderNumber,
} from "@/emails/common";
import type { OrderLike, Tracking } from "@/emails/types";
import { sendRendered } from "@/lib/mail";
import { forwardEmail, forwardTelegram } from "@/lib/notify";

export interface MailHookResult {
  ok: boolean;
  /** Nothing was sent on purpose — flow disabled, or no customer address. */
  skipped?: boolean;
  reason?: string;
  /** Resend message id when a customer letter went out. */
  id?: string;
  /** Whether Renat/Dmitri were pinged. */
  notified?: boolean;
}

/* ---------- shared bits -------------------------------------------------- */

function customerEmail(order: OrderLike): string {
  return pick(order.email, order.shipping?.email);
}

function langOf(order: OrderLike) {
  return normalizeLang(order.lang);
}

function truthy(v: string | undefined | null): boolean {
  return /^(1|true|on|yes|да)$/i.test((v ?? "").trim());
}

/**
 * Short human summary for the shop's own Telegram/e-mail ping. Russian —
 * Renat reads Russian and this never reaches a customer.
 */
function ownerSummary(order: OrderLike, headline: string): string {
  const lang = langOf(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const lines = items.map((it) => {
    const title = itemTitle(it, "ru");
    const variant = pick(it.variant);
    const qty = Math.max(1, Math.round(num(it.qty, 1)));
    return `• ${title}${variant ? ` · ${variant}` : ""} × ${qty} — ${money(lineTotal(it))}`;
  });
  const who = pick(customerName(order), customerEmail(order), "гость");
  return [
    headline,
    `Заказ: ${orderNumber(order)}`,
    `Клиент: ${who}${customerEmail(order) ? ` · ${customerEmail(order)}` : ""}`,
    order.shipping ? `Доставка: ${deliveryLine(order.shipping, "ru")}` : "",
    lines.length ? "" : null,
    ...lines,
    `Итого: ${money(order.total ?? 0)}`,
    `Язык письма: ${lang.toUpperCase()}`,
  ]
    .filter((l): l is string => typeof l === "string")
    .join("\n");
}

async function pingOwner(subject: string, body: string): Promise<boolean> {
  const [tg, mail] = await Promise.all([
    forwardTelegram(body),
    forwardEmail(subject, body),
  ]);
  return tg || mail;
}

/* ---------- hooks -------------------------------------------------------- */

export interface OrderCreatedOptions {
  /**
   * The shop setting. Backend-core owns the settings table, so it may pass the
   * value straight in; when it does not, MAIL_PENDING_PAYMENT decides.
   */
  sendPending?: boolean;
}

/**
 * Order row written, payment not confirmed yet.
 *
 * Off by default: an unpaid order that is abandoned two minutes later should
 * not have produced a letter. Turn it on with MAIL_PENDING_PAYMENT=1 (bank
 * link flows, where the customer leaves the site to pay), or pass
 * `{ sendPending: true }`.
 */
export async function onOrderCreated(
  order: OrderLike,
  options: OrderCreatedOptions = {},
): Promise<MailHookResult> {
  try {
    const enabled =
      options.sendPending ?? truthy(process.env.MAIL_PENDING_PAYMENT);
    if (!enabled) return { ok: true, skipped: true, reason: "disabled" };

    const to = customerEmail(order);
    if (!to) return { ok: true, skipped: true, reason: "no_customer_email" };

    const lang = langOf(order);
    const mail = renderOrderConfirmed(order, lang);
    const res = await sendRendered(to, mail, {
      tags: { template: "order-confirmed", stage: "pending" },
      idempotencyKey: `pending:${orderNumber(order)}`,
    });
    return {
      ok: res.ok,
      skipped: res.skipped,
      reason: res.error,
      id: res.id,
    };
  } catch (err) {
    console.error("[mail-hooks] onOrderCreated failed", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * Payment confirmed. The customer gets «Заказ принят»; Renat gets a ping on
 * Telegram and e-mail through the existing notify.ts helper.
 */
export async function onOrderPaid(order: OrderLike): Promise<MailHookResult> {
  try {
    const lang = langOf(order);
    const to = customerEmail(order);

    let id: string | undefined;
    let ok = true;
    let reason: string | undefined;
    let skipped: boolean | undefined;

    if (to) {
      const mail = renderOrderConfirmed(order, lang);
      const res = await sendRendered(to, mail, {
        tags: { template: "order-confirmed", stage: "paid" },
        idempotencyKey: `confirmed:${orderNumber(order)}`,
      });
      ok = res.ok;
      id = res.id;
      reason = res.error;
      skipped = res.skipped;
    } else {
      skipped = true;
      reason = "no_customer_email";
    }

    const notified = await pingOwner(
      `REMPIRE — оплачен заказ ${orderNumber(order)}`,
      ownerSummary(order, "💶 Заказ оплачен"),
    );

    // Gift cards bought in this order: issue the codes (idempotent) and mail
    // each one to its recipient, falling back to the buyer's address.
    await sendGiftCards(order, to, lang);

    return { ok: ok || notified, skipped, reason, id, notified };
  } catch (err) {
    console.error("[mail-hooks] onOrderPaid failed", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * Issue + mail the gift cards of a paid order. The features agent's
 * `issueGiftCards` is loaded lazily (it pulls in `pg`) and is safe to call
 * again on a repeated webhook: cards already attached to the order come back
 * unchanged, and Resend's idempotency key stops a second letter.
 */
async function sendGiftCards(order: OrderLike, buyerEmail: string, lang: ReturnType<typeof langOf>): Promise<void> {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.some((it) => typeof it?.id === "string" && it.id.startsWith("gift:"))) return;
  try {
    const mod = (await import("@/lib/giftcards")) as {
      issueGiftCards?: (o: unknown) => Promise<GiftCardLike[]>;
    };
    if (!mod.issueGiftCards) return;
    const cards = await mod.issueGiftCards(order);
    for (const card of cards) {
      const to = pick(card.recipient?.email, buyerEmail);
      if (!to || !card.code) continue;
      const mail = renderGiftCard(card, card.lang || lang);
      await sendRendered(to, mail, {
        tags: { template: "gift-card", stage: "paid" },
        idempotencyKey: `gift:${card.code}`,
      });
    }
  } catch (err) {
    console.error("[mail-hooks] gift cards failed", err);
  }
}

/** Parcel handed to the carrier — tracking code goes out to the customer. */
export async function onOrderShipped(
  order: OrderLike,
  tracking?: Tracking,
): Promise<MailHookResult> {
  try {
    const to = customerEmail(order);
    if (!to) return { ok: true, skipped: true, reason: "no_customer_email" };

    const lang = langOf(order);
    const mail = renderOrderShipped(order, lang, tracking);
    const code =
      typeof tracking === "string" ? tracking : pick(tracking?.code);
    const res = await sendRendered(to, mail, {
      tags: { template: "order-shipped" },
      idempotencyKey: `shipped:${orderNumber(order)}:${code || "nocode"}`,
    });
    return { ok: res.ok, skipped: res.skipped, reason: res.error, id: res.id };
  } catch (err) {
    console.error("[mail-hooks] onOrderShipped failed", err);
    return { ok: false, reason: "exception" };
  }
}
