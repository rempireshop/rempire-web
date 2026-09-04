/**
 * «Подарочная карта» — sent once a paid order contains a gift-card line.
 * Goes to the recipient's address when the buyer typed one, else to the buyer.
 * Same shell as the other letters (public/shop/emails/*.html design source).
 */

import {
  absUrl,
  esc,
  money,
  normalizeLang,
  num,
  pick,
  rowButton,
  rowCode,
  rowLead,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, RenderedEmail } from "./types";

export interface GiftCardLike {
  code?: string | null;
  amount?: unknown;
  balance?: unknown;
  lang?: string | null;
  recipient?: {
    name?: string | null;
    email?: string | null;
    message?: string | null;
    from?: string | null;
  } | null;
}

interface Strings {
  subject: (amount: string) => string;
  preheader: string;
  title: string;
  greet: (name: string) => string;
  lead: (from: string, amount: string) => string;
  leadNoFrom: (amount: string) => string;
  messageLabel: string;
  codeLabel: string;
  codeNote: string;
  how: string;
  cta: string;
  note: string;
  why: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (a) => `Вам подарили карту Rempire на ${a}`,
    preheader: "Код внутри. Действует на всё в магазине, год со дня покупки.",
    title: "Подарочная карта",
    greet: (n) => (n ? `Здравствуйте, ${n}!` : "Здравствуйте!"),
    lead: (f, a) => `${f} дарит вам подарочную карту Rempire на ${a}. Ниже её код.`,
    leadNoFrom: (a) => `Вам подарили подарочную карту Rempire на ${a}. Ниже её код.`,
    messageLabel: "Сообщение от дарителя",
    codeLabel: "Код карты",
    codeNote: "Введите код в поле «Промокод или подарочная карта» при оформлении заказа.",
    how: "Картой можно оплатить любой товар в магазине — целиком или частично. Остаток сохраняется на карте до следующего заказа. Карта действует год со дня покупки.",
    cta: "Выбрать подарок",
    note: "Храните код как деньги: он не привязан к адресу и работает у любого, кто его введёт.",
    why: "Вы получили это письмо, потому что кто-то указал ваш адрес при покупке подарочной карты в Rempire.",
  },
  et: {
    subject: (a) => `Sulle kingiti Rempire kinkekaart summas ${a}`,
    preheader: "Kood on kirjas. Kehtib kogu poe kaubale aasta alates ostust.",
    title: "Kinkekaart",
    greet: (n) => (n ? `Tere, ${n}!` : "Tere!"),
    lead: (f, a) => `${f} kingib sulle Rempire kinkekaardi summas ${a}. Kood on allpool.`,
    leadNoFrom: (a) => `Sulle kingiti Rempire kinkekaart summas ${a}. Kood on allpool.`,
    messageLabel: "Kinkija sõnum",
    codeLabel: "Kaardi kood",
    codeNote: "Sisesta kood kassas väljale «Sooduskood või kinkekaart».",
    how: "Kaardiga saab tasuda iga poe toote eest — kas kogu summa või osa sellest. Jääk jääb kaardile järgmise tellimuse jaoks. Kaart kehtib aasta alates ostukuupäevast.",
    cta: "Vali kingitus",
    note: "Hoia koodi nagu raha: see ei ole aadressiga seotud ja töötab igaühel, kes selle sisestab.",
    why: "Said selle kirja, sest keegi märkis Rempire kinkekaarti ostes sinu aadressi.",
  },
  en: {
    subject: (a) => `You've been given a ${a} Rempire gift card`,
    preheader: "The code is inside. Valid on everything in the shop for a year from purchase.",
    title: "Gift card",
    greet: (n) => (n ? `Hello ${n},` : "Hello,"),
    lead: (f, a) => `${f} is giving you a ${a} Rempire gift card. The code is below.`,
    leadNoFrom: (a) => `You've been given a ${a} Rempire gift card. The code is below.`,
    messageLabel: "Message from the giver",
    codeLabel: "Card code",
    codeNote: "Enter the code in the “Discount code or gift card” field at checkout.",
    how: "The card pays for any product in the shop, in full or in part. Whatever is left stays on the card for your next order. The card is valid for one year from the date of purchase.",
    cta: "Choose a gift",
    note: "Treat the code like cash: it is not tied to an address and works for anyone who enters it.",
    why: "You are getting this e-mail because someone entered your address when buying a Rempire gift card.",
  },
};

export function renderGiftCard(card: GiftCardLike, lang: Lang | string = "ru"): RenderedEmail {
  const L = normalizeLang(lang ?? card.lang);
  const t = T[L];

  const amount = money(num(card.amount, 0));
  const code = pick(card.code, "").toUpperCase();
  const r = card.recipient ?? {};
  const name = pick(r.name);
  const from = pick(r.from);
  const message = pick(r.message);
  const shopUrl = absUrl("/shop2/", "/shop2/");

  const lead = from ? t.lead(esc(from), amount) : t.leadNoFrom(amount);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(t.greet(name))}<br>${lead}`) +
    (message ? rowNote([`<strong>${esc(t.messageLabel)}:</strong> ${esc(message)}`]) : "") +
    rowCode(t.codeLabel, code, t.codeNote, true) +
    rowNote([esc(t.how)]) +
    rowButton(shopUrl, t.cta) +
    rowNote([esc(t.note)]);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote: esc(t.why),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    t.greet(name),
    from ? t.lead(from, amount) : t.leadNoFrom(amount),
    "",
    message ? `${t.messageLabel}: ${message}` : "",
    message ? "" : "",
    `${t.codeLabel}: ${code}`,
    t.codeNote,
    "",
    t.how,
    "",
    `${t.cta}: ${shopUrl}`,
    "",
    t.note,
    "",
    textFooter(L, t.why),
  ]);

  return { subject: t.subject(amount), html, text: text.replace(/\n{3,}/g, "\n\n") };
}
