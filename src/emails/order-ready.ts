/**
 * «Заказ готов к выдаче» — a pickup order is packed and waiting at the salon.
 *
 * The letter «Заказ принят» has always promised it — «Мы напишем, когда заказ
 * можно будет забрать» — and there was no such letter: R-100116 (01.11.2026)
 * waited for it and Renat had nothing to press (Dim, 06.11.2026: «she was
 * waiting for a notification to arrive that her package is ready for
 * pick-up»). It goes when the owner presses «Готов к выдаче» on a pickup
 * order (src/lib/ship-order.ts), held ten seconds for the toast's «Вернуть».
 *
 * Built like «Заказ принят» (./order-confirmed.ts), because Dim asked for the
 * items in it: the lines and the total, then one panel — where to collect it,
 * the salon's opening hours from Настройки → Контент, and what to say at the
 * counter. Subject, the paragraph under the greeting and the closing line are
 * the owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 */

import { customerName, greeting, itemsBlock, orderNumber, pickupPlace, totalRows, totalsOf } from "./common";
import {
  BRAND,
  COMMON,
  brandHours,
  esc,
  money,
  normalizeLang,
  rowLabel,
  rowLead,
  rowLines,
  rowNote,
  rowPanel,
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
  where: string;
  /** The totals row's method word — the place itself has the panel below. */
  method: string;
  hours: (h: string) => string;
  /** What to do at the counter. */
  how: (order: string) => string;
  textIntro: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Заказ собран — его можно забрать в студии.",
    title: "Заказ готов к выдаче",
    items: "Состав заказа",
    where: "Где забрать",
    method: "Самовывоз",
    hours: (h) => `Часы работы: ${h}`,
    how: (n) => `Назовите номер заказа ${n} — мы его выдадим.`,
    textIntro: "Состав заказа:",
  },
  et: {
    preheader: "Tellimus on kokku pandud — sellele saab stuudiosse järele tulla.",
    title: "Tellimus on valmis",
    items: "Tellimuse sisu",
    where: "Kust kätte saada",
    method: "Järeletulek",
    hours: (h) => `Lahtiolekuajad: ${h}`,
    how: (n) => `Öelge tellimuse number ${n} — anname selle teile üle.`,
    textIntro: "Tellimuse sisu:",
  },
  en: {
    preheader: "Your order is packed — collect it at the studio.",
    title: "Ready for pickup",
    items: "Order summary",
    where: "Where to collect",
    method: "Pickup",
    hours: (h) => `Opening hours: ${h}`,
    how: (n) => `Give your order number ${n} at the counter and we will hand it over.`,
    textIntro: "Order summary:",
  },
};

export function renderOrderReady(order: OrderLike, lang: Lang | string = "ru"): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  const items = itemsBlock(order.items, L);
  const totals = totalsOf(order, items.sum);
  const rows = totalRows(totals, t.method, L);
  const place = pickupPlace();
  const hours = brandHours(L);
  const notes = [hours ? t.hours(hours) : "", t.how(number)].filter(Boolean);

  const values: MailTextValues = {
    name,
    order: number,
    total: money(totals.total),
    shop: BRAND.name,
  };
  const intro = mailText("order-ready", L, "intro", values);
  const signature = mailText("order-ready", L, "signature", values);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("order-ready", L, "intro", values)}`) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows.lines]) +
    rowPanel(t.where, esc(place), notes.map(esc).join("<br>")) +
    rowNote([mailTextHtml("order-ready", L, "signature", values)]);

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
    t.textIntro,
    ...items.text,
    ...rows.text,
    "",
    `${t.where}: ${place}`,
    ...notes,
    "",
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText("order-ready", L, "subject", values), html, text };
}
