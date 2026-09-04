/**
 * «С днём рождения» — personal promo code, 14 days.
 * Design source: public/shop/emails/birthday.html
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts. The
 * greeting itself stays coded, because it is the one place a missing name has
 * to change the wording («Ренат, поздравляем!» vs «Поздравляем!»).
 */

import { customerName } from "./common";
import {
  BRAND,
  COMMON,
  absUrl,
  esc,
  normalizeLang,
  rowButton,
  rowCode,
  rowLead,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type {
  BirthdayOptions,
  CustomerLike,
  Lang,
  RenderedEmail,
} from "./types";

const DEFAULT_PERCENT = 15;
const VALID_DAYS = 14;

/* Written out rather than left to Intl: a Node build with a trimmed ICU
   silently falls back to English month names, and a birthday letter in the
   wrong language is exactly the kind of thing nobody notices until Renat
   forwards it. */
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

function formatDate(d: Date, lang: Lang): string {
  const day = d.getDate();
  const month = MONTHS[lang][d.getMonth()];
  const year = d.getFullYear();
  if (lang === "et") return `${day}. ${month} ${year}`;
  return `${day} ${month} ${year}`;
}

interface Strings {
  preheader: string;
  title: string;
  greet: (name: string) => string;
  code: string;
  validUntil: (date: string) => string;
  cta: string;
  unsubscribeAsk: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Личный промокод внутри. Действует 14 дней.",
    title: "С днём рождения",
    greet: (name) => (name ? `${name}, поздравляем!` : "Поздравляем!") + " 🎂",
    code: "Ваш личный промокод",
    validUntil: (date) => `Действует 14 дней — до ${date} включительно.`,
    cta: "Выбрать себе подарок",
    unsubscribeAsk: "Не хотите получать поздравления и предложения?",
  },
  et: {
    preheader: "Isiklik sooduskood kirjas. Kehtib 14 päeva.",
    title: "Palju õnne sünnipäevaks",
    greet: (name) => (name ? `${name}, palju õnne!` : "Palju õnne!") + " 🎂",
    code: "Teie isiklik sooduskood",
    validUntil: (date) => `Kehtib 14 päeva — kuni ${date} (kaasa arvatud).`,
    cta: "Vali endale kingitus",
    unsubscribeAsk: "Ei soovi õnnitlusi ja pakkumisi?",
  },
  en: {
    preheader: "Personal promo code inside. Valid for 14 days.",
    title: "Happy birthday",
    greet: (name) => (name ? `${name}, congratulations!` : "Congratulations!") + " 🎂",
    code: "Your personal promo code",
    validUntil: (date) => `Valid for 14 days — until ${date} inclusive.`,
    cta: "Pick yourself a gift",
    unsubscribeAsk: "Rather not get greetings and offers?",
  },
};

function resolveExpiry(v: BirthdayOptions["expires"]): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() + VALID_DAYS);
  return d;
}

export function renderBirthday(
  customer: CustomerLike,
  lang: Lang | string = "ru",
  code = "",
  options: BirthdayOptions = {},
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const name = customerName(customer);
  const percent =
    Number.isFinite(options.percent) && (options.percent as number) > 0
      ? Math.round(options.percent as number)
      : DEFAULT_PERCENT;
  const promo = String(code || "").trim().toUpperCase() || "REM-BDAY";
  const until = t.validUntil(formatDate(resolveExpiry(options.expires), L));
  const url = absUrl(null, "/shop2/");
  const unsubscribe = absUrl(customer.unsubscribeUrl, "/shop2/account/");

  const values: MailTextValues = {
    name,
    code: promo,
    percent,
    shop: BRAND.name,
  };
  const hello = t.greet(name);
  const intro = mailText("birthday", L, "intro", values);
  const signature = mailText("birthday", L, "signature", values);

  const body =
    rowTitle(t.title, true) +
    rowLead(`${esc(hello)} ${mailTextHtml("birthday", L, "intro", values)}`, true) +
    rowCode(t.code, promo, until, true) +
    rowButton(url, t.cta) +
    rowNote([mailTextHtml("birthday", L, "signature", values)], true);

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
    `${t.code}: ${promo}`,
    until,
    "",
    `${t.cta}: ${url}`,
    "",
    signature,
    textFooter(L, `${t.unsubscribeAsk} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: mailText("birthday", L, "subject", values), html, text };
}
