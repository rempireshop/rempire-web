/**
 * «С днём рождения» — personal promo code, 14 days.
 * Design source: public/shop/emails/birthday.html
 */

import { customerName } from "./common";
import {
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
  stripHtml,
  textBody,
  textFooter,
} from "./layout";
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
  subject: string;
  preheader: string;
  title: string;
  lead: (name: string, percent: number) => string;
  code: string;
  validUntil: (date: string) => string;
  cta: string;
  note: string;
  unsubscribeAsk: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: "С днём рождения! Ваша персональная скидка — Rempire",
    preheader: "Личный промокод внутри. Действует 14 дней.",
    title: "С днём рождения",
    lead: (name, percent) =>
      `${name ? `${name}, поздравляем!` : "Поздравляем!"} 🎂 В честь вашего дня рождения дарим скидку <strong>${percent}&nbsp;%</strong> на всё в магазине — уход, укладку, бороду и парфюм.`,
    code: "Ваш личный промокод",
    validUntil: (date) => `Действует 14 дней — до ${date} включительно.`,
    cta: "Выбрать себе подарок",
    note: "Введите код при оформлении заказа. Промокод личный и не суммируется с другими акциями.",
    unsubscribeAsk: "Не хотите получать поздравления и предложения?",
  },
  et: {
    subject: "Palju õnne sünnipäevaks! Teie isiklik soodustus — Rempire",
    preheader: "Isiklik sooduskood kirjas. Kehtib 14 päeva.",
    title: "Palju õnne sünnipäevaks",
    lead: (name, percent) =>
      `${name ? `${name}, palju õnne!` : "Palju õnne!"} 🎂 Sünnipäeva puhul kingime <strong>${percent}&nbsp;%</strong> soodustust kogu poele — hooldus, viimistlus, habe ja parfüüm.`,
    code: "Teie isiklik sooduskood",
    validUntil: (date) => `Kehtib 14 päeva — kuni ${date} (kaasa arvatud).`,
    cta: "Vali endale kingitus",
    note: "Sisestage kood tellimuse vormistamisel. Kood on isiklik ega liitu teiste kampaaniatega.",
    unsubscribeAsk: "Ei soovi õnnitlusi ja pakkumisi?",
  },
  en: {
    subject: "Happy birthday! Your personal discount — Rempire",
    preheader: "Personal promo code inside. Valid for 14 days.",
    title: "Happy birthday",
    lead: (name, percent) =>
      `${name ? `${name}, congratulations!` : "Congratulations!"} 🎂 For your birthday here is <strong>${percent}%</strong> off everything in the shop — hair, styling, beard and fragrance.`,
    code: "Your personal promo code",
    validUntil: (date) => `Valid for 14 days — until ${date} inclusive.`,
    cta: "Pick yourself a gift",
    note: "Enter the code at checkout. The code is personal and does not stack with other offers.",
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

  const body =
    rowTitle(t.title, true) +
    rowLead(t.lead(esc(name), percent), true) +
    rowCode(t.code, promo, until, true) +
    rowButton(url, t.cta) +
    rowNote([esc(t.note)], true);

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
    stripHtml(t.lead(name, percent)),
    "",
    `${t.code}: ${promo}`,
    until,
    "",
    `${t.cta}: ${url}`,
    "",
    t.note,
    textFooter(L, `${t.unsubscribeAsk} ${c.unsubscribe}: ${unsubscribe}`),
  ]);

  return { subject: t.subject, html, text };
}
