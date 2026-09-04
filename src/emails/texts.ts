/**
 * Owner-editable letter copy — subject, intro paragraph, closing line.
 *
 * The shop's letters are coded (order table, buttons, footer, legal), but the
 * three sentences a shop owner actually wants to change are not: the subject
 * line, the paragraph under the greeting, and the closing line at the bottom.
 * Those three live here, per template and per language, with the current
 * texts as the defaults — a shop that never opens «Письма» renders exactly
 * what it rendered before this file existed.
 *
 * Storage: `settings.mail_texts`, written through PUT /api/admin/settings
 *
 *   { "order-confirmed": { "et": { "subject": "…", "intro": "…" } } }
 *
 * Anything else in that blob is dropped by cleanMailTexts() — the same
 * "first door, not the only one" rule `pricing` and `shipping_rules` follow.
 *
 * How a renderer uses it (the ambient-override pattern `setBrandOverride()`
 * already established in layout.ts — the renderers stay pure functions of
 * (row, lang), and the *caller* — a mail hook, the flows cron, the preview
 * route — loads the setting once per send with `loadMailTexts()` from
 * src/lib/mail-texts.ts):
 *
 *   const intro = mailTextHtml("order-confirmed", L, "intro", values);
 *
 * Escaping: mailText() hands back the raw string for the plain-text part;
 * mailTextHtml() escapes it for the HTML part. The owner types text, never
 * markup — "<b>x</b>" in a subject stays "<b>x</b>" on screen.
 */

import { esc } from "./layout";
import type { Lang } from "./types";

/* ---------- shape ------------------------------------------------------- */

export const MAIL_TEXT_TEMPLATES = [
  "order-confirmed",
  "order-shipped",
  "abandoned-cart",
  "back-in-stock",
  "birthday",
  "login-code",
] as const;

export type MailTextTemplate = (typeof MAIL_TEXT_TEMPLATES)[number];

export const MAIL_TEXT_FIELDS = ["subject", "intro", "signature"] as const;
export type MailTextField = (typeof MAIL_TEXT_FIELDS)[number];

/** Hard caps, enforced on write (the settings route) and on read. */
export const MAIL_TEXT_LIMITS: Record<MailTextField, number> = {
  subject: 200,
  intro: 1500,
  signature: 300,
};

export type MailTextSet = Record<MailTextField, string>;
export type MailTexts = Partial<
  Record<MailTextTemplate, Partial<Record<Lang, Partial<MailTextSet>>>>
>;

export function isMailTextTemplate(v: unknown): v is MailTextTemplate {
  return (MAIL_TEXT_TEMPLATES as readonly string[]).includes(String(v));
}

/* ---------- placeholders ------------------------------------------------ */

/**
 * The whole list the owner may type, and the only tokens ever substituted.
 * Anything else — `{foo}`, `{{name}}`, a stray brace — is left exactly as
 * typed, so a curly brace in a sentence cannot silently disappear.
 *
 * `percent` is the one token that is not offered as a chip: it exists because
 * the birthday letter's *default* text carries the discount, which is a shop
 * setting (`settings.flows.birthdayPercent`) and must stay live. An owner who
 * keeps it in his own text gets the same behaviour; one who types a number
 * instead owns that number. Documented in docs/mail.md.
 */
export const MAIL_PLACEHOLDERS = [
  "name",
  "order",
  "total",
  "track",
  "code",
  "product",
  "shop",
] as const;

export type MailPlaceholder = (typeof MAIL_PLACEHOLDERS)[number];

const SUBSTITUTED: readonly string[] = [...MAIL_PLACEHOLDERS, "percent"];

export type MailTextValues = Partial<Record<string, string | number>>;

const TOKEN_RE = /\{([a-z]+)\}/g;

