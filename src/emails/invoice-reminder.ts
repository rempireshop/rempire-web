/**
 * «Напоминание об оплате счёта» — the one reminder an unpaid company invoice
 * gets, a few days before its due date (src/lib/invoice-dunning.ts, the
 * interval is «Настройки → О компании → Счета для компаний»).
 *
 * Written for the person who reads it: a bookkeeper with a folder of open
 * invoices. So it repeats everything needed to make the transfer without
 * opening anything — number, amount, IBAN, reference, due date — carries the
 * same PDF again, and says plainly what happens if nothing arrives, because a
 * reminder that hides the deadline is not a reminder.
 *
 * Same shell as every other letter (src/emails/layout.ts). Not owner-editable
 * — like the invoice itself, its wording is bound to the numbers in it.
 */

import { customerName, greeting, orderNumber } from "./common";
import {
  esc,
  money,
  normalizeLang,
  pick,
  rowLead,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, OrderLike, RenderedEmail } from "./types";

/** What the reminder needs to know — a slice of the invoice, not the record. */
export interface InvoiceReminderData {
  invoice: {
    number: string;
    /** `YYYY-MM-DD`. */
    dueAt: string;
  };
  seller: {
    name: string;
    iban: string;
    bankName: string;
  };
  totals: {
    total: number;
  };
  /**
   * `YYYY-MM-DD` the order is cancelled on if nothing arrives, or null when
   * the owner turned the automatic cancellation off — then the letter simply
   * does not threaten one.
   */
  cancelAt?: string | null;
  /** True while the invoice is already past its due date (a run that caught up late). */
  overdue?: boolean;
}

interface Strings {
  subject: (number: string) => string;
  preheader: (total: string, due: string) => string;
  title: string;
  lead: (order: string, number: string, due: string) => string;
  leadOverdue: (order: string, number: string, due: string) => string;
  payLabel: string;
  beneficiary: string;
  bank: string;
  reference: string;
  amount: string;
  due: string;
  attached: string;
  willCancel: (date: string) => string;
  alreadyPaid: string;
  service: string;
}

/** `2026-09-13` → `13.09.2026`. */
function humanDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || "");
}

const T: Record<Lang, Strings> = {
  ru: {
    subject: (n) => `Напоминание об оплате счёта ${n} — Rempire`,
    preheader: (t, d) => `Счёт на ${t} ещё не оплачен, срок — ${d}.`,
    title: "Напоминание об оплате",
    lead: (o, n, d) =>
      `Счёт № ${n} на заказ ${o} пока не оплачен. Срок оплаты — ${d}. Если перевод уже отправлен, это письмо можно не читать.`,
    leadOverdue: (o, n, d) =>
      `Счёт № ${n} на заказ ${o} пока не оплачен, а срок оплаты — ${d} — уже прошёл. Если перевод уже отправлен, это письмо можно не читать.`,
    payLabel: "Реквизиты для оплаты",
    beneficiary: "Получатель",
    bank: "Банк",
    reference: "Пояснение платежа",
    amount: "Сумма",
    due: "Оплатить до",
    attached: "Счёт в формате PDF приложен к этому письму ещё раз.",
    willCancel: (d) => `Если оплата не поступит до ${d}, заказ будет отменён, а товары вернутся в продажу.`,
    alreadyPaid: "Счёт уже оплачен или нужны другие реквизиты? Просто ответьте на это письмо.",
    service: "Это служебное письмо о вашем заказе.",
  },
  et: {
    subject: (n) => `Meeldetuletus arve ${n} tasumise kohta — Rempire`,
    preheader: (t, d) => `Arve summas ${t} on tasumata, tähtaeg ${d}.`,
    title: "Meeldetuletus",
    lead: (o, n, d) =>
      `Arve nr ${n} tellimusele ${o} on veel tasumata. Maksetähtaeg on ${d}. Kui makse on juba teele pandud, jätke see kiri tähelepanuta.`,
    leadOverdue: (o, n, d) =>
      `Arve nr ${n} tellimusele ${o} on veel tasumata ja maksetähtaeg ${d} on möödas. Kui makse on juba teele pandud, jätke see kiri tähelepanuta.`,
    payLabel: "Makserekvisiidid",
    beneficiary: "Saaja",
    bank: "Pank",
    reference: "Selgitus",
    amount: "Summa",
    due: "Maksetähtaeg",
    attached: "Arve PDF-kujul on ka selle kirja manuses.",
    willCancel: (d) => `Kui makse ei laeku ${d}, tühistame tellimuse ja kaubad lähevad tagasi müüki.`,
    alreadyPaid: "Kas arve on juba tasutud või vajate teisi rekvisiite? Vastake lihtsalt sellele kirjale.",
    service: "See on teenuskiri teie tellimuse kohta.",
  },
  en: {
    subject: (n) => `Reminder: invoice ${n} — Rempire`,
    preheader: (t, d) => `The ${t} invoice is still unpaid, due ${d}.`,
    title: "Payment reminder",
    lead: (o, n, d) =>
      `Invoice no. ${n} for order ${o} has not been paid yet. It is due by ${d}. If the transfer is already on its way, please ignore this letter.`,
    leadOverdue: (o, n, d) =>
      `Invoice no. ${n} for order ${o} has not been paid yet and its due date, ${d}, has passed. If the transfer is already on its way, please ignore this letter.`,
    payLabel: "Payment details",
    beneficiary: "Beneficiary",
    bank: "Bank",
    reference: "Reference",
    amount: "Amount",
    due: "Due by",
    attached: "The invoice is attached to this e-mail as a PDF again.",
    willCancel: (d) => `If the payment does not arrive by ${d}, the order is cancelled and the goods go back on sale.`,
    alreadyPaid: "Already paid, or need the invoice made out to different details? Just reply to this e-mail.",
    service: "This is a service e-mail about your order.",
  },
};

