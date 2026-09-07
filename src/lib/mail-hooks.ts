/**
 * Order lifecycle → e-mail. Backend-core and the checkout agent call these by
 * dynamic import, so the names are a contract — the three hooks, and
 * `issueOrderGiftCards` for the payment routes' replay path:
 *
 *   const { onOrderPaid } = await import("@/lib/mail-hooks");
 *   await onOrderPaid(order);
 *
 * Nothing in here throws and nothing in here awaits anything slow enough to
 * matter to a payment callback: a mail failure is logged and reported in the
 * return value, never raised. Callers may ignore the result entirely.
 */

import { renderOrderCancelled, type ClosedKind } from "@/emails/order-cancelled";
import { renderOrderConfirmed } from "@/emails/order-confirmed";
import { renderOrderShipped } from "@/emails/order-shipped";
import { renderOrderUnpaid } from "@/emails/order-unpaid";
import { renderGiftCard, type GiftCardLike } from "@/emails/gift-card";
import { money, normalizeLang, num, pick, setBrandOverride } from "@/emails/layout";
import { cleanMailTexts, setMailTextsOverride } from "@/emails/texts";
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
  /** Whether Renat/Dim were pinged. */
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
 * The company name, address and e-mail in every letter's footer are the
 * owner's to change (`settings.content`, edited in «Настройки → Контент»), and
 * so are each letter's subject, intro paragraph and closing line
 * (`settings.mail_texts`, edited in «Письма» — src/emails/texts.ts). Both are
 * read here, from the one settings query this function already made.
 *
 * Read once per send, at the top of each hook, and handed to the layout —
 * the renderers themselves stay pure functions of (order, lang). `@/lib/orders`
 * and `@/lib/content` come in by dynamic import so a letter rendered in a test
 * or in the preview route never drags `pg` in behind it.
 *
 * Everything about this is best effort: no database, an empty row or a
 * malformed one all end with the built-in Rempire details, never an
 * exception — a paid order must not fail because a settings query did.
 *
 * Exported for the one letter that is not about an order — the partner
 * welcome (src/lib/partner-mail.ts) reads the same footer and the same
 * owner texts through this same door.
 */
