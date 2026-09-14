/**
 * «Заказ отправлен» — tracking code and a button that opens the carrier.
 * Design source: public/shop/emails/order-shipped.html
 *
 * Subject, the paragraph under the greeting and the closing line are the
 * owner's (settings.mail_texts, «Письма» in the admin) — see ./texts.ts.
 */

import { customerName, deliveryLine, greeting, orderNumber } from "./common";
import {
  BRAND,
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
  textBody,
  textFooter,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, OrderLike, RenderedEmail, Tracking } from "./types";

interface Strings {
  preheader: string;
  title: string;
  code: string;
  cta: string;
  noteLocker: string;
  /**
   * The same note for the orders that went to a manned counter rather than a
   * machine — Montonio mixes the two into one list and the shop labels them
   * apart since 14.09.2026. The locker note promises an SMS with a door code,
   * and a counter has no door; this one says what actually happens instead.
   */
  noteCounter: string;
  noCode: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Посылка в пути. Внутри — трек-номер и ссылка для отслеживания.",
    title: "Заказ отправлен",
    code: "Трек-номер",
    cta: "Отследить посылку",
    noteLocker:
      "Если вы выбрали пакомат — когда посылка приедет, вам придёт SMS с кодом дверцы. Если доставка курьером — курьер свяжется с вами перед приездом.",
    noteCounter:
      "Вы выбрали пункт выдачи, а не автомат: посылку отдаст продавец в часы работы точки. Номер посылки — выше.",
    noCode: "будет добавлен",
  },
  et: {
    preheader: "Pakk on teel. Kirjas on jälgimisnumber ja jälgimise link.",
    title: "Tellimus teel",
    code: "Jälgimisnumber",
    cta: "Jälgi pakki",
    noteLocker:
      "Kui valisite pakiautomaadi, saate paki saabudes SMS-i ukse koodiga. Kui valisite kulleri, võtab kuller enne saabumist ühendust.",
    noteCounter:
      "Valisite pakipunkti, mitte automaadi: paki annab üle müüja punkti lahtiolekuaegadel. Paki number on ülal.",
    noCode: "lisandub",
  },
  en: {
    preheader: "Your parcel is on its way — tracking number and link inside.",
    title: "Order shipped",
    code: "Tracking number",
    cta: "Track the parcel",
    noteLocker:
      "If you chose a parcel locker, you will get an SMS with the door code when the parcel arrives. If you chose a courier, the courier calls before delivery.",
    noteCounter:
      "You chose a pickup point, not a machine: a shop assistant hands the parcel over during the point’s opening hours. The parcel number is above.",
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
  /* Nova Post (Montonio International Shipping) before the `post` branch
     below, which would otherwise send a Nova Post parcel to Omniva's page:
     "novapost" contains "post". No URL of its own on purpose — Montonio sends
     the tracking link with the shipment (`tracking.url`, preferred above), and
     a guessed page is worse than the account page the caller falls back to. */
  if (/nova ?post/.test(c)) {
    return "";
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
  const name = customerName(order);
  const hello = greeting(L, name);
  const { code, url } = parseTracking(tracking, order, L);
  const delivery = deliveryLine(order.shipping, L);
  /* A counter is not a machine and has no door code — the note has to match
     the point the parcel actually went to. Missing pointType means an order
     from before the field existed, and those were all called machines. */
  const pt = String(order.shipping?.pointType ?? "").toLowerCase();
  const note = pt === "pickup_point" || pt === "post_office" ? t.noteCounter : t.noteLocker;

  const values: MailTextValues = {
    name,
    order: number,
    track: code,
    shop: BRAND.name,
  };
  const intro = mailText("order-shipped", L, "intro", values);
  const signature = mailText("order-shipped", L, "signature", values);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("order-shipped", L, "intro", values)}`) +
    rowCode(t.code, code || t.noCode, delivery) +
    rowButton(url, t.cta) +
    rowNote([esc(note), mailTextHtml("order-shipped", L, "signature", values)]);

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
    `${hello} ${intro}`,
    "",
    `${t.code}: ${code || t.noCode}`,
    delivery,
    "",
    `${t.cta}: ${url}`,
    "",
    note,
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText("order-shipped", L, "subject", values), html, text };
}
