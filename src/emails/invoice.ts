/**
 * «Счёт на оплату» — sent the moment a company checks out with «По счёту»
 * (src/lib/invoices.ts issueInvoice), and again on «Отправить счёт ещё раз».
 * The PDF rides along as an attachment; this letter is what the bookkeeper
 * reads in the inbox: the number, the due date, the amount and the bank
 * details, so the transfer can be made without opening the file.
 *
 * Same shell as the other letters (src/emails/layout.ts). Not owner-editable
 * — like the gift card, its wording is bound to the numbers in it.
 */

import { customerName, greeting, itemsBlock, orderNumber, totalRows, totalsOf } from "./common";
import {
  COMMON,
  esc,
  money,
  normalizeLang,
  pick,
  rowLabel,
  rowLead,
  rowLines,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, OrderLike, RenderedEmail } from "./types";

/** What the letter needs to know about the invoice — a slice, not the record. */
export interface InvoiceMailData {
  invoice: {
    number: string;
    /** `YYYY-MM-DD`. */
    dueAt: string;
    dueDays?: number;
  };
  seller: {
    name: string;
    iban: string;
    bankName: string;
    regCode?: string;
    vatNumber?: string;
  };
  totals: {
    net: number;
    vat: number;
    total: number;
    vatRate: number;
  };
}

interface Strings {
  subject: (number: string, order: string) => string;
  preheader: (total: string, due: string) => string;
  title: string;
  lead: (order: string, number: string, due: string) => string;
  payLabel: string;
  beneficiary: string;
  bank: string;
  reference: string;
  amount: string;
  due: string;
  notSet: string;
  items: string;
  vatLine: (rate: number, vat: string, net: string) => string;
  attached: string;
  after: string;
  otherDetails: string;
  service: string;
}

/** `2026-09-13` → `13.09.2026`. */
function humanDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || "");
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (n, o) => `Счёт ${n} на заказ ${o} — Rempire`,
    preheader: (t, d) => `К оплате ${t} до ${d}. Счёт в PDF во вложении.`,
    title: "Счёт на оплату",
    lead: (o, n, d) =>
      `Спасибо за заказ ${o}. Счёт № ${n} — во вложении. Оплатите его до ${d}, и мы отправим заказ сразу после поступления денег.`,
    payLabel: "Реквизиты для оплаты",
    beneficiary: "Получатель",
    bank: "Банк",
    reference: "Пояснение платежа",
    amount: "Сумма",
    due: "Оплатить до",
    notSet: "уточните у нас",
    items: "Состав заказа",
    vatLine: (r, v, n) => `В том числе НДС ${r} % — ${v}; сумма без НДС — ${n}.`,
    attached: "Счёт в формате PDF приложен к этому письму.",
    after: "Как только оплата поступит, вы получите письмо «Заказ принят», а затем трек-номер посылки.",
    otherDetails: "Нужен счёт на другие реквизиты? Просто ответьте на это письмо.",
    service: "Это служебное письмо о вашем заказе.",
  },
  et: {
    subject: (n, o) => `Arve ${n} tellimusele ${o} — Rempire`,
    preheader: (t, d) => `Tasuda ${t} hiljemalt ${d}. Arve PDF on manuses.`,
    title: "Arve",
    lead: (o, n, d) =>
      `Aitäh tellimuse ${o} eest. Arve nr ${n} on manuses. Palume tasuda hiljemalt ${d} — saadame tellimuse teele kohe pärast makse laekumist.`,
    payLabel: "Makserekvisiidid",
    beneficiary: "Saaja",
    bank: "Pank",
    reference: "Selgitus",
    amount: "Summa",
    due: "Maksetähtaeg",
    notSet: "küsige meilt",
    items: "Tellimuse sisu",
    vatLine: (r, v, n) => `Sh käibemaks ${r} % — ${v}; summa ilma käibemaksuta — ${n}.`,
    attached: "Arve PDF-kujul on selle kirja manuses.",
    after: "Kui makse on laekunud, saate kirja «Tellimus vastu võetud» ja seejärel paki jälgimisnumbri.",
    otherDetails: "Vajate arvet teistele rekvisiitidele? Vastake lihtsalt sellele kirjale.",
    service: "See on teenuskiri teie tellimuse kohta.",
  },
  en: {
    subject: (n, o) => `Invoice ${n} for order ${o} — Rempire`,
    preheader: (t, d) => `${t} due by ${d}. The invoice PDF is attached.`,
    title: "Invoice",
    lead: (o, n, d) =>
      `Thank you for order ${o}. Invoice no. ${n} is attached. Please pay it by ${d} — we ship the order as soon as the payment arrives.`,
    payLabel: "Payment details",
    beneficiary: "Beneficiary",
    bank: "Bank",
    reference: "Reference",
    amount: "Amount",
    due: "Due by",
    notSet: "ask us",
    items: "Order summary",
    vatLine: (r, v, n) => `Including VAT ${r} % — ${v}; net amount — ${n}.`,
    attached: "The invoice is attached to this e-mail as a PDF.",
    after: "Once the payment arrives you will get the “Order confirmed” letter, then the parcel's tracking number.",
    otherDetails: "Need the invoice made out to different details? Just reply to this e-mail.",
    service: "This is a service e-mail about your order.",
  },
};

