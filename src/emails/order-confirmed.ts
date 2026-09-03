/**
 * «Заказ принят» — sent once the payment lands.
 * Design source: public/shop/emails/order-confirmed.html
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
  COMMON,
  esc,
  normalizeLang,
  rowLabel,
  rowLead,
  rowLines,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  stripHtml,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, OrderLike, RenderedEmail } from "./types";

interface Strings {
  subject: (n: string) => string;
  preheader: string;
  title: string;
  lead: (hello: string, n: string) => string;
  items: string;
  method: string;
  waitPickup: string;
  waitShip: string;
  reply: string;
  textIntro: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (n) => `Заказ ${n} принят — Rempire`,
    preheader:
      "Спасибо за заказ! Мы уже собираем его и напишем, когда он будет готов.",
    title: "Заказ принят",
    lead: (hello, n) =>
      `${hello} Спасибо за заказ <strong>№&nbsp;${n}</strong> — мы его получили и уже собираем.`,
    items: "Состав заказа",
    method: "Способ получения",
    waitPickup:
      "Мы напишем, когда заказ можно будет забрать — обычно в течение 1–2 рабочих дней.",
    waitShip:
      "Мы напишем, когда передадим посылку в доставку — обычно в течение 1–2 рабочих дней.",
    reply: "Есть вопрос по заказу? Просто ответьте на это письмо — мы на связи.",
    textIntro: "Состав заказа:",
  },
  et: {
    subject: (n) => `Tellimus ${n} on vastu võetud — Rempire`,
    preheader:
      "Aitäh tellimuse eest! Paneme selle kokku ja anname teada, kui see on valmis.",
    title: "Tellimus vastu võetud",
    lead: (hello, n) =>
      `${hello} Aitäh tellimuse <strong>nr&nbsp;${n}</strong> eest — see on meieni jõudnud ja paneme selle kokku.`,
    items: "Tellimuse sisu",
    method: "Kättesaamise viis",
    waitPickup:
      "Anname teada, kui tellimusele saab järele tulla — tavaliselt 1–2 tööpäeva jooksul.",
    waitShip:
      "Anname teada, kui paki kullerile üle anname — tavaliselt 1–2 tööpäeva jooksul.",
    reply:
      "Küsimus tellimuse kohta? Vastake lihtsalt sellele kirjale — oleme olemas.",
    textIntro: "Tellimuse sisu:",
  },
  en: {
    subject: (n) => `Order ${n} confirmed — Rempire`,
    preheader:
      "Thanks for your order! We are packing it and will write when it is ready.",
    title: "Order confirmed",
    lead: (hello, n) =>
      `${hello} Thank you for order <strong>no.&nbsp;${n}</strong> — we have it and are packing it now.`,
    items: "Order summary",
    method: "Delivery method",
    waitPickup:
      "We will write as soon as the order is ready for pickup — usually within 1–2 business days.",
    waitShip:
      "We will write as soon as the parcel is handed to the carrier — usually within 1–2 business days.",
    reply: "A question about the order? Just reply to this e-mail — we read it.",
    textIntro: "Order summary:",
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

  // The totals row wants the method only ("Пакомат Omniva"); the address
  // already has its own panel below.
  const rows = totalRows(totals, delivery.split(" — ")[0], L);

  const body =
    rowTitle(t.title) +
    rowLead(t.lead(esc(hello), esc(number))) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows.lines]) +
    rowPanel(t.method, esc(delivery), esc(wait)) +
    rowNote([esc(t.reply)]);

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
    stripHtml(t.lead(hello, number)),
    "",
    t.textIntro,
    ...items.text,
    ...rows.text,
    "",
    `${t.method}: ${delivery}`,
    wait,
    "",
    t.reply,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: t.subject(number), html, text };
}
