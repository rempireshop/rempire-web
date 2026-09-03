/**
 * «Заказ отправлен» — tracking code and a button that opens the carrier.
 * Design source: public/shop/emails/order-shipped.html
 */

import { customerName, deliveryLine, greeting, orderNumber } from "./common";
import {
  COMMON,
  absUrl,
  esc,
  normalizeLang,
  pick,
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
import type { Lang, OrderLike, RenderedEmail, Tracking } from "./types";

interface Strings {
  subject: (n: string) => string;
  preheader: string;
  title: string;
  lead: (hello: string, n: string) => string;
  code: string;
  cta: string;
  noteLocker: string;
  noteDelay: string;
  noCode: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (n) => `Заказ ${n} отправлен — Rempire`,
    preheader: "Посылка в пути. Внутри — трек-номер и ссылка для отслеживания.",
    title: "Заказ отправлен",
    lead: (hello, n) =>
      `${hello} Ваш заказ <strong>№&nbsp;${n}</strong> передан в службу доставки и уже в пути.`,
    code: "Трек-номер",
    cta: "Отследить посылку",
    noteLocker:
      "Если вы выбрали пакомат — когда посылка приедет, вам придёт SMS с кодом дверцы. Если доставка курьером — курьер свяжется с вами перед приездом.",
    noteDelay:
      "Трек-номер начинает отслеживаться в течение нескольких часов после отправки.",
    noCode: "будет добавлен",
  },
  et: {
    subject: (n) => `Tellimus ${n} on teele saadetud — Rempire`,
    preheader: "Pakk on teel. Kirjas on jälgimisnumber ja jälgimise link.",
    title: "Tellimus teel",
    lead: (hello, n) =>
      `${hello} Teie tellimus <strong>nr&nbsp;${n}</strong> on antud üle vedajale ja on teel.`,
    code: "Jälgimisnumber",
    cta: "Jälgi pakki",
    noteLocker:
      "Kui valisite pakiautomaadi, saate paki saabudes SMS-i ukse koodiga. Kui valisite kulleri, võtab kuller enne saabumist ühendust.",
    noteDelay:
      "Jälgimisnumber hakkab tööle mõne tunni jooksul pärast üleandmist.",
    noCode: "lisandub",
  },
  en: {
    subject: (n) => `Order ${n} has shipped — Rempire`,
    preheader: "Your parcel is on its way — tracking number and link inside.",
    title: "Order shipped",
    lead: (hello, n) =>
      `${hello} Your order <strong>no.&nbsp;${n}</strong> has been handed to the carrier and is on its way.`,
    code: "Tracking number",
    cta: "Track the parcel",
    noteLocker:
      "If you chose a parcel locker, you will get an SMS with the door code when the parcel arrives. If you chose a courier, the courier calls before delivery.",
    noteDelay:
      "Tracking usually starts working a few hours after the parcel is handed over.",
    noCode: "to follow",
  },
};

/** Carrier tracking pages, in the customer's own language where offered. */
function carrierUrl(carrier: string, code: string, lang: Lang): string {
  const c = carrier.toLowerCase();
  const q = encodeURIComponent(code);
  if (/omniva/.test(c)) {
    const l = lang === "ru" ? "ru" : lang === "et" ? "et" : "en";
    return `https://www.omniva.ee/${l}/private/track-and-trace?barcode=${q}`;
  }
  if (/dpd/.test(c)) {
    return `https://tracking.dpd.de/status/en_US/parcel/${q}`;
  }
  if (/smartpost|itella/.test(c)) {
    return `https://itella.ee/en/private/track-and-trace/?trackingCode=${q}`;
  }
  if (/venipak/.test(c)) {
    return `https://venipak.com/en/tracking/?tracking_id=${q}`;
  }
  if (/post|eesti/.test(c)) {
    return `https://www.omniva.ee/private/track-and-trace?barcode=${q}`;
  }
  return "";
}

interface TrackingParts {
  code: string;
  url: string;
  carrier: string;
}

function parseTracking(
  tracking: Tracking,
  order: OrderLike,
  lang: Lang,
): TrackingParts {
  const obj = typeof tracking === "string" ? { code: tracking } : tracking || {};
  const code = pick(obj.code);
  const carrier = pick(obj.carrier, order.shipping?.carrier);
  const explicit = pick(obj.url);
  const url = explicit
    ? absUrl(explicit)
    : code && carrier
      ? carrierUrl(carrier, code, lang) || absUrl("/shop2/account/")
      : absUrl("/shop2/account/");
  return { code, url, carrier };
}

export function renderOrderShipped(
  order: OrderLike,
  lang: Lang | string = "ru",
  tracking?: Tracking,
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const hello = greeting(L, customerName(order));
  const { code, url } = parseTracking(tracking, order, L);
  const delivery = deliveryLine(order.shipping, L);

  const body =
    rowTitle(t.title) +
    rowLead(t.lead(esc(hello), esc(number))) +
    rowCode(t.code, code || t.noCode, delivery) +
    rowButton(url, t.cta) +
    rowNote([esc(t.noteLocker), esc(t.noteDelay)]);

  const html = shell({
    lang: L,
    title: `${t.title} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote: esc(c.serviceNote),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    stripHtml(t.lead(hello, number)),
    "",
    `${t.code}: ${code || t.noCode}`,
    delivery,
    "",
    `${t.cta}: ${url}`,
    "",
    t.noteLocker,
    t.noteDelay,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: t.subject(number), html, text };
}
