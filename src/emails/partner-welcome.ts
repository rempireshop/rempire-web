/**
 * «Цены для салонов включены» — the letter a salon or a master gets the
 * moment the owner makes them a partner: from «Клиенты → + Партнёр», from
 * «Одобрить Pro» on a request, or from the tier switch on the customer card
 * (src/lib/partner-mail.ts is the one sender).
 *
 * A service letter about the account's status, so no unsubscribe link — the
 * same rule as the sign-in code. It reuses the beige panel the shipped-order
 * letter uses for the parcel: one label, one strong line («войдите по этой
 * почте»), one grey line (where the prices show).
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 * {percent} in the intro is the live salon discount (settings.pricing
 * .proDiscountPct), exactly like the birthday letter's {percent}.
 */

import { customerName, greeting } from "./common";
import {
  BRAND,
  absUrl,
  esc,
  normalizeLang,
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
import type { CustomerLike, Lang, RenderedEmail } from "./types";

const DEFAULT_PERCENT = 20;

interface Strings {
  preheader: string;
  title: string;
  how: string;
  step: string;
  where: string;
  cta: string;
  service: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Скидка для салонов уже действует — войдите в кабинет по этой почте.",
    title: "Цены для салонов включены",
    how: "Как это работает",
    step: "Войдите в кабинет по этой почте — пароль не нужен, код для входа придёт письмом.",
    where: "Цены для салонов видны на карточках товаров, на странице товара и в корзине; при оформлении заказа магазин считает их сам.",
    cta: "Войти в кабинет",
    service: "Это служебное письмо о вашем статусе партнёра.",
  },
  et: {
    preheader: "Salongisoodustus kehtib juba — logige selle e-posti aadressiga kontosse sisse.",
    title: "Salongihinnad on sisse lülitatud",
    how: "Kuidas see toimib",
    step: "Logige kontosse sisse selle e-posti aadressiga — parooli pole vaja, sisselogimiskood tuleb kirjaga.",
    where: "Salongihinnad on näha tootekaartidel, tootelehel ja ostukorvis; tellimuse vormistamisel arvutab pood need ise.",
    cta: "Logi kontosse sisse",
    service: "See on teenuskiri teie partneristaatuse kohta.",
  },
  en: {
    preheader: "The salon discount already applies — sign in with this e-mail address.",
    title: "Salon prices are on",
    how: "How it works",
    step: "Sign in to your account with this e-mail address — no password needed, the sign-in code arrives by e-mail.",
    where: "Salon prices show on product cards, on the product page and in the cart; at checkout the shop applies them by itself.",
    cta: "Sign in to your account",
    service: "This is a service e-mail about your partner status.",
  },
};

export interface PartnerWelcomeOptions {
  /** The salon discount, percent. Default 20 — the shop's own default. */
  percent?: number;
  /** The salon's name, when the owner typed one — only used for the greeting fallback. */
  company?: string | null;
}

export function renderPartnerWelcome(
  customer: CustomerLike,
  lang: Lang | string = "ru",
  options: PartnerWelcomeOptions = {},
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];

  /* The person's name first; a salon added by e-mail alone usually has none
     yet, and then the company the owner typed is the next best greeting —
     «Здравствуйте, Salon Näidis!» reads better than a bare «Здравствуйте!». */
  const company = String(options.company ?? "").trim().slice(0, 80);
  const name = customerName(customer) || company;
  const percent =
    Number.isFinite(options.percent) && (options.percent as number) >= 0
      ? Math.round(options.percent as number)
      : DEFAULT_PERCENT;
  const account = absUrl(null, "/shop2/account/");

  const values: MailTextValues = { name, percent, shop: BRAND.name };
  const hello = greeting(L, name);
  const intro = mailText("partner-welcome", L, "intro", values);
  const signature = mailText("partner-welcome", L, "signature", values);

  const body =
    rowTitle(t.title, true) +
    rowLead(`${esc(hello)} ${mailTextHtml("partner-welcome", L, "intro", values)}`, true) +
    rowPanel(t.how, esc(t.step), esc(t.where)) +
    rowButton(account, t.cta) +
    rowNote([mailTextHtml("partner-welcome", L, "signature", values)], true);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote: esc(t.service),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    `${hello} ${intro}`,
    "",
    `${t.how}: ${t.step}`,
    t.where,
    "",
    `${t.cta}: ${account}`,
    "",
    signature,
    textFooter(L, t.service),
  ]);

  return { subject: mailText("partner-welcome", L, "subject", values), html, text };
}
