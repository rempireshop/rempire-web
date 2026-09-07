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
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, OrderLike, RenderedEmail } from "./types";

export type ClosedKind = "cancelled" | "refunded";

export interface ClosedOptions {
  kind: ClosedKind;
  /** What actually went back, on a refund. Defaults to the order's total. */
  amount?: number;
}

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
  const kind: ClosedKind = options.kind === "refunded" ? "refunded" : "cancelled";
  const t = T[kind][L];
  const c = COMMON[L];
  const template = kind === "refunded" ? "order-refunded" : "order-cancelled";

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  /* On a refund `{total}` is what went back, not the order's total: the two
     differ on a partial refund, and the number in the letter must be the one
     the customer will see on their statement. docs/mail.md says so too. */
  const amount = kind === "refunded" ? num(options.amount, num(order.total, 0)) : num(order.total, 0);
  const sum = money(amount);

  const values: MailTextValues = { name, order: number, total: sum, shop: BRAND.name };
  const intro = mailText(template, L, "intro", values);
  const signature = mailText(template, L, "signature", values);
  const withSum = kind === "refunded";
  const detail = withSum ? t.detail[0] + sum + t.detail[1] : t.detail[0];
  const detailHtml = withSum
    ? esc(t.detail[0]) + money(amount, true) + esc(t.detail[1])
    : esc(t.detail[0]);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml(template, L, "intro", values)}`) +
    rowPanel(t.label, detailHtml, esc(t.wait)) +
    rowNote([mailTextHtml(template, L, "signature", values)]);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote: esc(c.serviceNote),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    `${hello} ${intro}`,
    "",
    `${t.label}: ${detail}`,
    t.wait,
    "",
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText(template, L, "subject", values), html, text };
}