export async function loadBrand(): Promise<void> {
  try {
    const [{ getSettings }, { mergeContent }] = await Promise.all([
      import("@/lib/orders"),
      import("@/lib/content"),
    ]);
    const settings = await getSettings();
    /* «Письма»: the owner's own subject / intro / signature, read from the
       same settings map and in the same best-effort way as the footer
       details below — see src/lib/mail-texts.ts. */
    setMailTextsOverride(cleanMailTexts(settings.mail_texts));
    const content = mergeContent(settings.content);
    setBrandOverride({
      legal: content.company.legalName,
      address: content.company.address,
      email: content.company.email,
      note: {
        ru: content.emailFooter.RU,
        et: content.emailFooter.ET,
        en: content.emailFooter.EN,
      },
    });
  } catch (err) {
    console.warn("[mail-hooks] shop details unavailable, using defaults", err);
    setBrandOverride(null);
    setMailTextsOverride(null);
  }
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

    await loadBrand();
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
    await loadBrand();
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

    // Gift cards bought in this order — the same path the payment routes run
    // on their own when a "paid" arrives twice, see issueOrderGiftCards().
    await issueOrderGiftCards(order);

    return { ok: ok || notified, skipped, reason, id, notified };
  } catch (err) {
    console.error("[mail-hooks] onOrderPaid failed", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * The gift-card half of onOrderPaid, on its own.
 *
 * The payment routes call this — not onOrderPaid — when the provider says
 * "paid" for an order that is already paid (audit H4: a webhook retry, a
 * refreshed return URL, notify and return racing). A retry must not ping Renat
 * or write to the customer again, but it is also the only thing that can
 * finish the job when the process died between `setOrderStatus(paid)` and the
 * hook: without it, the cards bought in that order would never be minted.
 *
 * Safe to run any number of times. The features agent's `issueGiftCards`
 * (loaded lazily — it pulls in `pg`) hands back the cards already attached to
 * the order instead of making more, and the letter's idempotency key
 * (`gift:<code>`) stops Resend from sending it twice.
 */
export async function issueOrderGiftCards(order: OrderLike): Promise<MailHookResult> {
  try {
    return await sendGiftCards(order);
  } catch (err) {
    console.error("[mail-hooks] issueOrderGiftCards failed", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * The printable card, made once per code on this same paid transition.
 *
 * Best effort by design: a PDF that cannot be rendered (fonts missing on a
 * half-configured deployment) must cost the customer the *attachment*, not the
 * letter — the code itself is in the body, and the link in the letter renders
 * the card on demand anyway (src/app/api/giftcards/[code]/pdf/route.ts).
 * The copy in R2 is a cache; storeGiftCardPdf() is a no-op without a bucket.
 */
async function giftCardAttachment(
  card: GiftCardLike & { createdAt?: string | Date | null },
  lang: string,
): Promise<{ filename: string; content: Uint8Array; contentType: string } | null> {
  if (!card.code) return null;
  try {
    const { buildGiftCardPdf, giftPdfFilename, storeGiftCardPdf } = await import("@/lib/giftcard-pdf");
    const { giftValidUntil } = await import("@/lib/giftcards");
    const bytes = await buildGiftCardPdf(
      {
        code: card.code,
        amount: num(card.amount, 0),
        lang: card.lang || lang,
        createdAt: card.createdAt ?? null,
        validUntil: giftValidUntil(card.createdAt ?? null),
        recipient: card.recipient ?? null,
      },
      card.lang || lang,
    );
    await storeGiftCardPdf(card.code, bytes);
    return { filename: giftPdfFilename(card.code), content: bytes, contentType: "application/pdf" };
  } catch (err) {
    console.error("[mail-hooks] gift-card PDF failed", err);
    return null;
  }
}

/** Issue + mail the gift cards of a paid order; a no-op when it holds none. */
async function sendGiftCards(order: OrderLike): Promise<MailHookResult> {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.some((it) => typeof it?.id === "string" && it.id.startsWith("gift:"))) {
    return { ok: true, skipped: true, reason: "no_gift_items" };
  }
  const mod = (await import("@/lib/giftcards")) as {
    issueGiftCards?: (o: unknown) => Promise<Array<GiftCardLike & { createdAt?: string | null }>>;
  };
  if (!mod.issueGiftCards) return { ok: false, reason: "giftcards_unavailable" };

  const cards = await mod.issueGiftCards(order);
  const buyerEmail = customerEmail(order);
  const lang = langOf(order);
  let ok = true;
  for (const card of cards) {
    // each card to its recipient, falling back to the buyer's address
    const to = pick(card.recipient?.email, buyerEmail);
    if (!to || !card.code) continue;
    const mail = renderGiftCard(card, card.lang || lang);
    const pdf = await giftCardAttachment(card, lang);
    const res = await sendRendered(to, mail, {
      tags: { template: "gift-card", stage: "paid" },
      idempotencyKey: `gift:${card.code}`,
      attachments: pdf ? [pdf] : undefined,
    });
    ok = ok && res.ok;
  }
  return ok ? { ok } : { ok, reason: "send_failed" };
}

/**
 * The order is closed without a parcel: cancelled, or the money sent back.
 *
 * Until 07.09.2026 neither said anything to anybody. «Отменить заказ» in the
 * admin moved the status and put a counted shelf back, and its confirm card
 * had to be corrected to admit that no letter went out at all; a refund
 * happened in Montonio's portal and never reached this shop. Both letters come
 * from one renderer with two openings (src/emails/order-cancelled.ts).
 *
 * The idempotency key carries the kind and the refund's own amount, so the
 * second refund on one order is a second letter (it is a different sum going
 * back) while a webhook retry about the same refund is not.
 */
export async function onOrderClosed(
  order: OrderLike,
  options: { kind: ClosedKind; amount?: number } = { kind: "cancelled" },
): Promise<MailHookResult> {
  try {
    const to = customerEmail(order);
    if (!to) return { ok: true, skipped: true, reason: "no_customer_email" };

    await loadBrand();
    const lang = langOf(order);
    const kind: ClosedKind = options.kind === "refunded" ? "refunded" : "cancelled";
    const amount = kind === "refunded" ? num(options.amount, num(order.total, 0)) : 0;
    const mail = renderOrderCancelled(order, lang, { kind, amount });
    const res = await sendRendered(to, mail, {
      tags: { template: kind === "refunded" ? "order-refunded" : "order-cancelled" },
      idempotencyKey: `${kind}:${orderNumber(order)}:${amount.toFixed(2)}`,
    });
    return { ok: res.ok, skipped: res.skipped, reason: res.error, id: res.id };
  } catch (err) {
    console.error("[mail-hooks] onOrderClosed failed", err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * «Заказ ждёт оплаты» — the reminder the daily cron sends before an unpaid
 * order is let go (src/lib/flows.ts, `runUnpaidOrders`). The stamp that stops
 * a second copy lives on the order, not here; the idempotency key is the belt
 * to that pair of braces.
 */
export async function onOrderUnpaid(
  order: OrderLike,
  options: { daysLeft: number; payUrl: string },
): Promise<MailHookResult> {
  try {
    const to = customerEmail(order);
    if (!to) return { ok: true, skipped: true, reason: "no_customer_email" };

    await loadBrand();
    const lang = langOf(order);
    const mail = renderOrderUnpaid(order, lang, options);
    const res = await sendRendered(to, mail, {
      tags: { template: "order-unpaid" },
      idempotencyKey: `unpaid:${orderNumber(order)}`,
    });
    return { ok: res.ok, skipped: res.skipped, reason: res.error, id: res.id };
  } catch (err) {
    console.error("[mail-hooks] onOrderUnpaid failed", err);
    return { ok: false, reason: "exception" };
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

    await loadBrand();
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
