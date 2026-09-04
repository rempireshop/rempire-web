/**
 * «Ваша корзина ждёт» — the one marketing letter in the transactional set,
 * so it carries an unsubscribe link and never claims the goods are reserved.
 * Design source: public/shop/emails/abandoned-cart.html
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 */

import { customerName, greeting, itemsBlock } from "./common";
import {
  BRAND,
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
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { CartLike, Lang, RenderedEmail } from "./types";

interface Strings {
  preheader: string;
  title: string;
  cta: string;
  unsubscribeAsk: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Мы сохранили товары. Завершить заказ можно в пару кликов.",
    title: "Ваша корзина ждёт",
    cta: "Вернуться к корзине",
    unsubscribeAsk: "Не хотите получать напоминания о корзине?",
  },
  et: {
    preheader: "Salvestasime tooted. Tellimuse saab lõpetada paari klikiga.",
    title: "Ostukorv ootab",
    cta: "Tagasi ostukorvi",
    unsubscribeAsk: "Ei soovi ostukorvi meeldetuletusi?",
  },
  en: {
    preheader: "We saved your items. Finishing the order takes a couple of clicks.",
    title: "Your cart is waiting",
    cta: "Back to the cart",
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

  const name = customerName(cart);
  const hello = greeting(L, name);
  const items = itemsBlock(cart.items, L);
  const stored = num(cart.total ?? cart.subtotal, NaN);
  const total = Number.isFinite(stored) ? stored : items.sum;

  const url = absUrl(resumeUrl, "/shop2/checkout/");
  const unsubscribe = absUrl(cart.unsubscribeUrl, "/shop2/account/");

  const values: MailTextValues = {
    name,
    total: money(total),
    shop: BRAND.name,
  };
  const intro = mailText("abandoned-cart", L, "intro", values);
  const signature = mailText("abandoned-cart", L, "signature", values);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("abandoned-cart", L, "intro", values)}`) +
    rowLines([
      ...items.lines,
      {
        label: esc(c.total),
        value: money(total, true),
        total: true,
      },
    ]) +
    rowButton(url, t.cta) +
    rowNote([mailTextHtml("abandoned-cart", L, "signature", values)]);

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
    `${hello} ${intro}`,
    "",
    ...items.text,
    `  ${c.total}: ${money(total)}`,
    "",
    `${t.cta}: ${url}`,
    "",
    signature,
    textFooter(L, `${t.unsubscribeAsk} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: mailText("abandoned-cart", L, "subject", values), html, text };
}
