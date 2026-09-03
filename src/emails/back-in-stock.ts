/**
 * «Снова в наличии» — for the address left on a sold-out product page.
 * Design source: public/shop/emails/back-in-stock.html
 */

import {
  COMMON,
  absUrl,
  esc,
  money,
  normalizeLang,
  num,
  pick,
  rowButton,
  rowLead,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, ProductLike, RenderedEmail } from "./types";

interface Strings {
  subject: (p: string) => string;
  preheader: string;
  title: string;
  lead: string;
  label: string;
  restock: string;
  cta: string;
  note: string;
  why: string;
  unsubscribeAsk: string;
  fallbackName: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (p) => `${p} снова в наличии — Rempire`,
    preheader: "Вы просили сообщить, когда товар вернётся. Он на месте.",
    title: "Снова в наличии",
    lead: "Здравствуйте! Вы просили сообщить, когда этот товар вернётся в магазин. Хорошая новость — он снова на полке.",
    label: "Товар",
    restock: "Мы привезли новую партию — прошлая разошлась быстро.",
    cta: "Перейти к товару",
    note: "Наличие и цена актуальны на момент отправки письма. Мы не резервируем товар — кто первый, того и полка.",
    why: "Вы получили это письмо, потому что подписались на уведомление о наличии этого товара.",
    unsubscribeAsk: "Не хотите получать такие уведомления?",
    fallbackName: "Товар из вашего списка ожидания",
  },
  et: {
    subject: (p) => `${p} on taas laos — Rempire`,
    preheader: "Palusite teada anda, kui toode naaseb. Ta on kohal.",
    title: "Taas laos",
    lead: "Tere! Palusite teada anda, kui see toode poodi naaseb. Hea uudis — ta on taas riiulil.",
    label: "Toode",
    restock: "Tõime uue partii — eelmine sai kiiresti otsa.",
    cta: "Vaata toodet",
    note: "Saadavus ja hind kehtivad kirja saatmise hetkel. Me ei broneeri toodet — kes ees, see mees.",
    why: "Saite selle kirja, sest tellisite selle toote saadavuse teavituse.",
    unsubscribeAsk: "Ei soovi selliseid teavitusi?",
    fallbackName: "Toode teie ootenimekirjast",
  },
  en: {
    subject: (p) => `${p} is back in stock — Rempire`,
    preheader: "You asked to be told when it returned. It is on the shelf.",
    title: "Back in stock",
    lead: "Hello! You asked us to write when this product came back. Good news — it is on the shelf again.",
    label: "Product",
    restock: "A new batch has arrived — the last one went quickly.",
    cta: "Go to the product",
    note: "Availability and price are correct at the time this e-mail was sent. We do not reserve stock — first come, first served.",
    why: "You are getting this e-mail because you asked to be notified about this product.",
    unsubscribeAsk: "Rather not get these notifications?",
    fallbackName: "The product from your waiting list",
  },
};

/** "Kevin.Murphy Fresh.Hair — сухой шампунь, 34 €" from whatever we have. */
function productTitle(product: ProductLike, lang: Lang): string {
  const base = pick(
    [pick(product.brand), pick(product.title, product.name)]
      .filter(Boolean)
      .join(" "),
    T[lang].fallbackName,
  );
  const variant = pick(product.variant);
  const price = num(product.price, NaN);
  const tail = [variant, Number.isFinite(price) ? money(price) : ""]
    .filter(Boolean)
    .join(", ");
  return tail ? `${base} — ${tail}` : base;
}

export function renderBackInStock(
  product: ProductLike,
  lang: Lang | string = "ru",
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const title = productTitle(product, L);
  const subjectName = pick(
    [pick(product.brand), pick(product.title, product.name)]
      .filter(Boolean)
      .join(" "),
    t.fallbackName,
  );
  const url = absUrl(
    pick(product.url, product.slug ? `/shop2/p/${product.slug}/` : ""),
    "/shop2/",
  );
  const unsubscribe = absUrl(product.unsubscribeUrl, "/shop2/account/");

  const body =
    rowTitle(t.title) +
    rowLead(esc(t.lead)) +
    rowPanel(t.label, esc(title), esc(t.restock), true) +
    rowButton(url, t.cta) +
    rowNote([esc(t.note)]);

  const footerNote =
    `${esc(t.why)} <a href="${esc(unsubscribe)}" class="em-link" style="color:#6f6b57; text-decoration:underline;">${esc(c.unsubscribe)}</a>`;

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
    t.lead,
    "",
    `${t.label}: ${title}`,
    t.restock,
    "",
    `${t.cta}: ${url}`,
    "",
    t.note,
    textFooter(L, `${t.why} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: t.subject(subjectName), html, text };
}