export function renderInvoiceReminder(
  order: OrderLike,
  data: InvoiceReminderData,
  lang: Lang | string = "ru",
): RenderedEmail {
  const L = normalizeLang(lang ?? order.lang);
  const t = T[L];

  const number = orderNumber(order);
  const inv = pick(data.invoice.number, "—");
  const due = humanDate(data.invoice.dueAt);
  const hello = greeting(L, customerName(order));
  const total = money(data.totals.total);
  const totalHtml = money(data.totals.total, true);
  const iban = pick(data.seller.iban);
  const bank = pick(data.seller.bankName);
  const reference = `${number}, ${inv}`;
  const lead = data.overdue ? t.leadOverdue(number, inv, due) : t.lead(number, inv, due);
  const cancelAt = data.cancelAt ? humanDate(data.cancelAt) : "";

  /* The same small label/value table the invoice letter carries, so the two
     read as one document: label left, value right, the IBAN and the reference
     in a tracked-out face because they are what gets retyped into a bank. */
  const detail = (label: string, value: string, mono = false) =>
    `<tr><td class="em-panel-muted" style="padding:3px 12px 3px 0; font-family:'Golos Text',Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; color:#6f6b57; background-color:#edeae1; white-space:nowrap;">${esc(label)}</td>` +
    `<td class="em-panel-ink" style="padding:3px 0; font-family:${mono ? "'Courier New',Courier,monospace" : "'Golos Text',Arial,Helvetica,sans-serif"}; font-size:${mono ? "14px" : "13px"}; line-height:20px; font-weight:bold; color:#1c1a00; background-color:#edeae1;">${value}</td></tr>`;
  const details =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
    detail(t.beneficiary, esc(pick(data.seller.name, "Rempire Store OÜ"))) +
    detail("IBAN", esc(iban).replace(/ /g, "&nbsp;"), true) +
    (bank ? detail(t.bank, esc(bank)) : "") +
    detail(t.reference, esc(reference), true) +
    detail(t.amount, totalHtml) +
    detail(t.due, esc(due)) +
    `</table>`;

  const notes = [esc(t.attached)];
  if (cancelAt) notes.push(esc(t.willCancel(cancelAt)));
  notes.push(esc(t.alreadyPaid));

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)}<br>${esc(lead)}`) +
    rowPanel(t.payLabel, details) +
    rowNote(notes);

  const html = shell({
    lang: L,
    // the shell escapes the preheader, so the joiner is a real U+00A0: a price
    // never breaks between the number and the sign (tests/emails-compat.test.ts)
    preheader: t.preheader(total.replace(" €", " €"), due),
    title: `${t.title} — ${inv}`,
    body,
    footerNote: esc(t.service),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    hello,
    lead,
    "",
    `${t.payLabel}:`,
    `  ${t.beneficiary}: ${pick(data.seller.name, "Rempire Store OÜ")}`,
    `  IBAN: ${iban}`,
    bank ? `  ${t.bank}: ${bank}` : null,
    `  ${t.reference}: ${reference}`,
    `  ${t.amount}: ${total}`,
    `  ${t.due}: ${due}`,
    "",
    t.attached,
    cancelAt ? t.willCancel(cancelAt) : null,
    t.alreadyPaid,
    textFooter(L, t.service),
  ]);

  return { subject: t.subject(inv), html, text: text.replace(/\n{3,}/g, "\n\n") };
}
