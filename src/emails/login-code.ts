/**
 * «Код для входа» — the one letter that is a credential.
 *
 * A service letter, so no unsubscribe link: somebody who asked for a login
 * code must get it. It says the code out loud in both the subject-adjacent
 * preheader and the body, because on a phone the code is often read from the
 * notification without the letter ever being opened.
 *
 * There is no design file for this one under public/shop/emails/ — it reuses
 * the birthday letter's boxed-code row, which is the same object on the page.
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts. The
 * security note above the closing line is not: «мы никогда не спрашиваем код»
 * is a promise the shop makes, not copy.
 */

import {
  BRAND,
  COMMON,
  absUrl,
  esc,
  normalizeLang,
  rowCode,
  rowLead,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, RenderedEmail } from "./types";

interface Strings {
  preheader: (code: string) => string;
  title: string;
  label: string;
  validFor: (minutes: number) => string;
  note: string;
  /** Replaces COMMON.serviceNote, which talks about orders. */
  service: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: (code) => `Код ${code}. Действует 15 минут, никому его не пересылайте.`,
    title: "Код для входа",
    label: "Код для входа",
    validFor: (minutes) => `Действует ${minutes} минут.`,
    note: "Код одноразовый. Мы никогда не спрашиваем его по телефону или в переписке — если код спросили, это не мы.",
    service: "Это служебное письмо — код для входа в личный кабинет.",
  },
  et: {
    preheader: (code) => `Kood ${code}. Kehtib 15 minutit, ärge saatke seda kellelegi edasi.`,
    title: "Sisselogimiskood",
    label: "Sisselogimiskood",
    validFor: (minutes) => `Kehtib ${minutes} minutit.`,
    note: "Kood on ühekordne. Me ei küsi seda kunagi telefoni teel ega kirjavahetuses — kui keegi küsib, ei ole see meie.",
    service: "See on teenuskiri — kliendikonto sisselogimiskood.",
  },
  en: {
    preheader: (code) => `Code ${code}. Valid for 15 minutes, do not forward it to anyone.`,
    title: "Sign-in code",
    label: "Sign-in code",
    validFor: (minutes) => `Valid for ${minutes} minutes.`,
    note: "The code works once. We never ask for it by phone or in a chat — if somebody does, it is not us.",
    service: "This is a service e-mail — your account sign-in code.",
  },
};

export interface LoginCodeOptions {
  /** How long the code is good for, in minutes. Default 15. */
  minutes?: number;
}

export function renderLoginCode(
  code: string,
  lang: Lang | string = "ru",
  options: LoginCodeOptions = {},
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const digits = String(code ?? "").replace(/\s+/g, "").slice(0, 12) || "------";
  const minutes =
    Number.isFinite(options.minutes) && (options.minutes as number) > 0
      ? Math.round(options.minutes as number)
      : 15;
  const account = absUrl(null, "/shop2/account/");

  const values: MailTextValues = { code: digits, shop: BRAND.name };
  const intro = mailText("login-code", L, "intro", values);
  const signature = mailText("login-code", L, "signature", values);

  const body =
    rowTitle(t.title, true) +
    rowLead(`${esc(c.hello)} ${mailTextHtml("login-code", L, "intro", values)}`, true) +
    rowCode(t.label, digits, t.validFor(minutes), true) +
    rowNote([esc(t.note), mailTextHtml("login-code", L, "signature", values)], true);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader(digits),
    body,
    footerNote: esc(t.service),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    `${c.hello} ${intro}`,
    "",
    `${t.label}: ${digits}`,
    t.validFor(minutes),
    "",
    t.note,
    signature,
    "",
    `${account}`,
    textFooter(L, t.service),
  ]);

  return { subject: mailText("login-code", L, "subject", values), html, text };
}
