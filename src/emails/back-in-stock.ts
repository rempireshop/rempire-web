/**
 * «Снова в наличии» — for the address left on a sold-out product page.
 * Design source: public/shop/emails/back-in-stock.html
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 */

import {
  BRAND,
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
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, ProductLike, RenderedEmail } from "./types";

interface Strings {
  preheader: string;
  title: string;
  label: string;
  restock: string;
  cta: string;
  why: string;
  fallbackName: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Вы просили сообщить, когда товар вернётся. Он на месте.",
    title: "Снова в наличии",
    label: "Товар",
    restock: "Мы привезли новую партию — прошлая разошлась быстро.",
    cta: "Перейти к товару",
    why: "Вы получили это письмо, потому что подписались на уведомление о наличии этого товара.",
    fallbackName: "Товар из вашего списка ожидания",
  },
  et: {
    preheader: "Palusite teada anda, kui toode naaseb. Ta on kohal.",
    title: "Taas laos",
    label: "Toode",
    restock: "Tõime uue partii — eelmine sai kiiresti otsa.",
    cta: "Vaata toodet",
    why: "Saite selle kirja, sest tellisite selle toote saadavuse teavituse.",
    fallbackName: "Toode teie ootenimekirjast",
  },
  en: {
    preheader: "You asked to be told when it returned. It is on the shelf.",
    title: "Back in stock",
    label: "Product",
    restock: "A new batch has arrived — the last one went quickly.",
    cta: "Go to the product",
    why: "You are getting this e-mail because you asked to be notified about this product.",
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

  const values: MailTextValues = {
    product: subjectName,
    total: Number.isFinite(num(product.price, NaN)) ? money(product.price) : "",
    shop: BRAND.name,
  };
  const intro = mailText("back-in-stock", L, "intro", values);
  const signature = mailText("back-in-stock", L, "signature", values);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(c.hello)} ${mailTextHtml("back-in-stock", L, "intro", values)}`) +
    rowPanel(t.label, esc(title), esc(t.restock), true) +
    rowButton(url, t.cta) +
    rowNote([mailTextHtml("back-in-stock", L, "signature", values)]);

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
    `${c.hello} ${intro}`,
    "",
    `${t.label}: ${title}`,
    t.restock,
    "",
    `${t.cta}: ${url}`,
    "",
    signature,
    textFooter(L, `${t.why} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: mailText("back-in-stock", L, "subject", values), html, text };
}
