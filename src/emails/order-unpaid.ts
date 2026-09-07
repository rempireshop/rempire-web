/**
 * «Заказ ждёт оплаты» — the reminder before an unpaid order is cancelled.
 *
 * Dim, 07.09.2026: «We need reminders and after seven days we cancel and
 * inform.» This is the reminder half. It goes to an order that was placed and
 * never paid — a bank page closed halfway, a card that was refused — after the
 * interval set in «Письма» (`settings.flows.unpaidRemindDays`), and it says
 * plainly by when the order will be let go.
 *
 * The button goes to the failed receipt of that same order
 * (`/shop2/done/?n=…&s=failed&o=<id>`), which is the screen that already
 * carries «Оплатить ещё раз» and, since 07.09.2026, the choice of another
 * payment method. Nothing new had to be built to give the customer a way back.
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма») — see ./texts.ts.
 */

import { customerName, greeting, itemsBlock, orderNumber, totalRows, totalsOf } from "./common";
import {
  BRAND,
  COMMON,
  absUrl,
  esc,
  money,
  normalizeLang,
  num,
  rowButton,
  rowLabel,
  rowLead,
  rowLines,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, OrderLike, RenderedEmail } from "./types";

interface Strings {
  preheader: string;
  title: string;
  items: string;
  cta: string;
  /** «Заказ ждёт оплаты ещё N дней» — one literal per plural form. */
  deadline: (days: number) => string;
  note: string;
}

/** 1 день, 2–4 дня, 5+ дней — standard Russian numeral agreement. */
function ruDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Заказ собран и ждёт оплаты — оплатить можно по кнопке в письме.",
    title: "Заказ ждёт оплаты",
    items: "Состав заказа",
    cta: "Оплатить заказ",
    deadline: (d) => `Мы держим заказ ещё ${d} ${ruDays(d)}, потом отменим его и напишем вам об этом.`,
    note: "Если вы передумали — просто ничего не делайте, заказ отменится сам и денег с вас никто не возьмёт.",
  },
  et: {
    preheader: "Tellimus on koos ja ootab tasumist — maksta saab kirjas oleva nupuga.",
    title: "Tellimus ootab tasumist",
    items: "Tellimuse sisu",
    cta: "Maksa tellimus",
    deadline: (d) => `Hoiame tellimust veel ${d} päeva, siis tühistame selle ja anname teile teada.`,
    note: "Kui mõtlesite ümber, ärge tehke midagi — tellimus tühistatakse ise ja raha teilt ei võeta.",
  },
  en: {
    preheader: "Your order is put together and waiting for payment — the button is in this e-mail.",
    title: "Your order is waiting for payment",
    items: "Order summary",
    cta: "Pay for the order",
    deadline: (d) => `We are holding the order for ${d} more day(s); after that we cancel it and write to tell you.`,
    note: "Changed your mind? Do nothing — the order cancels itself and nothing is charged.",
  },
};

export interface UnpaidOptions {
  /** Days left before the order is cancelled by itself. */
  daysLeft: number;
  /** Absolute URL of the screen that lets the customer pay this order. */
  payUrl: string;
}

export function renderOrderUnpaid(
  order: OrderLike,
  lang: Lang | string = "ru",
  options: UnpaidOptions,
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  const items = itemsBlock(order.items, L);
  const totals = totalsOf(order, items.sum);
  const rows = totalRows(totals, "", L);
  const total = money(num(order.total, items.sum));
  const days = Math.max(0, Math.round(num(options.daysLeft, 0)));
  // absolute, always: a relative href in a letter resolves against the mail
  // client, which is nowhere (tests/emails-compat.test.ts)
  const payUrl = absUrl(options.payUrl);

  const values: MailTextValues = { name, order: number, total, shop: BRAND.name };
  const intro = mailText("order-unpaid", L, "intro", values);
  const signature = mailText("order-unpaid", L, "signature", values);
  const deadline = t.deadline(days);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("order-unpaid", L, "intro", values)}`) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows.lines]) +
    rowButton(payUrl, t.cta) +
    rowNote([esc(deadline), esc(t.note), mailTextHtml("order-unpaid", L, "signature", values)]);

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
    `${t.items}:`,
    ...items.text,
    ...rows.text,
    "",
    `${t.cta}: ${payUrl}`,
    "",
    deadline,
    t.note,
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText("order-unpaid", L, "subject", values), html, text };
}
