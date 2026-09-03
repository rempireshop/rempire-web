/**
 * «Ваша корзина ждёт» — the one marketing letter in the transactional set,
 * so it carries an unsubscribe link and never claims the goods are reserved.
 * Design source: public/shop/emails/abandoned-cart.html
 */

import { customerName, greeting, itemsBlock } from "./common";
import {
  COMMON,
  absUrl,
  esc,
  money,
  normalizeLang,
  num,
  rowButton,
  rowLead,
  rowLines,
  rowNote,
  rowTitle,
  shell,
  stripHtml,
  textBody,
  textFooter,
} from "./layout";
import type { CartLike, Lang, RenderedEmail } from "./types";

interface Strings {
  subject: string;
  preheader: string;
  title: string;
  lead: (hello: string) => string;
  cta: string;
  note: string;
  unsubscribeAsk: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: "Вы забыли корзину — Rempire",
    preheader: "Мы сохранили товары. Завершить заказ можно в пару кликов.",
    title: "Ваша корзина ждёт",
    lead: (hello) =>
      `${hello} Вы собрали корзину, но не завершили заказ. Мы всё сохранили — вот что внутри:`,
    cta: "Вернуться к корзине",
    note: "Товары в корзине не резервируются — популярные позиции быстро заканчиваются. Если передумали — просто проигнорируйте это письмо.",
    unsubscribeAsk: "Не хотите получать напоминания о корзине?",
  },
  et: {
    subject: "Ostukorv jäi pooleli — Rempire",
    preheader: "Salvestasime tooted. Tellimuse saab lõpetada paari klikiga.",
    title: "Ostukorv ootab",
    lead: (hello) =>
      `${hello} Panite ostukorvi kokku, aga tellimus jäi lõpetamata. Hoidsime kõik alles — siin on sisu:`,
    cta: "Tagasi ostukorvi",
    note: "Ostukorvis olevaid tooteid ei broneerita — populaarsed saavad kiiresti otsa. Kui mõtlesite ümber, jätke see kiri lihtsalt tähelepanuta.",
    unsubscribeAsk: "Ei soovi ostukorvi meeldetuletusi?",
  },
  en: {
    subject: "You left your cart — Rempire",
    preheader: "We saved your items. Finishing the order takes a couple of clicks.",
    title: "Your cart is waiting",
    lead: (hello) =>
      `${hello} You filled a cart but did not finish the order. We kept everything — here is what is inside:`,
    cta: "Back to the cart",
    note: "Items in a cart are not reserved — popular ones sell out quickly. Changed your mind? Just ignore this e-mail.",
    unsubscribeAsk: "Rather not get cart reminders?",
  },
};

export function renderAbandonedCart(
  cart: CartLike,
  lang: Lang | string = "ru",
  resumeUrl?: string | null,
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const hello = greeting(L, customerName(cart));
  const items = itemsBlock(cart.items, L);
  const stored = num(cart.total ?? cart.subtotal, NaN);
  const total = Number.isFinite(stored) ? stored : items.sum;

  const url = absUrl(resumeUrl, "/shop2/checkout/");
  const unsubscribe = absUrl(cart.unsubscribeUrl, "/shop2/account/");

  const body =
    rowTitle(t.title) +
    rowLead(t.lead(esc(hello))) +
    rowLines([
      ...items.lines,
      {
        label: esc(c.total),
        value: money(total, true),
        total: true,
      },
    ]) +
    rowButton(url, t.cta) +
    rowNote([esc(t.note)]);

  const footerNote =
    `${esc(t.unsubscribeAsk)} <a href="${esc(unsubscribe)}" class="em-link" style="color:#6f6b57; text-decoration:underline;">${esc(c.unsubscribe)}</a>`;

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote,
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    stripHtml(t.lead(hello)),
    "",
    ...items.text,
    `  ${c.total}: ${money(total)}`,
    "",
    `${t.cta}: ${url}`,
    "",
    t.note,
    textFooter(L, `${t.unsubscribeAsk} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: t.subject, html, text };
}
