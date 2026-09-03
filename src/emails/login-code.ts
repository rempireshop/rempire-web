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
 */

import {
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
import type { Lang, RenderedEmail } from "./types";

interface Strings {
  subject: (code: string) => string;
  preheader: (code: string) => string;
  title: string;
  lead: string;
  label: string;
  validFor: (minutes: number) => string;
  note: string;
  ignore: string;
  /** Replaces COMMON.serviceNote, which talks about orders. */
  service: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (code) => `${code} — код для входа в Rempire`,
    preheader: (code) => `Код ${code}. Действует 15 минут, никому его не пересылайте.`,
    title: "Код для входа",
    lead: "Здравствуйте! Вот код для входа в личный кабинет Rempire. Введите его на странице, с которой вы его запросили.",
    label: "Код для входа",
    validFor: (minutes) => `Действует ${minutes} минут.`,
    note: "Код одноразовый. Мы никогда не спрашиваем его по телефону или в переписке — если код спросили, это не мы.",
    ignore: "Если вы не запрашивали код, просто удалите это письмо: без кода в кабинет никто не войдёт.",
    service: "Это служебное письмо — код для входа в личный кабинет.",
  },
  et: {
    subject: (code) => `${code} — Rempire sisselogimiskood`,
    preheader: (code) => `Kood ${code}. Kehtib 15 minutit, ärge saatke seda kellelegi edasi.`,
    title: "Sisselogimiskood",
    lead: "Tere! Siin on kood Rempire kliendikontosse sisselogimiseks. Sisestage see samal lehel, kust koodi küsisite.",
    label: "Sisselogimiskood",
    validFor: (minutes) => `Kehtib ${minutes} minutit.`,
    note: "Kood on ühekordne. Me ei küsi seda kunagi telefoni teel ega kirjavahetuses — kui keegi küsib, ei ole see meie.",
    ignore: "Kui te koodi ei küsinud, kustutage see kiri: ilma koodita kontosse ei pääse.",
    service: "See on teenuskiri — kliendikonto sisselogimiskood.",
  },
  en: {
    subject: (code) => `${code} — your Rempire sign-in code`,
    preheader: (code) => `Code ${code}. Valid for 15 minutes, do not forward it to anyone.`,
    title: "Sign-in code",
    lead: "Hello! Here is the code for signing in to your Rempire account. Enter it on the page you asked for it from.",
    label: "Sign-in code",
    validFor: (minutes) => `Valid for ${minutes} minutes.`,
    note: "The code works once. We never ask for it by phone or in a chat — if somebody does, it is not us.",
    ignore: "Did not ask for a code? Delete this e-mail: nobody can sign in without it.",
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

  const digits = String(code ?? "").replace(/\s+/g, "").slice(0, 12) || "------";
  const minutes =
    Number.isFinite(options.minutes) && (options.minutes as number) > 0
      ? Math.round(options.minutes as number)
      : 15;
  const account = absUrl(null, "/shop2/account/");

  const body =
    rowTitle(t.title, true) +
    rowLead(esc(t.lead), true) +
    rowCode(t.label, digits, t.validFor(minutes), true) +
    rowNote([esc(t.note), esc(t.ignore)], true);

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
    t.lead,
    "",
    `${t.label}: ${digits}`,
    t.validFor(minutes),
    "",
    t.note,
    t.ignore,
    "",
    `${account}`,
    textFooter(L, t.service),
  ]);

  return { subject: t.subject(digits), html, text };
}
