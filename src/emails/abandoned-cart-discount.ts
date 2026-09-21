/**
 * «Корзина ждёт — и вот скидка» — the second cart letter, the one with the
 * code, sent when the first one did not bring the shopper back.
 *
 * Renat, 20.09.2026, via Dim: «after first one did not work we send out
 * another mail with discount … preferably ONLY for the cart». That «only» is
 * not wording, it is the code: src/lib/flows.ts mints a single-use promo on
 * the `cart` scope (db/migrations/197_abandoned_cart_discount.sql), so the
 * percent below comes off the lines this letter lists and off nothing the
 * shopper adds afterwards.
 *
 * The button and the code say the same thing twice on purpose. The link
 * restores the basket AND carries the code; the code is printed under it
 * because a link is the part of a letter that gets broken — by a corporate
 * mail gateway rewriting it, by a copy-paste that loses the tail, by a client
 * that wraps a 400-character URL across two lines. A shopper with the code can
 * always type it into the box at the checkout by hand.
 *
 * Marketing, like its predecessor: the unsubscribe link and the RFC 8058
 * headers travel with it, and the flow never hands it an address that has
 * asked for silence.
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
  rowCode,
  rowLead,
  rowLines,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { CartDiscountOptions, CartLike, Lang, RenderedEmail } from "./types";
import { shopDay, ymdParts } from "../lib/day";

const DEFAULT_PERCENT = 5;

/* Written out rather than left to Intl, for the reason ./birthday.ts gives:
   a Node build with a trimmed ICU falls back to English month names in
   silence, and a date in the wrong language is what nobody notices until
   Renat forwards the letter. */
const MONTHS: Record<Lang, string[]> = {
  ru: [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ],
  et: [
    "jaanuar", "veebruar", "märts", "aprill", "mai", "juuni",
    "juuli", "august", "september", "oktoober", "november", "detsember",
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
};

/* The Tallinn calendar day, never the host's: the code is written to die at
   the end of a Tallinn day (endOfShopDay, src/lib/flows.ts) and this line is
   the promise the customer reads. */
function formatDate(d: Date, lang: Lang): string {
  const parts = ymdParts(shopDay(d));
  if (!parts) return "";
  const { year, day } = parts;
  const month = MONTHS[lang][parts.month - 1];
  if (lang === "et") return `${day}. ${month} ${year}`;
  return `${day} ${month} ${year}`;
}

function resolveExpiry(v: CartDiscountOptions["expires"]): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

interface Strings {
  preheader: (percent: number) => string;
  title: string;
  code: string;
  /** What the code may be spent on — the whole point of the `cart` scope. */
  onlyThisCart: string;
  validUntil: (date: string) => string;
  cta: string;
  unsubscribeAsk: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: (p) => `Промокод на −${p} % на эту корзину. Действует один раз.`,
    title: "Скидка на вашу корзину",
    code: "Ваш промокод",
    onlyThisCart: "Код действует на товары из этого письма и только один раз.",
    validUntil: (date) => `Действует до ${date} включительно.`,
    cta: "Вернуться к корзине со скидкой",
    unsubscribeAsk: "Не хотите получать напоминания о корзине?",
  },
  et: {
    preheader: (p) => `Sooduskood −${p} % sellele ostukorvile. Kehtib ühe korra.`,
    title: "Soodustus teie ostukorvile",
    code: "Teie sooduskood",
    onlyThisCart: "Kood kehtib selle kirja toodetele ja ainult ühe korra.",
    validUntil: (date) => `Kehtib kuni ${date} (kaasa arvatud).`,
    cta: "Tagasi ostukorvi soodustusega",
    unsubscribeAsk: "Ei soovi ostukorvi meeldetuletusi?",
  },
  en: {
    preheader: (p) => `A ${p}% code for this cart. Good for one order.`,
    title: "A discount for your cart",
    code: "Your promo code",
    onlyThisCart: "The code applies to the items in this e-mail, and to one order only.",
    validUntil: (date) => `Valid until ${date} inclusive.`,
    cta: "Back to the cart with the discount",
    unsubscribeAsk: "Rather not get cart reminders?",
  },
};

export function renderAbandonedCartDiscount(
  cart: CartLike,
  lang: Lang | string = "ru",
  resumeUrl?: string | null,
  options: CartDiscountOptions = {},
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const name = customerName(cart);
  const hello = greeting(L, name);
  const items = itemsBlock(cart.items, L);
  const stored = num(cart.total ?? cart.subtotal, NaN);
  const total = Number.isFinite(stored) ? stored : items.sum;

  const percent =
    Number.isFinite(options.percent) && (options.percent as number) > 0
      ? Math.round(options.percent as number)
      : DEFAULT_PERCENT;
  /* Uppercase and never empty: the code is the fallback for a broken link, so
     a letter that reached a customer with an empty box under the button would
     be a letter with no way in at all. */
  const promo = String(options.code || "").trim().toUpperCase() || "REM-CART";
  const expires = resolveExpiry(options.expires);
  /* Two sentences under the code, and the first one is always there: what the
     code may be spent on is the offer itself, while «до такого-то числа» is
     only true when the caller said when. */
  const codeNote = expires ? `${t.onlyThisCart} ${t.validUntil(formatDate(expires, L))}` : t.onlyThisCart;

  const url = absUrl(resumeUrl, "/shop2/checkout/");
  const unsubscribe = absUrl(cart.unsubscribeUrl, "/shop2/account/");

  const values: MailTextValues = {
    name,
    total: money(total),
    code: promo,
    percent,
    shop: BRAND.name,
  };
  const intro = mailText("abandoned-cart-discount", L, "intro", values);
  const signature = mailText("abandoned-cart-discount", L, "signature", values);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("abandoned-cart-discount", L, "intro", values)}`) +
    rowLines([
      ...items.lines,
      {
        label: esc(c.total),
        value: money(total, true),
        total: true,
      },
    ]) +
    rowButton(url, t.cta) +
    rowCode(t.code, promo, codeNote) +
    rowNote([mailTextHtml("abandoned-cart-discount", L, "signature", values)]);

  const footerNote =
    `${esc(t.unsubscribeAsk)} <a href="${esc(unsubscribe)}" class="em-link" style="color:#6f6b57; text-decoration:underline;">${esc(c.unsubscribe)}</a>`;

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader(percent),
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
    `${t.code}: ${promo}`,
    codeNote,
    "",
    signature,
    textFooter(L, `${t.unsubscribeAsk} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: mailText("abandoned-cart-discount", L, "subject", values), html, text };
}