/** Replace the known tokens; leave every other brace pair verbatim. */
export function fillPlaceholders(text: string, values: MailTextValues = {}): string {
  return String(text ?? "").replace(TOKEN_RE, (whole, key: string) => {
    if (!SUBSTITUTED.includes(key)) return whole;
    const v = values[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/* ---------- the defaults = today's copy --------------------------------- */

/*
 * Each entry is the text the renderer used to build inline, with the dynamic
 * parts turned into tokens. Two deliberate, mail-client-invisible differences
 * from the pre-editor copy: the order number is no longer wrapped in <strong>
 * (owner text is escaped, so no letter's copy may carry markup any more), and
 * the two `&nbsp;` that used to hold «№ 100042» / «15 %» together are plain
 * spaces — an invisible character in a field the owner types into is a trap,
 * and this is the only thing it bought.
 */
const D: Record<MailTextTemplate, Record<Lang, MailTextSet>> = {
  "order-confirmed": {
    ru: {
      subject: "Заказ {order} принят — Rempire",
      intro: "Спасибо за заказ № {order} — мы его получили и уже собираем.",
      signature: "Есть вопрос по заказу? Просто ответьте на это письмо — мы на связи.",
    },
    et: {
      subject: "Tellimus {order} on vastu võetud — Rempire",
      intro: "Aitäh tellimuse nr {order} eest — see on meieni jõudnud ja paneme selle kokku.",
      signature: "Küsimus tellimuse kohta? Vastake lihtsalt sellele kirjale — oleme olemas.",
    },
    en: {
      subject: "Order {order} confirmed — Rempire",
      intro: "Thank you for order no. {order} — we have it and are packing it now.",
      signature: "A question about the order? Just reply to this e-mail — we read it.",
    },
  },
  "order-shipped": {
    ru: {
      subject: "Заказ {order} отправлен — Rempire",
      intro: "Ваш заказ № {order} передан в службу доставки и уже в пути.",
      signature: "Трек-номер начинает отслеживаться в течение нескольких часов после отправки.",
    },
    et: {
      subject: "Tellimus {order} on teele saadetud — Rempire",
      intro: "Teie tellimus nr {order} on antud üle vedajale ja on teel.",
      signature: "Jälgimisnumber hakkab tööle mõne tunni jooksul pärast üleandmist.",
    },
    en: {
      subject: "Order {order} has shipped — Rempire",
      intro: "Your order no. {order} has been handed to the carrier and is on its way.",
      signature: "Tracking usually starts working a few hours after the parcel is handed over.",
    },
  },
  "abandoned-cart": {
    ru: {
      subject: "Вы забыли корзину — Rempire",
      intro: "Вы собрали корзину, но не завершили заказ. Мы всё сохранили — вот что внутри:",
      signature:
        "Товары в корзине не резервируются — популярные позиции быстро заканчиваются. Если передумали — просто проигнорируйте это письмо.",
    },
    et: {
      subject: "Ostukorv jäi pooleli — Rempire",
      intro: "Panite ostukorvi kokku, aga tellimus jäi lõpetamata. Hoidsime kõik alles — siin on sisu:",
      signature:
        "Ostukorvis olevaid tooteid ei broneerita — populaarsed saavad kiiresti otsa. Kui mõtlesite ümber, jätke see kiri lihtsalt tähelepanuta.",
    },
    en: {
      subject: "You left your cart — Rempire",
      intro: "You filled a cart but did not finish the order. We kept everything — here is what is inside:",
      signature:
        "Items in a cart are not reserved — popular ones sell out quickly. Changed your mind? Just ignore this e-mail.",
    },
  },
  "back-in-stock": {
    ru: {
      subject: "{product} снова в наличии — Rempire",
      intro:
        "Вы просили сообщить, когда этот товар вернётся в магазин. Хорошая новость — он снова на полке.",
      signature:
        "Наличие и цена актуальны на момент отправки письма. Мы не резервируем товар — кто первый, того и полка.",
    },
    et: {
      subject: "{product} on taas laos — Rempire",
      intro: "Palusite teada anda, kui see toode poodi naaseb. Hea uudis — ta on taas riiulil.",
      signature:
        "Saadavus ja hind kehtivad kirja saatmise hetkel. Me ei broneeri toodet — kes ees, see mees.",
    },
    en: {
      subject: "{product} is back in stock — Rempire",
      intro: "You asked us to write when this product came back. Good news — it is on the shelf again.",
      signature:
        "Availability and price are correct at the time this e-mail was sent. We do not reserve stock — first come, first served.",
    },
  },
  birthday: {
    ru: {
      subject: "С днём рождения! Ваша персональная скидка — Rempire",
      intro:
        "В честь вашего дня рождения дарим скидку {percent} % на всё в магазине — уход, укладку, бороду и парфюм.",
      signature:
        "Введите код при оформлении заказа. Промокод личный и не суммируется с другими акциями.",
    },
    et: {
      subject: "Palju õnne sünnipäevaks! Teie isiklik soodustus — Rempire",
      intro:
        "Sünnipäeva puhul kingime {percent} % soodustust kogu poele — hooldus, viimistlus, habe ja parfüüm.",
      signature:
        "Sisestage kood tellimuse vormistamisel. Kood on isiklik ega liitu teiste kampaaniatega.",
    },
    en: {
      subject: "Happy birthday! Your personal discount — Rempire",
      intro:
        "For your birthday here is {percent}% off everything in the shop — hair, styling, beard and fragrance.",
      signature: "Enter the code at checkout. The code is personal and does not stack with other offers.",
    },
  },
  "login-code": {
    ru: {
      subject: "{code} — код для входа в Rempire",
      intro:
        "Вот код для входа в личный кабинет Rempire. Введите его на странице, с которой вы его запросили.",
      signature:
        "Если вы не запрашивали код, просто удалите это письмо: без кода в кабинет никто не войдёт.",
    },
    et: {
      subject: "{code} — Rempire sisselogimiskood",
      intro:
        "Siin on kood Rempire kliendikontosse sisselogimiseks. Sisestage see samal lehel, kust koodi küsisite.",
      signature: "Kui te koodi ei küsinud, kustutage see kiri: ilma koodita kontosse ei pääse.",
    },
    en: {
      subject: "{code} — your Rempire sign-in code",
      intro:
        "Here is the code for signing in to your Rempire account. Enter it on the page you asked for it from.",
      signature: "Did not ask for a code? Delete this e-mail: nobody can sign in without it.",
    },
  },
};

export const MAIL_TEXT_DEFAULTS: Record<MailTextTemplate, Record<Lang, MailTextSet>> = D;

/** The stored copy of one letter's default text, for the admin editor. */
export function defaultMailText(
  template: MailTextTemplate,
  lang: Lang,
  field: MailTextField,
): string {
  return D[template][lang][field];
}

/* ---------- validation / clamping --------------------------------------- */

/* Everything C0/C1 except the newline, which a multi-line intro may keep. */
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const LANGS: readonly Lang[] = ["ru", "et", "en"];

function cleanField(raw: unknown, field: MailTextField): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\r\n?/g, "\n").replace(CONTROL_RE, " ");
  s = field === "intro"
    ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : s.replace(/\s+/g, " ");
  return s.trim().slice(0, MAIL_TEXT_LIMITS[field]).trim();
}

/**
 * What actually gets stored. Unknown templates, unknown languages, unknown
 * fields and non-strings are dropped; every kept string is stripped of
 * control characters and clamped. An empty string means «вернуть стандартный
 * текст», so it is dropped too — the letter falls back to the default.
 */
export function cleanMailTexts(raw: unknown): MailTexts {
  const out: MailTexts = {};
  /* jsonb comes back as an object, but a row written by hand (or by an older
     driver) can be the JSON string — the same defensiveness getFlows() has. */
  let val: unknown = raw;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return out;
    }
  }
  if (!val || typeof val !== "object" || Array.isArray(val)) return out;
  const src = val as Record<string, unknown>;

  for (const template of MAIL_TEXT_TEMPLATES) {
    const byLang = src[template];
    if (!byLang || typeof byLang !== "object" || Array.isArray(byLang)) continue;
    const langs = byLang as Record<string, unknown>;
    const kept: Partial<Record<Lang, Partial<MailTextSet>>> = {};

    for (const lang of LANGS) {
      const set = langs[lang];
      if (!set || typeof set !== "object" || Array.isArray(set)) continue;
      const fields = set as Record<string, unknown>;
      const keptSet: Partial<MailTextSet> = {};
      for (const field of MAIL_TEXT_FIELDS) {
        const v = cleanField(fields[field], field);
        if (v) keptSet[field] = v;
      }
      if (Object.keys(keptSet).length) kept[lang] = keptSet;
    }
    if (Object.keys(kept).length) out[template] = kept;
  }
  return out;
}

