/**
 * «Заказ отменён» and «Деньги возвращены» — one letter, two openings.
 *
 * Until 07.09.2026 neither existed. Cancelling an order in the admin moved the
 * status, put a counted shelf back and said nothing at all to the customer;
 * the confirm card had to admit it («Письмо не уходит: напишите клиенту
 * сами»). A refund was worse: it happened in Montonio's portal and this shop
 * never learned about it.
 *
 * One renderer, because the two letters are the same page — what happened,
 * which order, and what the customer should expect next. `kind` picks the
 * opening and the money line; the subject, the paragraph under the greeting
 * and the closing line are the owner's, per kind, under two template keys
 * (`order-cancelled` / `order-refunded`, ./texts.ts), so «Письма» can word
 * them separately.
 */

import { customerName, greeting, orderNumber } from "./common";
import {
  BRAND,
  COMMON,
  esc,
  money,
  normalizeLang,
  num,
  rowLead,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import { fillPlaceholders, hasMailText, mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, OrderLike, RenderedEmail } from "./types";

/**
 * `refund_sent` is the third one, added 19.09.2026 on the owner's decision.
 *
 * Montonio answers 200 PENDING for a refund it has merely ACCEPTED — it may
 * still fail for want of balance, and it cancels itself after ten days. Until
 * now that state sent «Деньги возвращены», so a customer could have it in
 * writing that the money was back when it was not. Saying nothing instead would
 * leave somebody who asked for a refund with no news for days, which is the
 * e-mail Renat then has to answer by hand. So: one letter on acceptance that
 * promises nothing, and the real one when Montonio confirms.
 */
export type ClosedKind = "cancelled" | "refunded" | "refund_sent";

export interface ClosedOptions {
  kind: ClosedKind;
  /** What actually went back, on a refund. Defaults to the order's total. */
  amount?: number;
  /**
   * The part of `amount` that went back onto the gift card that paid for the
   * order — as balance, not as money — and the card's code. The letter then
   * says so, because «the money travels the way it came» is wrong for a
   * card: nothing arrives on a bank statement, the code simply works again.
   */
  giftAmount?: number;
  giftCode?: string;
  /**
   * `cancelled` only: what the order was worth to the customer — the money
   * plus what a gift card paid (src/lib/payments/settle.ts refundValue()). The
   * route that cancels knows it; without it the letter reads the payment
   * alone (cancelMoneyOf below).
   */
  value?: number;
}

/**
 * Where the money of a cancelled order stands — the one fact the letter must
 * not get wrong. «Отменить заказ» moves no money: the refund is the card's own
 * «Вернуть деньги» (the panel's confirm says so, admCancelConfirmText in
 * public/shop2/app.js). Staging, 25.09.2026, R-100078 and R-100087: two PAID
 * orders were cancelled and both customers read «Деньги за него не списаны —
 * платить ничего не нужно».
 *
 *   none  nothing came in: not paid, or a promo / points covered the order;
 *   owed  money came in — paid, or held as too little — and not all of it has
 *         gone back yet («мы вернём»);
 *   back  what came in has gone back already.
 */
export type CancelMoney = "none" | "owed" | "back";

export function cancelMoneyOf(order: OrderLike, value?: number): CancelMoney {
  const p = (order.payment && typeof order.payment === "object" ? order.payment : {}) as Record<string, unknown>;
  /* A caller that hands over a value is saying the money came in — the
     cancel route only does for an order that was paid when it was cancelled. */
  const came = p.status === "paid" || !!p.held || (typeof value === "number" && value > 0.004);
  if (!came) return "none";
  const total = num(order.total, 0);
  /* What came in: the caller's figure (money + gift card), else the money
     itself — and an order a gift card covered entirely has a total of 0 and
     is still owed the card's part back, whatever it was. */
  const worth =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : total > 0
        ? total
        : p.method === "giftcard"
          ? Number.POSITIVE_INFINITY
          : 0;
  if (!(worth > 0.004)) return "none";
  const refunds = Array.isArray(p.refunds) ? (p.refunds as Array<Record<string, unknown>>) : [];
  const back = refunds
    .filter((r) => r && typeof r === "object" && r.status !== "failed")
    .reduce((sum, r) => sum + num(r.amount, 0), 0);
  return back >= worth - 0.005 ? "back" : "owed";
}

/**
 * The paid versions of «Заказ отменён». The opening sentence is the owner's
 * once he has written one («Письма», ./texts.ts); until then it follows the
 * money the way gift-card.ts's opening follows the giver. The unpaid opening
 * is the template's own default and reads exactly as it always did.
 */
const CANCEL_PAID: Record<Exclude<CancelMoney, "none">, Record<Lang, { preheader: string; intro: string; detail: string }>> = {
  owed: {
    ru: {
      preheader: "Заказ отменён. Деньги за него мы вернём.",
      intro: "Заказ № {order} отменён. Деньги за него мы вернём — об этом придёт отдельное письмо.",
      detail: "Деньги за этот заказ мы вернём тем же путём, каким они пришли.",
    },
    et: {
      preheader: "Tellimus on tühistatud. Raha selle eest tagastame.",
      intro: "Tellimus nr {order} on tühistatud. Raha selle eest tagastame — sellest tuleb eraldi kiri.",
      detail: "Selle tellimuse raha tagastame sama teed, kust see tuli.",
    },
    en: {
      preheader: "The order has been cancelled. We will refund what you paid.",
      intro: "Order no. {order} has been cancelled. We will refund what you paid — a separate e-mail will follow.",
      detail: "The money for this order goes back the way it came.",
    },
  },
  back: {
    ru: {
      preheader: "Заказ отменён. Деньги за него уже возвращены.",
      intro: "Заказ № {order} отменён. Деньги за него уже возвращены.",
      detail: "Деньги за этот заказ уже возвращены.",
    },
    et: {
      preheader: "Tellimus on tühistatud. Raha selle eest on juba tagastatud.",
      intro: "Tellimus nr {order} on tühistatud. Raha selle eest on juba tagastatud.",
      detail: "Selle tellimuse raha on juba tagastatud.",
    },
    en: {
      preheader: "The order has been cancelled. The money has already been refunded.",
      intro: "Order no. {order} has been cancelled. The money for it has already been refunded.",
      detail: "The money for this order has already been refunded.",
    },
  },
};

/**
 * The money line and the «what next» line when a gift card is involved. Two
 * shapes: everything went back onto the card (the order was paid with it
 * entirely), or part did and the rest went to the bank. `{sum}`, `{gift}`,
 * `{money}` and `{code}` are filled by giftLines() below.
 */
const GIFT: Record<Lang, { all: string; allWait: string; part: string; partWait: string }> = {
  ru: {
    all: "Мы вернули {sum} на подарочную карту {code}.",
    allWait: "Картой снова можно платить: введите её код в поле «Промокод или подарочная карта» при оформлении заказа.",
    part: "Мы отправили обратно {sum}: {gift} — на подарочную карту {code}, {money} — на ваш счёт.",
    partWait: "Картой снова можно платить. Деньги на счёт идут тем же путём, каким пришли: на банковский счёт — обычно 1–2 рабочих дня, на карту — до 5 рабочих дней.",
  },
  et: {
    all: "Tagastasime {sum} kinkekaardile {code}.",
    allWait: "Kaardiga saab jälle maksta: sisestage selle kood tellimuse vormistamisel väljale «Sooduskood või kinkekaart».",
    part: "Saatsime tagasi {sum}: {gift} — kinkekaardile {code}, {money} — teie kontole.",
    partWait: "Kaardiga saab jälle maksta. Raha kontole liigub sama teed, kust tuli: pangakontole tavaliselt 1–2 tööpäeva, kaardile kuni 5 tööpäeva.",
  },
  en: {
    all: "We have put {sum} back onto gift card {code}.",
    allWait: "The card works again: enter its code in the «Promo code or gift card» box at the checkout.",
    part: "We have sent {sum} back: {gift} onto gift card {code}, {money} to your account.",
    partWait: "The card works again. The money to your account travels the way it came: to a bank account usually 1–2 business days, to a card up to 5 business days.",
  },
};

interface Strings {
  preheader: string;
  title: string;
  /** The panel's label and its two lines. */
  label: string;
  /**
   * The money line, split where the sum goes — «Мы отправили обратно » + сумма
   * + «.». Two halves rather than one sentence with a hole in it because the
   * HTML copy needs `42&nbsp;€` (a price never wraps between the number and
   * the sign — tests/emails-compat.test.ts) and the halves around it escaped.
   * A cancelled order has no sum: the second half is empty and unused.
   */
  detail: readonly [string, string];
  wait: string;
}

const T: Record<ClosedKind, Record<Lang, Strings>> = {
  cancelled: {
    ru: {
      preheader: "Заказ отменён. Деньги за него не списаны.",
      title: "Заказ отменён",
      label: "Что с деньгами",
      detail: ["Деньги за этот заказ не списаны.", ""],
      wait: "Если вы всё-таки хотите эти товары — оформите заказ заново, они снова в магазине.",
    },
    et: {
      preheader: "Tellimus on tühistatud. Raha selle eest maha ei võetud.",
      title: "Tellimus tühistatud",
      label: "Mis rahaga sai",
      detail: ["Selle tellimuse eest raha maha ei võetud.", ""],
      wait: "Kui soovite need tooted siiski — vormistage tellimus uuesti, need on poes tagasi.",
    },
    en: {
      preheader: "The order has been cancelled. Nothing was charged for it.",
      title: "Order cancelled",
      label: "About the money",
      detail: ["Nothing was charged for this order.", ""],
      wait: "Still want these items? Place the order again — they are back in the shop.",
    },
  },
  refund_sent: {
    ru: {
      preheader: "Возврат отправлен в банк.",
      title: "Возврат отправлен",
      label: "Сумма возврата",
      detail: ["Мы отправили возврат на ", "."],
      wait: "Банк переводит деньги не сразу: обычно они приходят в течение нескольких дней. Когда деньги будут у вас, мы напишем ещё раз. Если через десять дней их всё ещё нет — ответьте на это письмо.",
    },
    et: {
      preheader: "Tagastus on panka saadetud.",
      title: "Tagastus saadetud",
      label: "Tagastatav summa",
      detail: ["Saatsime tagastuse summas ", "."],
      wait: "Pank ei kanna raha kohe: tavaliselt jõuab see kohale mõne päevaga. Kui raha on teie kontol, kirjutame uuesti. Kui kümne päeva pärast seda ikka ei ole — vastake sellele kirjale.",
    },
    en: {
      preheader: "The refund has been sent to the bank.",
      title: "Refund sent",
      label: "Refund amount",
      detail: ["We have sent a refund of ", "."],
      wait: "A bank does not move money instantly: it usually arrives within a few days. We will write again once it is with you. If it still has not arrived after ten days, reply to this letter.",
    },
  },
  refunded: {
    ru: {
      preheader: "Деньги за заказ отправлены обратно.",
      title: "Деньги возвращены",
      label: "Сумма возврата",
      detail: ["Мы отправили обратно ", "."],
      wait: "Деньги идут тем же путём, каким пришли: на банковский счёт — обычно 1–2 рабочих дня, на карту — до 5 рабочих дней.",
    },
    et: {
      preheader: "Tellimuse raha on tagasi teel.",
      title: "Raha tagastatud",
      label: "Tagastatud summa",
      detail: ["Saatsime tagasi ", "."],
      wait: "Raha liigub sama teed, kust tuli: pangakontole tavaliselt 1–2 tööpäeva, kaardile kuni 5 tööpäeva.",
    },
    en: {
      preheader: "The money for your order is on its way back.",
      title: "Money refunded",
      label: "Refunded amount",
      detail: ["We have sent ", " back."],
      wait: "The money travels the way it came: to a bank account usually 1–2 business days, to a card up to 5 business days.",
    },
  },
};

export function renderOrderCancelled(
  order: OrderLike,
  lang: Lang | string = "ru",
  options: ClosedOptions = { kind: "cancelled" },
): RenderedEmail {
  const L = normalizeLang(lang);
  const kind: ClosedKind = options.kind === "refunded" || options.kind === "refund_sent" ? options.kind : "cancelled";
  const t = T[kind][L];
  const c = COMMON[L];
  /* `refund_sent` borrows the refund template's own intro and signature — the
     owner writes one set of words for «возврат» in «Письма» and both letters
     are that event, one before the money lands and one after. */
  const template =
    kind === "cancelled" ? "order-cancelled" : kind === "refund_sent" ? "order-refund-sent" : "order-refunded";

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  /* On a refund `{total}` is what went back, not the order's total: the two
     differ on a partial refund, and the number in the letter must be the one
     the customer will see on their statement. docs/mail.md says so too. */
  const amount = kind === "cancelled" ? num(order.total, 0) : num(options.amount, num(order.total, 0));
  const sum = money(amount);

  const values: MailTextValues = { name, order: number, total: sum, shop: BRAND.name };
  /* A cancelled order the customer PAID for: the money line, the preheader
     and — while the owner has written no opening of his own — the opening say
     where the money is, never «не списаны» (cancelMoneyOf above). */
  const moneyState: CancelMoney = kind === "cancelled" ? cancelMoneyOf(order, options.value) : "none";
  const paid = moneyState === "none" ? null : CANCEL_PAID[moneyState][L];
  const paidIntro = paid && !hasMailText(template, L, "intro") ? fillPlaceholders(paid.intro, values).trim() : "";
  const intro = paidIntro || mailText(template, L, "intro", values);
  const introHtml = paidIntro ? esc(paidIntro) : mailTextHtml(template, L, "intro", values);
  const signature = mailText(template, L, "signature", values);
  const withSum = kind !== "cancelled";
  const gift = withSum ? giftLines(L, amount, options) : null;
  const detail = gift ? gift.detail : withSum ? t.detail[0] + sum + t.detail[1] : paid ? paid.detail : t.detail[0];
  const detailHtml = gift
    ? gift.detailHtml
    : withSum
      ? esc(t.detail[0]) + money(amount, true) + esc(t.detail[1])
      : esc(paid ? paid.detail : t.detail[0]);
  const wait = gift ? gift.wait : t.wait;

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${introHtml}`) +
    rowPanel(t.label, detailHtml, esc(wait)) +
    rowNote([mailTextHtml(template, L, "signature", values)]);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: paid ? paid.preheader : t.preheader,
    body,
    footerNote: esc(c.serviceNote),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    `${hello} ${intro}`,
    "",
    `${t.label}: ${detail}`,
    wait,
    "",
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText(template, L, "subject", values), html, text };
}

/**
 * The gift-card wording, or null when no part of the refund went onto a card.
 * Both copies are built from the same template: the plain text with the sums
 * as they are, the HTML with the sums non-breaking and everything else
 * escaped — the same two rules the plain refund line follows above.
 */
function giftLines(
  L: Lang,
  amount: number,
  options: ClosedOptions,
): { detail: string; detailHtml: string; wait: string } | null {
  const giftAmount = Math.min(amount, Math.max(0, num(options.giftAmount, 0)));
  if (!(giftAmount > 0)) return null;
  const code = typeof options.giftCode === "string" ? options.giftCode.trim() : "";
  const moneyAmount = Math.max(0, Math.round((amount - giftAmount) * 100) / 100);
  const all = moneyAmount < 0.005;
  const g = GIFT[L];
  const template = all ? g.all : g.part;
  const fill = (html: boolean) => {
    const sumOf = (n: number) => (html ? money(n, true) : money(n));
    const codeText = html ? esc(code) : code;
    // literal pieces are escaped for the HTML copy, the sums and the code spliced in after
    return template
      .split(/(\{sum\}|\{gift\}|\{money\}|\{code\})/)
      .map((piece) => {
        if (piece === "{sum}") return sumOf(amount);
        if (piece === "{gift}") return sumOf(giftAmount);
        if (piece === "{money}") return sumOf(moneyAmount);
        if (piece === "{code}") return codeText;
        return html ? esc(piece) : piece;
      })
      .join("");
  };
  return { detail: fill(false), detailHtml: fill(true), wait: all ? g.allWait : g.partWait };
}
