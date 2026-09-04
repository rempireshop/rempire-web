/**
 * «Заказ принят» — sent once the payment lands.
 * Design source: public/shop/emails/order-confirmed.html
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 * Everything else on this page is coded.
 */

import {
  customerName,
  deliveryLine,
  greeting,
  itemsBlock,
  orderNumber,
  shipKind,
  totalRows,
  totalsOf,
} from "./common";
import {
  BRAND,
  COMMON,
  esc,
  money,
  normalizeLang,
  num,
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
  method: string;
  waitPickup: string;
  waitShip: string;
  textIntro: string;
  /** wholesale/loyalty (100_tiers_loyalty) — one line, only when order.loyaltyEarned > 0. */
  points: (n: number) => string;
}

/** 1 балл, 2–4 балла, 5(-20) баллов — standard Russian numeral agreement. */
function ruPluralPoints(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "балл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "балла";
  return "баллов";
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader:
      "Спасибо за заказ! Мы уже собираем его и напишем, когда он будет готов.",
    title: "Заказ принят",
    items: "Состав заказа",
    method: "Способ получения",
    waitPickup:
      "Мы напишем, когда заказ можно будет забрать — обычно в течение 1–2 рабочих дней.",
    waitShip:
      "Мы напишем, когда передадим посылку в доставку — обычно в течение 1–2 рабочих дней.",
    textIntro: "Состав заказа:",
    points: (n) => `Вам начислено ${n} ${ruPluralPoints(n)} лояльности за этот заказ — уже доступны в личном кабинете.`,
  },
  et: {
    preheader:
      "Aitäh tellimuse eest! Paneme selle kokku ja anname teada, kui see on valmis.",
    title: "Tellimus vastu võetud",
    items: "Tellimuse sisu",
    method: "Kättesaamise viis",
    waitPickup:
      "Anname teada, kui tellimusele saab järele tulla — tavaliselt 1–2 tööpäeva jooksul.",
    waitShip:
      "Anname teada, kui paki kullerile üle anname — tavaliselt 1–2 tööpäeva jooksul.",
    textIntro: "Tellimuse sisu:",
    points: (n) => `Selle ostuga kogusite ${n} boonuspunkti — need juba ootavad teie kontol.`,
  },
  en: {
    preheader:
      "Thanks for your order! We are packing it and will write when it is ready.",
    title: "Order confirmed",
    items: "Order summary",
    method: "Delivery method",
    waitPickup:
      "We will write as soon as the order is ready for pickup — usually within 1–2 business days.",
    waitShip:
      "We will write as soon as the parcel is handed to the carrier — usually within 1–2 business days.",
    textIntro: "Order summary:",
    points: (n) => `You earned ${n} loyalty ${n === 1 ? "point" : "points"} on this order — already in your account.`,
  },
};

export function renderOrderConfirmed(
  order: OrderLike,
  lang: Lang | string = "ru",
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  const items = itemsBlock(order.items, L);
  const totals = totalsOf(order, items.sum);
  const delivery = deliveryLine(order.shipping, L);
  const pickup = shipKind(order.shipping) === "pickup";
  const wait = pickup ? t.waitPickup : t.waitShip;

  const values: MailTextValues = {
    name,
    order: number,
    total: money(totals.total),
    shop: BRAND.name,
  };
  const intro = mailText("order-confirmed", L, "intro", values);
  const signature = mailText("order-confirmed", L, "signature", values);

  // The totals row wants the method only ("Пакомат Omniva"); the address
  // already has its own panel below.
  const rows = totalRows(totals, delivery.split(" — ")[0], L);

  // wholesale/loyalty: only on the first arrival (return|notify route set
  // this from ApplyOutcome.pointsEarned) and only when it is actually > 0.
  const pointsEarned = Math.round(num(order.loyaltyEarned, 0));
  const pointsLine = pointsEarned > 0 ? t.points(pointsEarned) : "";

  const signatureHtml = mailTextHtml("order-confirmed", L, "signature", values);
  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("order-confirmed", L, "intro", values)}`) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows.lines]) +
    rowPanel(t.method, esc(delivery), esc(wait)) +
    rowNote(pointsLine ? [esc(pointsLine), signatureHtml] : [signatureHtml]);

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
    `${t.method}: ${delivery}`,
    wait,
    "",
    ...(pointsLine ? [pointsLine, ""] : []),
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return {
    subject: mailText("order-confirmed", L, "subject", values),
    html,
    text,
  };
}