/* ---------- the ambient override ---------------------------------------- */

let OVERRIDE: MailTexts = {};

/** Called by the loader before rendering; `null` restores the defaults. */
export function setMailTextsOverride(t: MailTexts | null | undefined): void {
  OVERRIDE = t && typeof t === "object" && !Array.isArray(t) ? cleanMailTexts(t) : {};
}

/** What is loaded right now — the admin editor and the tests read it back. */
export function mailTextsOverride(): MailTexts {
  return OVERRIDE;
}

/* ---------- reading one string ------------------------------------------ */

/**
 * The owner's text with the placeholders filled in, or the letter's default
 * when he never touched it. Raw — the caller escapes for HTML.
 */
export function mailText(
  template: MailTextTemplate,
  lang: Lang,
  field: MailTextField,
  values: MailTextValues = {},
): string {
  const own = OVERRIDE[template]?.[lang]?.[field];
  const raw = typeof own === "string" && own.trim() ? own : D[template][lang][field];
  return fillPlaceholders(raw, values).trim();
}

/** The same string, ready for a letter's HTML body: escaped, newlines kept. */
export function mailTextHtml(
  template: MailTextTemplate,
  lang: Lang,
  field: MailTextField,
  values: MailTextValues = {},
): string {
  return esc(mailText(template, lang, field, values)).replace(/\n/g, "<br>");
}