export function renderInvoice(order: OrderLike, data: InvoiceMailData, lang: Lang | string = "ru"): RenderedEmail {
  const L = normalizeLang(lang ?? order.lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const inv = pick(data.invoice.number, "—");
  const due = humanDate(data.invoice.dueAt);
  const name = customerName(order);
  const hello = greeting(L, name);
  const items = itemsBlock(order.items, L);
  const totals = totalsOf(order, items.sum);
  /* No label: totalRows() writes the word «Доставка» itself and glues
     « — <label>» after it, so handing it that same word printed «Доставка —
     Доставка» on every invoice letter. An invoice has no carrier to name
     anyway — the parcel is chosen at the checkout, not on the bill. */
  const rows = totalRows(totals, "", L);
  const total = money(data.totals.total || totals.total);
  // the HTML part keeps every price on one line (&nbsp; before the sign); the text part uses the plain gap
  const totalHtml = money(data.totals.total || totals.total, true);
  const seller = data.seller;
  const iban = pick(seller.iban) || t.notSet;
  const bank = pick(seller.bankName) || t.notSet;
  const reference = `${number}, ${inv}`;
  const vatLine = t.vatLine(data.totals.vatRate, money(data.totals.vat), money(data.totals.net));
  const vatLineHtml = esc(t.vatLine(data.totals.vatRate, "\u0000V", "\u0000N"))
    .replace("\u0000V", money(data.totals.vat, true))
    .replace("\u0000N", money(data.totals.net, true));

  /* the bank details as a small table inside the beige panel — label left,
     value right, the IBAN in a tracked-out face so the digits can be read.
     `value` is already-escaped HTML. */
  const detail = (label: string, value: string, mono = false) =>
    `<tr><td class="em-panel-muted" style="padding:3px 12px 3px 0; font-family:'Golos Text',Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; color:#6f6b57; background-color:#edeae1; white-space:nowrap;">${esc(label)}</td>` +
    `<td class="em-panel-ink" style="padding:3px 0; font-family:${mono ? "'Courier New',Courier,monospace" : "'Golos Text',Arial,Helvetica,sans-serif"}; font-size:${mono ? "14px" : "13px"}; line-height:20px; font-weight:bold; color:#1c1a00; background-color:#edeae1;">${value}</td></tr>`;
  const details =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
    detail(t.beneficiary, esc(pick(seller.name, "Rempire Store OÜ"))) +
    detail("IBAN", esc(iban).replace(/ /g, "&nbsp;"), true) +
    detail(t.bank, esc(bank)) +
    detail(t.reference, esc(reference), true) +
    detail(t.amount, totalHtml) +
    detail(t.due, esc(due)) +
    `</table>`;

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)}<br>${esc(t.lead(number, inv, due))}`) +
    rowPanel(t.payLabel, details, esc(t.attached)) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows.lines]) +
    rowNote([vatLineHtml, esc(t.after), esc(t.otherDetails)]);

  const html = shell({
    lang: L,
    title: `${t.title} ${inv} — Rempire`,
    // the shell escapes the preheader, so the joiner is a real U+00A0, not an entity
    preheader: t.preheader(total.replace(" €", " €"), due),
    body,
    footerNote: esc(t.service),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    hello,
    t.lead(number, inv, due),
    "",
    `${t.payLabel}:`,
    `  ${t.beneficiary}: ${pick(seller.name, "Rempire Store OÜ")}`,
    `  IBAN: ${iban}`,
    `  ${t.bank}: ${bank}`,
    `  ${t.reference}: ${reference}`,
    `  ${t.amount}: ${total}`,
    `  ${t.due}: ${due}`,
    t.attached,
    "",
    `${t.items}:`,
    ...items.text,
    ...rows.text,
    vatLine,
    "",
    t.after,
    t.otherDetails,
    textFooter(L, t.service),
  ]);

  return { subject: t.subject(inv, number), html, text: text.replace(/\n{3,}/g, "\n\n") };
}
