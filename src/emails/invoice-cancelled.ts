/**
 * «Заказ отменён — счёт не оплачен» — the letter that closes an invoice
 * nobody paid (src/lib/invoice-dunning.ts; the interval is «Настройки →
 * О компании → Счета для компаний»).
 *
 * The one thing this letter must not be is a demand. The order is already
 * cancelled by the time it is sent, so it states that plainly, says which
 * invoice and by which date, tells the company the goods are back on sale and
 * that a new order is a click away — and leaves the door open in the one case
 * that matters: a transfer that crossed the letter in the post. «Ответьте на
 * это письмо» is not politeness there, it is the recovery path.
 *
 * Not owner-editable: like the invoice and its reminder, the wording is bound
 * to the numbers in it.
 */

import { customerName, greeting, orderNumber } from "./common";
import {
  baseUrl,
  esc,
  money,
  normalizeLang,
  pick,
  rowButton,
  rowLead,
  rowNote,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, OrderLike, RenderedEmail } from "./types";

export interface InvoiceCancelledData {
  invoice: {
    number: string;
    /** `YYYY-MM-DD` — the due date that passed. */
    dueAt: string;
  };
  totals: {
    total: number;
  };
}

interface Strings {
  subject: (order: string) => string;
  preheader: (number: string) => string;
  title: string;
  lead: (order: string, number: string, due: string) => string;
  amountLine: (total: string) => string;
  stock: string;
  crossed: string;
  again: string;
  shop: string;
  service: string;
}

/** `2026-09-13` → `13.09.2026`. */
function humanDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || "");
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (o) => `Заказ ${o} отменён, счёт не оплачен — Rempire`,
    preheader: (n) => `Счёт ${n} остался неоплаченным, заказ закрыт.`,
    title: "Заказ отменён",
    lead: (o, n, d) =>
      `Счёт № ${n} на заказ ${o} не был оплачен до ${d}, поэтому заказ отменён. Ничего платить по нему больше не нужно.`,
    amountLine: (t) => `Сумма счёта была ${t}.`,
    stock: "Товары из заказа вернулись в продажу.",
    crossed: "Если перевод всё-таки был отправлен — ответьте на это письмо, мы найдём платёж и вернём заказ.",
    again: "Заказать снова можно в любой момент — мы выпишем новый счёт.",
    shop: "Открыть магазин",
    service: "Это служебное письмо о вашем заказе.",
  },
  et: {
    subject: (o) => `Tellimus ${o} on tühistatud, arve jäi tasumata — Rempire`,
    preheader: (n) => `Arve ${n} jäi tasumata, tellimus on suletud.`,
    title: "Tellimus tühistatud",
    lead: (o, n, d) =>
      `Arve nr ${n} tellimusele ${o} ei olnud ${d} seisuga tasutud, seetõttu on tellimus tühistatud. Selle arve alusel ei ole vaja enam midagi maksta.`,
    amountLine: (t) => `Arve summa oli ${t}.`,
    stock: "Tellimuse kaubad on tagasi müügis.",
    crossed: "Kui makse siiski tehti, vastake sellele kirjale — leiame makse üles ja taastame tellimuse.",
    again: "Uue tellimuse saab teha igal ajal — väljastame uue arve.",
    shop: "Ava pood",
    service: "See on teenuskiri teie tellimuse kohta.",
  },
  en: {
    subject: (o) => `Order ${o} cancelled, the invoice was not paid — Rempire`,
    preheader: (n) => `Invoice ${n} stayed unpaid, the order is closed.`,
    title: "Order cancelled",
    lead: (o, n, d) =>
      `Invoice no. ${n} for order ${o} was not paid by ${d}, so the order has been cancelled. Nothing is owed on it any more.`,
    amountLine: (t) => `The invoice was for ${t}.`,
    stock: "The goods from the order are back on sale.",
    crossed: "If the transfer was made after all, reply to this e-mail — we will find the payment and restore the order.",
    again: "You are welcome to order again at any time; we will issue a new invoice.",
    shop: "Open the shop",
    service: "This is a service e-mail about your order.",
  },
};

/** `/`, `/et/`, `/en/` — the shop the company can order from again. */
function shopUrl(lang: Lang): string {
  return `${baseUrl()}/shop2${lang === "et" ? "/et" : lang === "en" ? "/en" : ""}/`;
}

export function renderInvoiceCancelled(
  order: OrderLike,
  data: InvoiceCancelledData,
  lang: Lang | string = "ru",
): RenderedEmail {
  const L = normalizeLang(lang ?? order.lang);
  const t = T[L];

  const number = orderNumber(order);
  const inv = pick(data.invoice.number, "—");
  const due = humanDate(data.invoice.dueAt);
  const hello = greeting(L, customerName(order));
  const total = money(data.totals.total);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)}<br>${esc(t.lead(number, inv, due))}`) +
    rowNote([esc(t.amountLine(total)), esc(t.stock), esc(t.crossed), esc(t.again)]) +
    rowButton(shopUrl(L), t.shop);

  const html = shell({
    lang: L,
    title: `${t.title} — ${number}`,
    preheader: t.preheader(inv),
    body,
    footerNote: esc(t.service),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    hello,
    t.lead(number, inv, due),
    "",
    t.amountLine(total),
    t.stock,
    t.crossed,
    t.again,
    shopUrl(L),
    textFooter(L, t.service),
  ]);

  return { subject: t.subject(number), html, text: text.replace(/\n{3,}/g, "\n\n") };
}
